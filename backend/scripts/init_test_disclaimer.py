"""
Adds disclaimer and interpretation (free text) to test_catalog — printed
below that test's results section on the report (routers/pdf.py). Additive
+ idempotent.

    python -m scripts.init_test_disclaimer
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import text
from database import engine, Base
from models import models, org, clinical, billing, commission, b2b   # noqa: F401

PG_MIGRATIONS = [
    "ALTER TABLE test_catalog ADD COLUMN IF NOT EXISTS disclaimer TEXT",
    "ALTER TABLE test_catalog ADD COLUMN IF NOT EXISTS interpretation TEXT",
]


def main():
    print("Ensuring tables ...")
    Base.metadata.create_all(bind=engine)
    if engine.dialect.name == "postgresql":
        print("Adding test_catalog.disclaimer / interpretation columns ...")
        with engine.begin() as conn:
            for stmt in PG_MIGRATIONS:
                conn.execute(text(stmt))
        print(f"  ~ ensured {len(PG_MIGRATIONS)} migration(s)")
    else:
        print("  = non-postgres; create_all handled it")
    print("Done.")


if __name__ == "__main__":
    main()
