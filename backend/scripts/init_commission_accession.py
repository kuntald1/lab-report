"""
Adds `accession_number` to `doctor_commissions`, so My Commission / doctor
ledgers can show which specific test/tube a commission line came from.
Additive + idempotent.

    python -m scripts.init_commission_accession
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import text
from database import engine, Base
from models import models, org, clinical, billing, commission   # noqa: F401

PG_MIGRATIONS = [
    "ALTER TABLE doctor_commissions ADD COLUMN IF NOT EXISTS accession_number VARCHAR",
    "CREATE INDEX IF NOT EXISTS ix_doctor_commissions_accession_number ON doctor_commissions (accession_number)",
]


def main():
    print("Ensuring tables ...")
    Base.metadata.create_all(bind=engine)
    if engine.dialect.name == "postgresql":
        print("Adding doctor_commissions.accession_number column ...")
        with engine.begin() as conn:
            for stmt in PG_MIGRATIONS:
                conn.execute(text(stmt))
        print(f"  ~ ensured {len(PG_MIGRATIONS)} migration(s)")
    else:
        print("  = non-postgres; create_all handled it")
    print("Done.")


if __name__ == "__main__":
    main()
