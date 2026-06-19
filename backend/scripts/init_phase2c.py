"""
Phase 2c bootstrap — clinical result flow.

Creates the new `result_amendments` table and adds the critical-threshold
columns to the existing `reference_ranges` table. Additive + idempotent.

    python -m scripts.init_phase2c
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import text, inspect
from database import engine, Base
from models import models, org, clinical   # noqa: F401

PG_MIGRATIONS = [
    "ALTER TABLE reference_ranges ADD COLUMN IF NOT EXISTS critical_low  DOUBLE PRECISION",
    "ALTER TABLE reference_ranges ADD COLUMN IF NOT EXISTS critical_high DOUBLE PRECISION",
]


def main():
    print("Creating result_amendments table (if missing) ...")
    Base.metadata.create_all(bind=engine)
    have = set(inspect(engine).get_table_names())
    print(f"  {'✓' if 'result_amendments' in have else '✗ MISSING'} result_amendments")

    if engine.dialect.name == "postgresql":
        print("Adding critical-threshold columns to reference_ranges ...")
        with engine.begin() as conn:
            for stmt in PG_MIGRATIONS:
                conn.execute(text(stmt))
        print(f"  ~ ensured {len(PG_MIGRATIONS)} column migration(s)")
    else:
        print("  = non-postgres dialect; columns created by create_all, skipping ALTER")
    print("Done.")


if __name__ == "__main__":
    main()
