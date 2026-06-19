"""
Phase 3 bootstrap — patient-centric sample lifecycle.

Adds the `status` column to the existing `patients` table. Additive + idempotent.

    python -m scripts.init_phase3
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import text
from database import engine, Base
from models import models, org, clinical   # noqa: F401

PG_MIGRATIONS = [
    "ALTER TABLE patients ADD COLUMN IF NOT EXISTS status VARCHAR",
    "CREATE INDEX IF NOT EXISTS ix_patients_status ON patients (status)",
]


def main():
    print("Ensuring tables ...")
    Base.metadata.create_all(bind=engine)
    if engine.dialect.name == "postgresql":
        print("Adding status column to patients ...")
        with engine.begin() as conn:
            for stmt in PG_MIGRATIONS:
                conn.execute(text(stmt))
        print(f"  ~ ensured {len(PG_MIGRATIONS)} migration(s)")
    else:
        print("  = non-postgres; create_all handled it")
    print("Done.")


if __name__ == "__main__":
    main()
