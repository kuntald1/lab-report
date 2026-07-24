"""Organisation administration — demonstrates the RBAC + scope enforcement.

Every create assigns the tenant from the *creator's* scope (a lab_admin can
never create rows in another tenant), and every list goes through apply_scope.
"""
from fastapi import APIRouter, Depends, HTTPException, Request, status, UploadFile, File, Form
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional, List
import os, uuid

from database import get_db
from models.org import Tenant, Branch, Franchise, User, AuditLog, Role, ROLES, RoleMenuConfig
from auth.security import hash_password
from auth.deps import get_current_user, get_scope, require_roles, apply_scope, Scope
from auth.audit import write_audit
from services.report_settings import get_report_settings, DEFAULT_REPORT_SETTINGS, asset_path, asset_url

router = APIRouter()

_ALLOWED_IMAGE_EXT = {".png", ".jpg", ".jpeg", ".webp"}
_MAX_UPLOAD_BYTES = 3 * 1024 * 1024   # 3 MB — a logo/signature has no business being bigger


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


# --------------------------------------------------------------------------- report settings
# Letterhead / pathologist-signature / layout config for the official sample
# report PDF (routers/pdf.py). Stored as Tenant.report_settings (JSON); GET
# always returns the full effective settings (defaults merged with overrides)
# so the admin UI never has to know the default values itself. PUT is a
# partial update — only the keys sent are changed, everything else is kept.
class ReportSettingsUpdate(BaseModel):
    layout: Optional[str] = None                     # "continuous" | "page_break"
    lab_name: Optional[str] = None
    tagline: Optional[str] = None
    unit_of: Optional[str] = None
    address_lines: Optional[List[str]] = None
    phones: Optional[List[str]] = None
    email: Optional[str] = None
    website: Optional[str] = None
    pathologist_name: Optional[str] = None
    pathologist_qualification: Optional[str] = None
    registration_no: Optional[str] = None


@router.get("/report-settings", dependencies=[Depends(require_roles(Role.SUPER_ADMIN, Role.LAB_ADMIN))])
def get_report_settings_route(db: Session = Depends(get_db), scope: Scope = Depends(get_scope)):
    tenant = db.query(Tenant).filter(Tenant.id == scope.tenant_id).first() if scope.tenant_id else None
    return get_report_settings(tenant)


@router.put("/report-settings", dependencies=[Depends(require_roles(Role.SUPER_ADMIN, Role.LAB_ADMIN))])
def update_report_settings(payload: ReportSettingsUpdate, request: Request,
                            db: Session = Depends(get_db), user: User = Depends(get_current_user),
                            scope: Scope = Depends(get_scope)):
    if not scope.tenant_id:
        raise HTTPException(status_code=400, detail="No tenant in scope")
    tenant = db.query(Tenant).filter(Tenant.id == scope.tenant_id).first()
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")
    if payload.layout and payload.layout not in ("continuous", "page_break"):
        raise HTTPException(status_code=400, detail="layout must be 'continuous' or 'page_break'")
    current = dict(tenant.report_settings or {})
    updates = {k: v for k, v in payload.model_dump().items() if v is not None}
    current.update(updates)
    tenant.report_settings = current
    db.commit()
    write_audit(db, action="update", user=user, entity="report_settings", entity_id=tenant.id,
                after=updates, ip=_ip(request))
    return get_report_settings(tenant)


