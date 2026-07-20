"""
Adds `note` to `lab_results` — a free-text note shown at the end of the report
only when present, editable by both admin and the validating doctor.
Additive + idempotent.

    python -m scripts.init_result_note
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import text
from database import engine, Base
from models import models, org, clinical, billing, commission   # noqa: F401

PG_MIGRATIONS = [
    "ALTER TABLE lab_results ADD COLUMN IF NOT EXISTS note TEXT",
]


def main():
    print("Ensuring tables ...")
    Base.metadata.create_all(bind=engine)
    if engine.dialect.name == "postgresql":
        print("Adding lab_results.note column ...")
        with engine.begin() as conn:
            for stmt in PG_MIGRATIONS:
                conn.execute(text(stmt))
        print(f"  ~ ensured {len(PG_MIGRATIONS)} migration(s)")
    else:
        print("  = non-postgres; create_all handled it")
    print("Done.")


if __name__ == "__main__":
    main()
