"""Request-scoped auth dependencies.

The heart of Phase 1 RBAC is `Scope` + `apply_scope`: every read query that
touches tenant data should be filtered through `apply_scope`, so visibility is
enforced at the query layer, not by hiding things in the UI.

Usage in a router:

    from auth.deps import get_current_user, get_scope, require_roles, apply_scope

    @router.get("/")
    def list_patients(db: Session = Depends(get_db), scope = Depends(get_scope)):
        q = apply_scope(db.query(Patient), Patient, scope)
        return q.all()

    @router.post("/", dependencies=[Depends(require_roles(Role.LAB_ADMIN))])
    def create_branch(...):
        ...
"""
from dataclasses import dataclass
from typing import Optional, Iterable

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session
from sqlalchemy.orm.query import Query

from database import get_db
from models.org import User, Role, TENANT_WIDE_ROLES, BRANCH_SCOPED_ROLES
from auth.security import decode_access_token

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login", auto_error=False)


def get_current_user(
    token: Optional[str] = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
) -> User:
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    payload = decode_access_token(token)
    if not payload or "sub" not in payload:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token")
    user = db.query(User).filter(User.id == int(payload["sub"])).first()
    if not user or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found or inactive")
    return user


@dataclass
class Scope:
    """Resolved visibility for the current user.

    `tenant_id is None` with role super_admin means "all tenants".
    """
    role: str
    tenant_id: Optional[int] = None
    branch_id: Optional[int] = None
    franchise_id: Optional[int] = None
    patient_id: Optional[int] = None

    @property
    def is_super_admin(self) -> bool:
        return self.role == Role.SUPER_ADMIN


def get_scope(user: User = Depends(get_current_user)) -> Scope:
    """Derive the row-level visibility filters from the user's role + anchors."""
    if user.role == Role.SUPER_ADMIN:
        return Scope(role=user.role)  # no filters — sees everything

    if user.role in TENANT_WIDE_ROLES:
        return Scope(role=user.role, tenant_id=user.tenant_id)

    if user.role in BRANCH_SCOPED_ROLES:
        return Scope(role=user.role, tenant_id=user.tenant_id, branch_id=user.branch_id)

    if user.role == Role.FRANCHISE:
        return Scope(role=user.role, tenant_id=user.tenant_id, franchise_id=user.franchise_id)

    if user.role == Role.PATIENT:
        return Scope(role=user.role, tenant_id=user.tenant_id, patient_id=user.patient_id)

    # Unknown role → see nothing.
    return Scope(role=user.role, tenant_id=-1)


def apply_scope(query: Query, model, scope: Scope) -> Query:
    """Add row-level filters to a query based on which scope columns the model has.

    Only filters that are *both* present on the model and set on the scope are
    applied, so the same helper works across every table.
    """
    if scope.is_super_admin:
        return query

    if scope.tenant_id is not None and hasattr(model, "tenant_id"):
        query = query.filter(model.tenant_id == scope.tenant_id)

    if scope.branch_id is not None and hasattr(model, "branch_id"):
        query = query.filter(model.branch_id == scope.branch_id)

    # Franchise users only see their franchise's rows. Patients carry the
    # registering franchise as `registered_franchise_id`; orders / sample_events
    # carry it as `franchise_id`.
    if scope.franchise_id is not None:
        if hasattr(model, "franchise_id"):
            query = query.filter(model.franchise_id == scope.franchise_id)
        elif hasattr(model, "registered_franchise_id"):
            query = query.filter(model.registered_franchise_id == scope.franchise_id)

    # Patient users only see their own patient row / their own results.
    if scope.patient_id is not None:
        if model.__name__ == "Patient" and hasattr(model, "id"):
            query = query.filter(model.id == scope.patient_id)
        elif hasattr(model, "patient_id"):
            query = query.filter(model.patient_id == scope.patient_id)

    return query


def require_roles(*allowed: str):
    """Dependency factory guarding an endpoint to specific roles."""
    allowed_set: Iterable[str] = set(allowed)

    def _guard(user: User = Depends(get_current_user)) -> User:
        if user.role not in allowed_set:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Role '{user.role}' is not permitted to perform this action",
            )
        return user

    return _guard
