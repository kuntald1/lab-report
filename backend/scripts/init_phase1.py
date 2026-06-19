"""
Phase 1 bootstrap — run once after deploying the new code.

    python -m scripts.init_phase1        (from the backend/ directory)
    # or inside docker:
    docker compose exec backend python -m scripts.init_phase1

It is idempotent: re-running it will not duplicate the tenant or users, and
will only backfill rows that are still unscoped.

Override the seeded credentials with env vars:
    SEED_SUPERADMIN_EMAIL / SEED_SUPERADMIN_PASSWORD
    SEED_LABADMIN_EMAIL   / SEED_LABADMIN_PASSWORD
"""
import os
import sys

# Allow running as `python -m scripts.init_phase1` or `python scripts/init_phase1.py`
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from database import engine, Base, SessionLocal
from models import models as core_models   # noqa: F401  registers core tables
from models import org as org_models        # noqa: F401  registers org tables
from models.org import Tenant, Branch, User, Role
from models.models import Patient, Device, LabResult
from auth.security import hash_password


def get_or_create_tenant(db):
    tenant = db.query(Tenant).filter(Tenant.slug == "default").first()
    if not tenant:
        tenant = Tenant(name="Default Lab", slug="default", gst_exempt=True)
        db.add(tenant); db.commit(); db.refresh(tenant)
        print(f"  + created tenant id={tenant.id} (Default Lab)")
    else:
        print(f"  = tenant already exists id={tenant.id}")
    return tenant


def get_or_create_main_branch(db, tenant):
    branch = db.query(Branch).filter(Branch.tenant_id == tenant.id, Branch.is_main == True).first()
    if not branch:
        branch = Branch(tenant_id=tenant.id, name="Main Lab", code="MAIN", is_main=True)
        db.add(branch); db.commit(); db.refresh(branch)
        print(f"  + created main branch id={branch.id}")
    else:
        print(f"  = main branch already exists id={branch.id}")
    return branch


def get_or_create_user(db, email, password, role, tenant_id=None, branch_id=None):
    email = email.lower()
    user = db.query(User).filter(User.email == email).first()
    if user:
        print(f"  = user already exists {email} ({user.role})")
        return user
    user = User(
        email=email, full_name=role.replace("_", " ").title(),
        hashed_password=hash_password(password), role=role,
        tenant_id=tenant_id, branch_id=branch_id,
    )
    db.add(user); db.commit(); db.refresh(user)
    print(f"  + created user {email} ({role}) — password: {password}")
    return user


def backfill(db, tenant, branch):
    total = 0
    for model, set_branch in ((Patient, True), (Device, True), (LabResult, True)):
        rows = db.query(model).filter(model.tenant_id.is_(None)).all()
        for r in rows:
            r.tenant_id = tenant.id
            if set_branch and hasattr(r, "branch_id") and r.branch_id is None:
                r.branch_id = branch.id
        if rows:
            db.commit()
            print(f"  ~ backfilled {len(rows):>4} {model.__tablename__} row(s) into tenant {tenant.id}")
            total += len(rows)
    if total == 0:
        print("  = nothing to backfill (all rows already scoped)")


def main():
    print("Creating any missing tables ...")
    Base.metadata.create_all(bind=engine)

    db = SessionLocal()
    try:
        print("Seeding default tenant + branch ...")
        tenant = get_or_create_tenant(db)
        branch = get_or_create_main_branch(db, tenant)

        print("Seeding users ...")
        get_or_create_user(
            db,
            os.getenv("SEED_SUPERADMIN_EMAIL", "superadmin@medicloud.local"),
            os.getenv("SEED_SUPERADMIN_PASSWORD", "ChangeMe!123"),
            Role.SUPER_ADMIN,
        )
        get_or_create_user(
            db,
            os.getenv("SEED_LABADMIN_EMAIL", "admin@medicloud.local"),
            os.getenv("SEED_LABADMIN_PASSWORD", "ChangeMe!123"),
            Role.LAB_ADMIN, tenant_id=tenant.id, branch_id=branch.id,
        )

        print("Backfilling existing analyser data ...")
        backfill(db, tenant, branch)

        print("\nDone. Log in at POST /api/auth/login with the seeded credentials.")
        print("IMPORTANT: change the seeded passwords immediately in production.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
