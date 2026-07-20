"""
Adds `department_id` to `users` — a User belongs to a Department (not Role),
since two users sharing the same role (e.g. two technicians) can work in
different lab sections. Additive + idempotent.

    python -m scripts.init_user_department
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import text
from database import engine, Base
from models import models, org, clinical, billing, commission   # noqa: F401

PG_MIGRATIONS = [
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS department_id INTEGER",
    "CREATE INDEX IF NOT EXISTS ix_users_department_id ON users (department_id)",
]


def main():
    print("Ensuring tables ...")
    Base.metadata.create_all(bind=engine)
    if engine.dialect.name == "postgresql":
        print("Adding users.department_id column ...")
        with engine.begin() as conn:
            for stmt in PG_MIGRATIONS:
                conn.execute(text(stmt))
        print(f"  ~ ensured {len(PG_MIGRATIONS)} migration(s)")
    else:
        print("  = non-postgres; create_all handled it")
    print("Done.")


if __name__ == "__main__":
    main()
