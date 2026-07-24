"""Keeps pathologist-role logins and the referral_doctors roster in sync.

Commission only ever fires when a pathologist VALIDATES a report — so a
referral doctor with no login can never earn it. For commission to work at
all, the doctor picked at patient registration has to be someone who can
actually validate, i.e. a pathologist User. This module auto-creates a
matching ReferralDoctor row (commission_percent defaults to 0, admin sets
the real rate afterwards) the first time the doctor lists are read, so
existing and future pathologist logins show up automatically without a
manual backfill step.

Linking is done via User.referral_doctor_id (a real FK), NOT by comparing
name strings — see scripts/init_user_doctor_link.py for why: name matching
meant renaming a doctor on the Referral Doctors page (or renaming the login)
silently spawned a duplicate blank roster row the next time this ran, since
the old name no longer matched anything. Once a pathologist is linked here,
that link is permanent regardless of any future rename on either side.
"""
from sqlalchemy.orm import Session
from typing import Optional


def sync_pathologist_doctors(db: Session, tenant_id: Optional[int]):
    from models.org import User, Role, ReferralDoctor

    pq = db.query(User).filter(User.role == Role.PATHOLOGIST, User.is_active.is_(True))
    if tenant_id is not None:
        pq = pq.filter(User.tenant_id == tenant_id)
    pathologists = pq.all()
    if not pathologists:
        return

    changed = False
    for u in pathologists:
        if u.referral_doctor_id:
            continue   # already linked — never touch it again based on name, renamed or not
        name = (u.full_name or u.email or "").strip()
        if not name:
            continue

        # First-time linking only: reuse an existing unlinked roster row with
        # a matching name if there is exactly one, rather than creating a
        # redundant duplicate. (Once linked, this matching never runs again
        # for this login — see the `continue` above — so a later rename on
        # either side is safe.)
        dq = db.query(ReferralDoctor).filter(ReferralDoctor.is_active.is_(True))
        if tenant_id is not None:
            dq = dq.filter(ReferralDoctor.tenant_id == tenant_id)
        candidates = [d for d in dq.all() if (d.name or "").strip().lower() == name.lower()]

        if len(candidates) == 1:
            u.referral_doctor_id = candidates[0].id
        elif len(candidates) > 1:
            # Ambiguous — pick whichever existing row actually has data
            # rather than creating yet another duplicate.
            def _score(d):
                has_data = bool(d.qualification or d.registration_no or d.signature_filename)
                return (not has_data, d.id)
            u.referral_doctor_id = sorted(candidates, key=_score)[0].id
        else:
            d = ReferralDoctor(tenant_id=tenant_id, name=name,
                                phone=getattr(u, "phone", None) or None,
                                commission_percent=0.0, is_active=True)
            db.add(d)
            db.flush()   # need d.id before we can point the login at it
            u.referral_doctor_id = d.id
        changed = True
    if changed:
        db.commit()


def pathologist_doctor_ids(db: Session, tenant_id: Optional[int]) -> set:
    """referral_doctors.id values that ARE an active pathologist login —
    used to show the "has login" badge on the Referral Doctors page."""
    from models.org import User, Role
    pq = db.query(User).filter(User.role == Role.PATHOLOGIST, User.is_active.is_(True),
                                User.referral_doctor_id.isnot(None))
    if tenant_id is not None:
        pq = pq.filter(User.tenant_id == tenant_id)
    return {u.referral_doctor_id for u in pq.all()}