@router.post("/report-settings/upload", dependencies=[Depends(require_roles(Role.SUPER_ADMIN, Role.LAB_ADMIN))])
async def upload_report_asset(
    kind: str = Form(...),   # "logo" | "signature"
    file: UploadFile = File(...),
    request: Request = None,
    db: Session = Depends(get_db), user: User = Depends(get_current_user),
    scope: Scope = Depends(get_scope),
):
    """Upload a lab logo or pathologist signature image. Stored on disk
    (Docker named volume report_assets_data) and referenced from
    Tenant.report_settings by filename — see services/report_settings.py."""
    if kind not in ("logo", "signature"):
        raise HTTPException(status_code=400, detail="kind must be 'logo' or 'signature'")
    if not scope.tenant_id:
        raise HTTPException(status_code=400, detail="No tenant in scope")
    tenant = db.query(Tenant).filter(Tenant.id == scope.tenant_id).first()
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")

    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in _ALLOWED_IMAGE_EXT:
        raise HTTPException(status_code=400, detail=f"Unsupported file type '{ext}'. Use PNG, JPG or WEBP.")
    body = await file.read()
    if len(body) > _MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=400, detail="File too large (max 3 MB)")

    filename = f"tenant_{tenant.id}_{kind}_{uuid.uuid4().hex[:8]}{ext}"
    with open(asset_path(filename), "wb") as f:
        f.write(body)

    current = dict(tenant.report_settings or {})
    old_filename = current.get(f"{kind}_filename")
    current[f"{kind}_filename"] = filename
    tenant.report_settings = current
    db.commit()

    # Best-effort cleanup of the file it's replacing.
    if old_filename:
        try:
            os.remove(asset_path(old_filename))
        except OSError:
            pass

    write_audit(db, action="upload", user=user, entity="report_settings", entity_id=tenant.id,
                after={f"{kind}_filename": filename}, ip=_ip(request) if request else None)
    return {**get_report_settings(tenant), f"{kind}_url": asset_url(filename)}


@router.delete("/report-settings/{kind}", dependencies=[Depends(require_roles(Role.SUPER_ADMIN, Role.LAB_ADMIN))])
def reset_report_asset(kind: str, request: Request,
                        db: Session = Depends(get_db), user: User = Depends(get_current_user),
                        scope: Scope = Depends(get_scope)):
    """Remove an uploaded logo/signature and fall back to the default."""
    if kind not in ("logo", "signature"):
        raise HTTPException(status_code=400, detail="kind must be 'logo' or 'signature'")
    if not scope.tenant_id:
        raise HTTPException(status_code=400, detail="No tenant in scope")
    tenant = db.query(Tenant).filter(Tenant.id == scope.tenant_id).first()
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")
    current = dict(tenant.report_settings or {})
    old_filename = current.pop(f"{kind}_filename", None)
    tenant.report_settings = current
    db.commit()
    if old_filename:
        try:
            os.remove(asset_path(old_filename))
        except OSError:
            pass
    write_audit(db, action="reset", user=user, entity="report_settings", entity_id=tenant.id,
                after={f"{kind}_filename": None}, ip=_ip(request))
    return get_report_settings(tenant)


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


class BranchUpdate(BaseModel):
    name:      Optional[str] = None
    code:      Optional[str] = None
    address:   Optional[str] = None
    is_main:   Optional[bool] = None
    is_active: Optional[bool] = None


@router.put("/branches/{branch_id}", dependencies=[Depends(require_roles(Role.SUPER_ADMIN, Role.LAB_ADMIN))])
def update_branch(branch_id: int, payload: BranchUpdate, request: Request,
                  db: Session = Depends(get_db), user: User = Depends(get_current_user),
                  scope: Scope = Depends(get_scope)):
    b = apply_scope(db.query(Branch), Branch, scope).filter(Branch.id == branch_id).first()
    if not b:
        raise HTTPException(status_code=404, detail="Branch not found")
    data = payload.model_dump(exclude_unset=True)
    for field, value in data.items():
        setattr(b, field, value)
    db.commit(); db.refresh(b)
    write_audit(db, action="update", user=user, entity="branch", entity_id=b.id,
                after=data, ip=_ip(request))
    return b


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
    email: str
    password: str
    full_name: Optional[str] = None
    phone: Optional[str] = None
    role: str
    tenant_id: Optional[int] = None
    branch_id: Optional[int] = None
    franchise_id: Optional[int] = None
    patient_id: Optional[int] = None
    department_id: Optional[int] = None


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
        phone=payload.phone,
        hashed_password=hash_password(payload.password),
        role=payload.role,
        tenant_id=tenant_id,
        branch_id=payload.branch_id,
        franchise_id=payload.franchise_id,
        patient_id=payload.patient_id,
        department_id=payload.department_id,
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
             "phone": u.phone,
             "tenant_id": u.tenant_id, "branch_id": u.branch_id,
             "franchise_id": u.franchise_id, "department_id": u.department_id,
             "is_active": u.is_active} for u in rows]


class UserUpdate(BaseModel):
    full_name: Optional[str] = None
    phone: Optional[str] = None
    role: Optional[str] = None
    franchise_id: Optional[int] = None
    branch_id: Optional[int] = None
    department_id: Optional[int] = None
    is_active: Optional[bool] = None
    password: Optional[str] = None        # if provided, resets the password


