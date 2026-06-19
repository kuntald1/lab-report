"""
Phase 2 bootstrap — creates the clinical tables (departments, test_catalog,
packages, package_tests, reference_ranges, orders, order_items, sample_events).

All Phase 2 tables are brand new, so create_all() makes them cleanly without any
ALTER on existing tables.

    python -m scripts.init_phase2
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import inspect
from database import engine, Base
from models import models, org, clinical   # noqa: F401  register all tables

NEW_TABLES = ["departments", "test_catalog", "packages", "package_tests",
              "reference_ranges", "orders", "order_items", "sample_events"]


def main():
    print("Creating Phase 2 clinical tables ...")
    Base.metadata.create_all(bind=engine)
    have = set(inspect(engine).get_table_names())
    for t in NEW_TABLES:
        print(f"  {'✓' if t in have else '✗ MISSING'} {t}")
    print("Done.")


if __name__ == "__main__":
    main()
