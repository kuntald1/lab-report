"""
Adds users.referral_doctor_id — a real link between a pathologist login and
their referral_doctors roster row, replacing fragile name-string matching.

Why this exists: services/doctor_sync.py used to recognize "this pathologist
already has a roster entry" purely by comparing User.full_name to
ReferralDoctor.name (case-insensitive). Renaming EITHER one (e.g. editing a
doctor's display name from "manna" to "Dr. manna" on the Referral Doctors
page) broke that match, so the next page load silently auto-created a brand
new, blank duplicate roster row for the login. This column removes name
matching from the equation going forward — once a pathologist is linked, a
rename never breaks anything or creates a duplicate again.

Backfill: for every active pathologist login not yet linked, if EXACTLY one
active referral_doctors row currently matches their name (case-insensitive),
link it. Ambiguous or no-match cases are left unlinked on purpose — the app
will link them itself (see services/doctor_sync.py) the next time the
doctor list loads, same as it does for a brand new pathologist today.

    python -m scripts.init_user_doctor_link
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import text
from database import engine, Base, SessionLocal
from models import models, org, clinical, billing, commission, b2b   # noqa: F401

PG_MIGRATIONS = [
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_doctor_id INTEGER REFERENCES referral_doctors(id)",
]


def backfill():
    from models.org import User, Role, ReferralDoctor
    db = SessionLocal()
    try:
        pathologists = db.query(User).filter(User.role == Role.PATHOLOGIST,
                                               User.is_active.is_(True),
                                               User.referral_doctor_id.is_(None)).all()
        linked = 0
        for u in pathologists:
            name = (u.full_name or u.email or "").strip()
            if not name:
                continue
            dq = db.query(ReferralDoctor).filter(ReferralDoctor.is_active.is_(True))
            if u.tenant_id is not None:
                dq = dq.filter(ReferralDoctor.tenant_id == u.tenant_id)
            candidates = [d for d in dq.all() if (d.name or "").strip().lower() == name.lower()]
            if len(candidates) == 1:
                u.referral_doctor_id = candidates[0].id
                linked += 1
            elif len(candidates) > 1:
                # Ambiguous (duplicate rows with the same name) — prefer
                # whichever one actually has data set, same tie-break the
                # report-signing lookup uses, so a stray blank duplicate
                # never wins the link either.
                def _score(d):
                    has_data = bool(d.qualification or d.registration_no or d.signature_filename)
                    return (not has_data, d.id)
                best = sorted(candidates, key=_score)[0]
                u.referral_doctor_id = best.id
                linked += 1
        db.commit()
        print(f"  ~ linked {linked} pathologist login(s) to their referral_doctors row")
    finally:
        db.close()


def main():
    print("Ensuring tables ...")
    Base.metadata.create_all(bind=engine)
    if engine.dialect.name == "postgresql":
        print("Adding users.referral_doctor_id column ...")
        with engine.begin() as conn:
            for stmt in PG_MIGRATIONS:
                conn.execute(text(stmt))
        print("Backfilling links from current name matches ...")
        backfill()
    else:
        print("  = non-postgres; create_all handled the column, running backfill anyway")
        backfill()
    print("Done.")


if __name__ == "__main__":
    main()
