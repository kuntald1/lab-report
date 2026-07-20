"""
Adds `status` to `bill_items` (per-test status, e.g. 'collected'/'tested'/...),
used by the "Change Report Status" screen to track each test/accession
independently instead of one status per patient. Additive + idempotent.

    python -m scripts.init_bill_item_status
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import text
from database import engine, Base
from models import models, org, clinical, billing   # noqa: F401

PG_MIGRATIONS = [
    "ALTER TABLE bill_items ADD COLUMN IF NOT EXISTS status VARCHAR DEFAULT 'collected'",
    "UPDATE bill_items SET status = 'collected' WHERE status IS NULL",
    "CREATE INDEX IF NOT EXISTS ix_bill_items_status ON bill_items (status)",
]


def main():
    print("Ensuring tables ...")
    Base.metadata.create_all(bind=engine)
    if engine.dialect.name == "postgresql":
        print("Adding bill_items.status column ...")
        with engine.begin() as conn:
            for stmt in PG_MIGRATIONS:
                conn.execute(text(stmt))
        print(f"  ~ ensured {len(PG_MIGRATIONS)} migration(s)")
    else:
        print("  = non-postgres; create_all handled it")
    print("Done.")


if __name__ == "__main__":
    main()