@router.put("/users/{user_id}", dependencies=[Depends(require_roles(Role.SUPER_ADMIN, Role.LAB_ADMIN))])
def update_user(user_id: int, payload: UserUpdate, request: Request,
                db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    target = db.query(User).filter(User.id == user_id).first()
    if not target:
        raise HTTPException(status_code=404, detail="user not found")
    # lab_admin may only touch users in its own tenant, and not admins
    if user.role == Role.LAB_ADMIN:
        if target.tenant_id != user.tenant_id:
            raise HTTPException(status_code=403, detail="outside your tenant")
        if target.role in (Role.SUPER_ADMIN, Role.LAB_ADMIN):
            raise HTTPException(status_code=403, detail="cannot edit that role")
    if payload.role is not None:
        if payload.role not in ROLES:
            raise HTTPException(status_code=400, detail="unknown role")
        if user.role == Role.LAB_ADMIN and payload.role in (Role.SUPER_ADMIN, Role.LAB_ADMIN):
            raise HTTPException(status_code=403, detail="cannot assign that role")
        target.role = payload.role
    if payload.full_name is not None:    target.full_name = payload.full_name
    if payload.phone is not None:        target.phone = payload.phone
    if payload.franchise_id is not None: target.franchise_id = payload.franchise_id
    if payload.branch_id is not None:    target.branch_id = payload.branch_id
    if payload.department_id is not None: target.department_id = payload.department_id
    if payload.is_active is not None:    target.is_active = payload.is_active
    if payload.password:                 target.hashed_password = hash_password(payload.password)
    db.commit(); db.refresh(target)
    write_audit(db, action="update", user=user, entity="user", entity_id=target.id,
                after={"role": target.role, "is_active": target.is_active}, ip=_ip(request))
    return {"id": target.id, "email": target.email, "role": target.role,
            "full_name": target.full_name, "is_active": target.is_active}


@router.delete("/users/{user_id}", dependencies=[Depends(require_roles(Role.SUPER_ADMIN, Role.LAB_ADMIN))])
def delete_user(user_id: int, request: Request,
                db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    target = db.query(User).filter(User.id == user_id).first()
    if not target:
        raise HTTPException(status_code=404, detail="user not found")
    if target.id == user.id:
        raise HTTPException(status_code=400, detail="you cannot delete your own login")
    if user.role == Role.LAB_ADMIN:
        if target.tenant_id != user.tenant_id:
            raise HTTPException(status_code=403, detail="outside your tenant")
        if target.role in (Role.SUPER_ADMIN, Role.LAB_ADMIN):
            raise HTTPException(status_code=403, detail="cannot delete that role")
    target.is_active = False
    db.commit()
    write_audit(db, action="delete", user=user, entity="user", entity_id=target.id,
                after={"is_active": False}, ip=_ip(request))
    return {"id": target.id, "is_active": False}


# --------------------------------------------------------------------------- audit
@router.get("/audit", dependencies=[Depends(require_roles(Role.SUPER_ADMIN, Role.LAB_ADMIN))])
def list_audit(db: Session = Depends(get_db), scope: Scope = Depends(get_scope), limit: int = 100):
    q = db.query(AuditLog)
    if not scope.is_super_admin and scope.tenant_id is not None:
        q = q.filter(AuditLog.tenant_id == scope.tenant_id)
    return q.order_by(AuditLog.id.desc()).limit(min(limit, 500)).all()


# --------------------------------------------------------------------------- roles (master list backing dropdowns)
_ROLE_SEED = [
    ("super_admin",  "Super Admin", 0),
    ("lab_admin",    "Lab Admin", 1),
    ("pathologist",  "Doctor (Pathologist)", 2),
    ("technician",   "Staff — Technician", 3),
    ("receptionist", "Staff — Receptionist", 4),
    ("phlebotomist", "Staff — Phlebotomist", 5),
    ("franchise",    "Organization login", 6),
    ("patient",      "Patient login", 7),
]


@router.get("/roles")
def list_roles(db: Session = Depends(get_db), user: User = Depends(get_current_user), active_only: bool = True):
    """Used by Users & Staff, Menu Permissions, etc. instead of each page hardcoding its own role list."""
    from models.org import RoleDef
    # self-heal: main.py's create_all() creates this table empty on any deploy even if the
    # dedicated seed script was never run — seed it lazily here so the page never shows blank.
    if db.query(RoleDef).count() == 0:
        for key, label, order in _ROLE_SEED:
            if not db.query(RoleDef).filter(RoleDef.role_key == key).first():
                db.add(RoleDef(role_key=key, label=label, is_active=True, sort_order=order))
        db.commit()
    q = db.query(RoleDef)
    if active_only:
        q = q.filter(RoleDef.is_active.is_(True))
    rows = q.order_by(RoleDef.sort_order, RoleDef.role_key).all()
    return [{"role_key": r.role_key, "label": r.label, "is_active": r.is_active} for r in rows]


class RoleDefUpdate(BaseModel):
    label: Optional[str] = None
    is_active: Optional[bool] = None


@router.put("/roles/{role_key}", dependencies=[Depends(require_roles(Role.SUPER_ADMIN, Role.LAB_ADMIN))])
def update_role_def(role_key: str, payload: RoleDefUpdate, db: Session = Depends(get_db)):
    """Rename a role's display label, or hide it from pickers. Cannot create a new
    role KEY here — see RoleDef's docstring for why that would be unsafe."""
    from models.org import RoleDef
    r = db.query(RoleDef).filter(RoleDef.role_key == role_key).first()
    if not r:
        raise HTTPException(status_code=404, detail="unknown role key")
    if role_key in (Role.SUPER_ADMIN,) and payload.is_active is False:
        raise HTTPException(status_code=400, detail="super_admin cannot be deactivated")
    if payload.label is not None:
        r.label = payload.label
    if payload.is_active is not None:
        r.is_active = payload.is_active
    db.commit(); db.refresh(r)
    return {"role_key": r.role_key, "label": r.label, "is_active": r.is_active}


# --------------------------------------------------------------------------- menu visibility (per role)
# Roles admin can restrict from here. super_admin and lab_admin ALWAYS see
# everything — they're intentionally excluded, never editable, never queried.
CONFIGURABLE_ROLES = [Role.PATHOLOGIST, Role.TECHNICIAN, Role.RECEPTIONIST, Role.PHLEBOTOMIST, Role.FRANCHISE]


@router.get("/menu-config", dependencies=[Depends(require_roles(Role.SUPER_ADMIN, Role.LAB_ADMIN))])
def get_menu_config(db: Session = Depends(get_db)):
    """Full matrix for the Menu Permissions page: {role: [hidden_menu_key, ...]}."""
    rows = db.query(RoleMenuConfig).filter(RoleMenuConfig.role.in_(CONFIGURABLE_ROLES)).all()
    by_role = {r.role: (r.hidden_keys or []) for r in rows}
    return {role: by_role.get(role, []) for role in CONFIGURABLE_ROLES}


class MenuConfigIn(BaseModel):
    hidden_keys: List[str] = []


@router.put("/menu-config/{role}", dependencies=[Depends(require_roles(Role.SUPER_ADMIN, Role.LAB_ADMIN))])
def set_menu_config(role: str, payload: MenuConfigIn, request: Request,
                    db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    if role not in CONFIGURABLE_ROLES:
        raise HTTPException(status_code=400, detail=f"role must be one of {CONFIGURABLE_ROLES}")
    row = db.query(RoleMenuConfig).filter(RoleMenuConfig.role == role).first()
    if not row:
        row = RoleMenuConfig(role=role, hidden_keys=[])
        db.add(row)
    before = row.hidden_keys
    row.hidden_keys = payload.hidden_keys
    db.commit()
    write_audit(db, action="update", user=user, entity="role_menu_config", entity_id=role,
                before={"hidden_keys": before}, after={"hidden_keys": row.hidden_keys},
                ip=_ip(request))
    return {"role": role, "hidden_keys": row.hidden_keys}


@router.get("/my-menu-hidden")
def my_menu_hidden(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Used by the Sidebar: which menu keys should be hidden for the CURRENT
    user's role. super_admin/lab_admin always get an empty list (full menu)."""
    if user.role in (Role.SUPER_ADMIN, Role.LAB_ADMIN):
        return {"hidden_keys": []}
    row = db.query(RoleMenuConfig).filter(RoleMenuConfig.role == user.role).first()
    return {"hidden_keys": (row.hidden_keys if row else []) or []}


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
