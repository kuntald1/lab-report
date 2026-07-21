"""
Adds `validated_by` and `validated_at` to `bill_items` — tracks which doctor
validated THIS specific test, not just the patient as a whole. Fixes Validate
History showing tests validated by a DIFFERENT doctor under the wrong doctor's
history, which happened because Patient.validated_by is a single field that
gets overwritten by whoever validates last.
Additive + idempotent.

    python -m scripts.init_bill_item_validator
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import text
from database import engine, Base
from models import models, org, clinical, billing, commission   # noqa: F401

PG_MIGRATIONS = [
    "ALTER TABLE bill_items ADD COLUMN IF NOT EXISTS validated_by INTEGER",
    "ALTER TABLE bill_items ADD COLUMN IF NOT EXISTS validated_at TIMESTAMPTZ",
    "CREATE INDEX IF NOT EXISTS ix_bill_items_validated_by ON bill_items (validated_by)",
]


def main():
    print("Ensuring tables ...")
    Base.metadata.create_all(bind=engine)
    if engine.dialect.name == "postgresql":
        print("Adding bill_items.validated_by / validated_at columns ...")
        with engine.begin() as conn:
            for stmt in PG_MIGRATIONS:
                conn.execute(text(stmt))
        print(f"  ~ ensured {len(PG_MIGRATIONS)} migration(s)")
    else:
        print("  = non-postgres; create_all handled it")
    print("Done.")


if __name__ == "__main__":
    main()
