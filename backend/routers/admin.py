"""Organisation administration — demonstrates the RBAC + scope enforcement.

Every create assigns the tenant from the *creator's* scope (a lab_admin can
never create rows in another tenant), and every list goes through apply_scope.
"""
from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session
from pydantic import BaseModel, EmailStr
from typing import Optional

from database import get_db
from models.org import Tenant, Branch, Franchise, User, AuditLog, Role, ROLES
from auth.security import hash_password
from auth.deps import get_current_user, get_scope, require_roles, apply_scope, Scope
from auth.audit import write_audit

router = APIRouter()


# --------------------------------------------------------------------------- tenants
class TenantCreate(BaseModel):
    name: str
    slug: str
    gst_exempt: bool = True


@router.post("/tenants", dependencies=[Depends(require_roles(Role.SUPER_ADMIN))])
def create_tenant(payload: TenantCreate, request: Request,
                  db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    if db.query(Tenant).filter(Tenant.slug == payload.slug).first():
        raise HTTPException(status_code=400, detail="Slug already exists")
    tenant = Tenant(**payload.model_dump())
    db.add(tenant); db.commit(); db.refresh(tenant)
    write_audit(db, action="create", user=user, entity="tenant", entity_id=tenant.id,
                after=payload.model_dump(), ip=_ip(request))
    return tenant


@router.get("/tenants", dependencies=[Depends(require_roles(Role.SUPER_ADMIN))])
def list_tenants(db: Session = Depends(get_db)):
    return db.query(Tenant).order_by(Tenant.id).all()


# --------------------------------------------------------------------------- branches
class BranchCreate(BaseModel):
    name: str
    code: Optional[str] = None
    address: Optional[str] = None
    is_main: bool = False
    tenant_id: Optional[int] = None   # super_admin may set it; lab_admin inherits own


@router.post("/branches", dependencies=[Depends(require_roles(Role.SUPER_ADMIN, Role.LAB_ADMIN))])
def create_branch(payload: BranchCreate, request: Request,
                  db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    tenant_id = _resolve_tenant(user, payload.tenant_id)
    branch = Branch(
        tenant_id=tenant_id, name=payload.name, code=payload.code,
        address=payload.address, is_main=payload.is_main,
    )
    db.add(branch); db.commit(); db.refresh(branch)
    write_audit(db, action="create", user=user, entity="branch", entity_id=branch.id,
                after={"name": branch.name, "tenant_id": tenant_id}, ip=_ip(request))
    return branch


@router.get("/branches")
def list_branches(db: Session = Depends(get_db), scope: Scope = Depends(get_scope)):
    return apply_scope(db.query(Branch), Branch, scope).order_by(Branch.id).all()


# --------------------------------------------------------------------------- franchises
class FranchiseCreate(BaseModel):
    name: str
    code: Optional[str] = None
    address: Optional[str] = None
    commission_model: str = "margin"      # "margin" | "commission"
    commission_rate: int = 0
    pan: Optional[str] = None
    credit_limit: int = 0
    tenant_id: Optional[int] = None


@router.post("/franchises", dependencies=[Depends(require_roles(Role.SUPER_ADMIN, Role.LAB_ADMIN))])
def create_franchise(payload: FranchiseCreate, request: Request,
                     db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    if payload.commission_model not in ("margin", "commission"):
        raise HTTPException(status_code=400, detail="commission_model must be 'margin' or 'commission'")
    tenant_id = _resolve_tenant(user, payload.tenant_id)
    data = payload.model_dump(); data.pop("tenant_id", None)
    franchise = Franchise(tenant_id=tenant_id, **data)
    db.add(franchise); db.commit(); db.refresh(franchise)
    write_audit(db, action="create", user=user, entity="franchise", entity_id=franchise.id,
                after={"name": franchise.name, "model": franchise.commission_model}, ip=_ip(request))
    return franchise


@router.get("/franchises")
def list_franchises(db: Session = Depends(get_db), scope: Scope = Depends(get_scope)):
    q = db.query(Franchise)
    if not scope.is_super_admin and scope.tenant_id is not None:
        q = q.filter(Franchise.tenant_id == scope.tenant_id)
    if scope.role == Role.FRANCHISE and scope.franchise_id is not None:
        q = q.filter(Franchise.id == scope.franchise_id)
    return q.order_by(Franchise.id).all()


# --------------------------------------------------------------------------- users
class UserCreate(BaseModel):
    email: EmailStr
    password: str
    full_name: Optional[str] = None
    role: str
    tenant_id: Optional[int] = None
    branch_id: Optional[int] = None
    franchise_id: Optional[int] = None
    patient_id: Optional[int] = None


@router.post("/users", dependencies=[Depends(require_roles(Role.SUPER_ADMIN, Role.LAB_ADMIN))])
def create_user(payload: UserCreate, request: Request,
                db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    if payload.role not in ROLES:
        raise HTTPException(status_code=400, detail=f"Unknown role; allowed: {sorted(ROLES)}")
    # A lab_admin may only create users inside their own tenant, and may not mint
    # super_admins or other lab_admins.
    if user.role == Role.LAB_ADMIN:
        if payload.role in (Role.SUPER_ADMIN, Role.LAB_ADMIN):
            raise HTTPException(status_code=403, detail="lab_admin cannot create that role")
        tenant_id = user.tenant_id
    else:  # super_admin
        tenant_id = payload.tenant_id
    if db.query(User).filter(User.email == payload.email.lower()).first():
        raise HTTPException(status_code=400, detail="Email already registered")

    new_user = User(
        email=str(payload.email).lower(),
        full_name=payload.full_name,
        hashed_password=hash_password(payload.password),
        role=payload.role,
        tenant_id=tenant_id,
        branch_id=payload.branch_id,
        franchise_id=payload.franchise_id,
        patient_id=payload.patient_id,
    )
    db.add(new_user); db.commit(); db.refresh(new_user)
    write_audit(db, action="create", user=user, entity="user", entity_id=new_user.id,
                after={"email": new_user.email, "role": new_user.role, "tenant_id": tenant_id},
                ip=_ip(request))
    return {"id": new_user.id, "email": new_user.email, "role": new_user.role,
            "tenant_id": new_user.tenant_id}


@router.get("/users")
def list_users(db: Session = Depends(get_db), scope: Scope = Depends(get_scope)):
    q = db.query(User)
    if not scope.is_super_admin and scope.tenant_id is not None:
        q = q.filter(User.tenant_id == scope.tenant_id)
    rows = q.order_by(User.id).all()
    return [{"id": u.id, "email": u.email, "role": u.role, "full_name": u.full_name,
             "tenant_id": u.tenant_id, "branch_id": u.branch_id,
             "franchise_id": u.franchise_id, "is_active": u.is_active} for u in rows]


# --------------------------------------------------------------------------- audit
@router.get("/audit", dependencies=[Depends(require_roles(Role.SUPER_ADMIN, Role.LAB_ADMIN))])
def list_audit(db: Session = Depends(get_db), scope: Scope = Depends(get_scope), limit: int = 100):
    q = db.query(AuditLog)
    if not scope.is_super_admin and scope.tenant_id is not None:
        q = q.filter(AuditLog.tenant_id == scope.tenant_id)
    return q.order_by(AuditLog.id.desc()).limit(min(limit, 500)).all()


# --------------------------------------------------------------------------- helpers
def _ip(request: Request) -> Optional[str]:
    return request.client.host if request.client else None


def _resolve_tenant(user: User, requested: Optional[int]) -> int:
    """lab_admin is pinned to their own tenant; super_admin must name one."""
    if user.role == Role.LAB_ADMIN:
        if user.tenant_id is None:
            raise HTTPException(status_code=400, detail="lab_admin has no tenant assigned")
        return user.tenant_id
    if requested is None:
        raise HTTPException(status_code=400, detail="super_admin must supply tenant_id")
    return requested
