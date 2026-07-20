"""
Adds `accession_number` to `bill_items` and `lab_results`. Additive + idempotent.

    python -m scripts.init_accession_no
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import text
from database import engine, Base
from models import models, org, clinical, billing   # noqa: F401

PG_MIGRATIONS = [
    "ALTER TABLE bill_items ADD COLUMN IF NOT EXISTS accession_number VARCHAR",
    "CREATE INDEX IF NOT EXISTS ix_bill_items_accession_number ON bill_items (accession_number)",
    "ALTER TABLE lab_results ADD COLUMN IF NOT EXISTS accession_number VARCHAR",
    "CREATE INDEX IF NOT EXISTS ix_lab_results_accession_number ON lab_results (accession_number)",
]


def main():
    print("Ensuring tables ...")
    Base.metadata.create_all(bind=engine)
    if engine.dialect.name == "postgresql":
        print("Adding accession_number columns ...")
        with engine.begin() as conn:
            for stmt in PG_MIGRATIONS:
                conn.execute(text(stmt))
        print(f"  ~ ensured {len(PG_MIGRATIONS)} migration(s)")
    else:
        print("  = non-postgres; create_all handled it")
    print("Done.")


if __name__ == "__main__":
    main()
