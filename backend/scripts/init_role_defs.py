"""
Creates `role_defs` — the master list of role labels shown in dropdowns
(Users & Staff, Menu Permissions), so those pages stop hardcoding their own
copy of the role list. Seeds it with the roles the backend actually
recognizes for scoping/authorization; only the LABEL and active flag are
editable from the new Roles admin page, not the underlying key — a role key
the backend doesn't recognize can't be granted any permissions, so this
intentionally does not support inventing brand-new role keys.
Additive + idempotent.

    python -m scripts.init_role_defs
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from database import engine, Base, SessionLocal
from models import models, org, clinical, billing, commission   # noqa: F401
from models.org import RoleDef

SEED = [
    ("super_admin",  "Super Admin", 0),
    ("lab_admin",    "Lab Admin", 1),
    ("pathologist",  "Doctor (Pathologist)", 2),
    ("technician",   "Staff — Technician", 3),
    ("receptionist", "Staff — Receptionist", 4),
    ("phlebotomist", "Staff — Phlebotomist", 5),
    ("franchise",    "Organization login", 6),
    ("patient",      "Patient login", 7),
]


def main():
    print("Ensuring tables ...")
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        added = 0
        for key, label, order in SEED:
            if not db.query(RoleDef).filter(RoleDef.role_key == key).first():
                db.add(RoleDef(role_key=key, label=label, is_active=True, sort_order=order))
                added += 1
        db.commit()
        print(f"  ~ seeded {added} role(s) (already-present ones left untouched)")
    finally:
        db.close()
    print("Done.")


if __name__ == "__main__":
    main()
