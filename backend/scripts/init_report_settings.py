"""
Adds `report_settings` (JSON) to `tenants` — configurable letterhead,
pathologist signature block, and report layout ("continuous" | "page_break")
for the official sample-report PDF. Additive + idempotent.

    python -m scripts.init_report_settings
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import text
from database import engine, Base
from models import models, org, clinical, billing, commission, b2b   # noqa: F401

PG_MIGRATIONS = [
    "ALTER TABLE tenants ADD COLUMN IF NOT EXISTS report_settings JSON",
]


def main():
    print("Ensuring tables ...")
    Base.metadata.create_all(bind=engine)
    if engine.dialect.name == "postgresql":
        print("Adding tenants.report_settings column ...")
        with engine.begin() as conn:
            for stmt in PG_MIGRATIONS:
                conn.execute(text(stmt))
        print(f"  ~ ensured {len(PG_MIGRATIONS)} migration(s)")
    else:
        print("  = non-postgres; create_all handled it")
    print("Done.")


if __name__ == "__main__":
    main()
