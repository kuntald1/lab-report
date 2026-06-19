"""Test-catalog administration. Reads are tenant-scoped (franchises/patients can
see the menu); writes are restricted to lab_admin / super_admin."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional, List

from database import get_db
from models.org import Role, User
from models.clinical import Department, TestCatalog, Package, PackageTest, ReferenceRange
from auth.deps import get_current_user, get_scope, require_roles, apply_scope, Scope

router = APIRouter()
WRITE = require_roles(Role.SUPER_ADMIN, Role.LAB_ADMIN)


def _tenant_of(user: User) -> Optional[int]:
    return user.tenant_id


# --------------------------------------------------------------------------- departments
class DepartmentIn(BaseModel):
    name: str
    code: Optional[str] = None


@router.post("/departments", dependencies=[Depends(WRITE)])
def create_department(p: DepartmentIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    d = Department(tenant_id=_tenant_of(user), name=p.name, code=p.code)
    db.add(d); db.commit(); db.refresh(d)
    return d


@router.get("/departments")
def list_departments(db: Session = Depends(get_db), scope: Scope = Depends(get_scope)):
    return apply_scope(db.query(Department), Department, scope).order_by(Department.id).all()


# --------------------------------------------------------------------------- tests
class TestIn(BaseModel):
    name: str
    code: Optional[str] = None
    department_id: Optional[int] = None
    unit: Optional[str] = None
    method: Optional[str] = None
    sample_type: Optional[str] = None
    price: float = 0.0
    tat_target_minutes: Optional[int] = None


@router.post("/tests", dependencies=[Depends(WRITE)])
def create_test(p: TestIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    t = TestCatalog(tenant_id=_tenant_of(user), **p.model_dump())
    db.add(t); db.commit(); db.refresh(t)
    return t


@router.get("/tests")
def list_tests(db: Session = Depends(get_db), scope: Scope = Depends(get_scope)):
    return apply_scope(db.query(TestCatalog), TestCatalog, scope).order_by(TestCatalog.id).all()


# --------------------------------------------------------------------------- reference ranges
class RangeIn(BaseModel):
    test_id: int
    sex: str = "A"
    age_min: Optional[int] = None
    age_max: Optional[int] = None
    low: Optional[float] = None
    high: Optional[float] = None
    unit: Optional[str] = None
    text: Optional[str] = None


@router.post("/reference-ranges", dependencies=[Depends(WRITE)])
def create_range(p: RangeIn, db: Session = Depends(get_db)):
    r = ReferenceRange(**p.model_dump())
    db.add(r); db.commit(); db.refresh(r)
    return r


@router.get("/reference-ranges/{test_id}")
def list_ranges(test_id: int, db: Session = Depends(get_db)):
    return db.query(ReferenceRange).filter(ReferenceRange.test_id == test_id).all()


# --------------------------------------------------------------------------- packages
class PackageIn(BaseModel):
    name: str
    code: Optional[str] = None
    price: float = 0.0
    test_ids: List[int] = []


@router.post("/packages", dependencies=[Depends(WRITE)])
def create_package(p: PackageIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    pkg = Package(tenant_id=_tenant_of(user), name=p.name, code=p.code, price=p.price)
    db.add(pkg); db.commit(); db.refresh(pkg)
    for tid in p.test_ids:
        db.add(PackageTest(package_id=pkg.id, test_id=tid))
    db.commit()
    return {"id": pkg.id, "name": pkg.name, "price": pkg.price, "test_ids": p.test_ids}


@router.get("/packages")
def list_packages(db: Session = Depends(get_db), scope: Scope = Depends(get_scope)):
    pkgs = apply_scope(db.query(Package), Package, scope).order_by(Package.id).all()
    out = []
    for pkg in pkgs:
        tids = [pt.test_id for pt in db.query(PackageTest).filter(PackageTest.package_id == pkg.id).all()]
        out.append({"id": pkg.id, "name": pkg.name, "code": pkg.code, "price": pkg.price, "test_ids": tids})
    return out
