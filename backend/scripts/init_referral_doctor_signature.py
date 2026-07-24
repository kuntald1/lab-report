"""
Adds qualification, registration_no, and signature_filename to
referral_doctors — lets each doctor's own signature/registration print on a
report they validated, instead of one tenant-wide default. Additive +
idempotent.

    python -m scripts.init_referral_doctor_signature
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import text
from database import engine, Base
from models import models, org, clinical, billing, commission, b2b   # noqa: F401

PG_MIGRATIONS = [
    "ALTER TABLE referral_doctors ADD COLUMN IF NOT EXISTS qualification VARCHAR",
    "ALTER TABLE referral_doctors ADD COLUMN IF NOT EXISTS registration_no VARCHAR",
    "ALTER TABLE referral_doctors ADD COLUMN IF NOT EXISTS signature_filename VARCHAR",
]


def main():
    print("Ensuring tables ...")
    Base.metadata.create_all(bind=engine)
    if engine.dialect.name == "postgresql":
        print("Adding referral_doctors signature/registration columns ...")
        with engine.begin() as conn:
            for stmt in PG_MIGRATIONS:
                conn.execute(text(stmt))
        print(f"  ~ ensured {len(PG_MIGRATIONS)} migration(s)")
    else:
        print("  = non-postgres; create_all handled it")
    print("Done.")


if __name__ == "__main__":
    main()
