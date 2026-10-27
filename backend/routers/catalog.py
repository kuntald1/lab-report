"""Test-catalog administration. Reads are tenant-scoped (franchises/patients can
see the menu); writes are restricted to lab_admin / super_admin."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func as sqlfunc
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
    return (apply_scope(db.query(Department), Department, scope)
              .filter(Department.is_active.is_(True)).order_by(Department.name).all())


@router.put("/departments/{department_id}", dependencies=[Depends(WRITE)])
def update_department(department_id: int, p: DepartmentIn, db: Session = Depends(get_db)):
    d = db.query(Department).filter(Department.id == department_id).first()
    if not d:
        raise HTTPException(404, "department not found")
    d.name, d.code = p.name, p.code
    db.commit(); db.refresh(d)
    return d


@router.delete("/departments/{department_id}", dependencies=[Depends(WRITE)])
def delete_department(department_id: int, db: Session = Depends(get_db)):
    d = db.query(Department).filter(Department.id == department_id).first()
    if not d:
        raise HTTPException(404, "department not found")
    d.is_active = False
    db.commit()
    return {"id": department_id, "is_active": False}


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
    # NULL test_id = a default used wherever this parameter is reported, so a
    # lab can set HGB once rather than on every panel that includes it.
    test_id: Optional[int] = None
    param: Optional[str] = None          # WBC, HGB, NEUT% ... NULL = whole test
    sex: str = "A"                       # 'M' | 'F' | 'A'
    age_min: Optional[int] = None        # years
    age_max: Optional[int] = None
    age_min_months: Optional[int] = None # infants; used only once a patient's
    age_max_months: Optional[int] = None # age is known in months
    low: Optional[float] = None
    high: Optional[float] = None
    critical_low: Optional[float] = None
    critical_high: Optional[float] = None
    unit: Optional[str] = None
    text: Optional[str] = None           # qualitative, e.g. "Negative"


def _clean_range(p: RangeIn) -> dict:
    d = p.model_dump()
    d["param"] = (d.get("param") or "").strip() or None
    d["sex"] = (d.get("sex") or "A").strip()[:1].upper()
    if d["sex"] not in ("M", "F", "A"):
        d["sex"] = "A"
    return d


@router.post("/reference-ranges", dependencies=[Depends(WRITE)])
def create_range(p: RangeIn, db: Session = Depends(get_db)):
    r = ReferenceRange(**_clean_range(p))
    db.add(r); db.commit(); db.refresh(r)
    return r


@router.put("/reference-ranges/{range_id}", dependencies=[Depends(WRITE)])
def update_range(range_id: int, p: RangeIn, db: Session = Depends(get_db)):
    r = db.query(ReferenceRange).filter(ReferenceRange.id == range_id).first()
    if not r:
        raise HTTPException(status_code=404, detail="Reference range not found")
    for k, v in _clean_range(p).items():
        setattr(r, k, v)
    db.commit(); db.refresh(r)
    return r


@router.delete("/reference-ranges/{range_id}", dependencies=[Depends(WRITE)])
def delete_range(range_id: int, db: Session = Depends(get_db)):
    r = db.query(ReferenceRange).filter(ReferenceRange.id == range_id).first()
    if not r:
        raise HTTPException(status_code=404, detail="Reference range not found")
    db.delete(r); db.commit()
    return {"deleted": range_id}


@router.get("/reference-ranges")
def list_all_ranges(param: Optional[str] = None, db: Session = Depends(get_db)):
    """Every range, or just the rows for one parameter.

    The catalog-wide defaults (test_id NULL) live here too, which is why this
    exists alongside the per-test listing below.
    """
    q = db.query(ReferenceRange)
    if param:
        q = q.filter(sqlfunc.upper(ReferenceRange.param) == param.strip().upper())
    return q.order_by(ReferenceRange.param, ReferenceRange.id).all()


@router.get("/reference-ranges/{test_id}")
def list_ranges(test_id: int, db: Session = Depends(get_db)):
    return db.query(ReferenceRange).filter(ReferenceRange.test_id == test_id)\
             .order_by(ReferenceRange.param, ReferenceRange.id).all()


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
