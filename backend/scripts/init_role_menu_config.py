"""
Creates `role_menu_config` — which sidebar menu items are hidden per role,
managed from the new Menu Permissions admin page. Additive + idempotent.
(Table-level; Base.metadata.create_all handles table creation directly since
this is a brand new table, no ALTER needed.)

    python -m scripts.init_role_menu_config
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from database import engine, Base
from models import models, org, clinical, billing, commission   # noqa: F401


def main():
    print("Ensuring tables (creates role_menu_config if missing) ...")
    Base.metadata.create_all(bind=engine)
    print("Done.")


if __name__ == "__main__":
    main()
