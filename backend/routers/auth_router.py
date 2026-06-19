from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session
from pydantic import BaseModel, EmailStr
from typing import Optional

from database import get_db
from models.org import User
from auth.security import verify_password, create_access_token
from auth.deps import get_current_user, get_scope, Scope
from auth.audit import write_audit

router = APIRouter()


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class UserOut(BaseModel):
    id: int
    email: str
    full_name: Optional[str] = None
    role: str
    tenant_id: Optional[int] = None
    branch_id: Optional[int] = None
    franchise_id: Optional[int] = None
    patient_id: Optional[int] = None

    class Config:
        from_attributes = True


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut


@router.post("/login", response_model=TokenResponse)
def login(payload: LoginRequest, request: Request, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == payload.email.lower()).first()
    if not user or not verify_password(payload.password, user.hashed_password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account disabled")

    token = create_access_token({
        "sub": str(user.id),
        "role": user.role,
        "tenant_id": user.tenant_id,
    })
    write_audit(db, action="login", user=user, entity="user", entity_id=user.id,
                ip=request.client.host if request.client else None)
    return TokenResponse(access_token=token, user=UserOut.model_validate(user))


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(get_current_user)):
    return UserOut.model_validate(user)


@router.get("/scope")
def my_scope(scope: Scope = Depends(get_scope)):
    """Inspect the resolved row-level visibility for the current user."""
    return {
        "role": scope.role,
        "tenant_id": scope.tenant_id,
        "branch_id": scope.branch_id,
        "franchise_id": scope.franchise_id,
        "patient_id": scope.patient_id,
        "sees_all_tenants": scope.is_super_admin,
    }
