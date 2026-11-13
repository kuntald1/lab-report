"""Test-catalog administration. Reads are tenant-scoped (franchises/patients can
see the menu); writes are restricted to lab_admin / super_admin."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func as sqlfunc
from pydantic import BaseModel
from typing import Optional, List

from database import get_db
from models.org import Role, User
from models.clinical import Department, TestCatalog, Package, PackageTest, ReferenceRange, Parameter
from services.parameters import find_conflicts
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
    sex: str = "A"                       # 'M' | 'F' | 'A' | 'C' (children — any sex, narrowed by the age band)
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
    method: Optional[str] = None         # printed under METHODOLOGY
    device_id: Optional[int] = None      # NULL = whichever analyser reported it
    # None = not sent: a new range is active, an edited one keeps whatever it was.
    # (An older app build never sends this, and must not switch a range back on.)
    is_active: Optional[bool] = None


def _clean_range(p: RangeIn) -> dict:
    d = p.model_dump()
    d["param"] = (d.get("param") or "").strip() or None
    d["method"] = (d.get("method") or "").strip() or None
    d["sex"] = (d.get("sex") or "A").strip()[:1].upper()
    if d["sex"] not in ("M", "F", "A", "C"):
        d["sex"] = "A"
    if d.get("is_active") is None:
        d.pop("is_active", None)
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


# --------------------------------------------------------------------------- parameter list
class ParameterIn(BaseModel):
    name: str
    section: Optional[str] = None
    sort_order: Optional[int] = None
    aliases: Optional[str] = None        # comma-separated
    is_active: Optional[bool] = None     # None = not sent: new = active, edit = unchanged


def _clean_param(p: ParameterIn) -> dict:
    d = p.model_dump()
    d["name"] = (d.get("name") or "").strip()
    d["section"] = (d.get("section") or "").strip() or None
    d["aliases"] = ", ".join(a.strip() for a in (d.get("aliases") or "").replace(";", ",").split(",") if a.strip()) or None
    if d.get("is_active") is None:
        d.pop("is_active", None)
    return d


def _check_param(db, d, exclude_id=None):
    if not d["name"]:
        raise HTTPException(status_code=400, detail="Parameter name is required")
    problems = list(find_conflicts(db, d["name"], d.get("aliases"), exclude_id))
    if problems:
        raise HTTPException(status_code=400, detail="; ".join(problems))


@router.get("/parameters")
def list_parameters(db: Session = Depends(get_db)):
    return (db.query(Parameter)
              .order_by(Parameter.section, Parameter.sort_order, Parameter.name).all())


@router.get("/parameters/usage")
def parameter_usage(db: Session = Depends(get_db), scope: Scope = Depends(get_scope)):
    """Which tests report which parameters — read from each test's
    "Parameters printed on the report" field, matched to the Parameter list by
    name or alias the same way the report does it.

      tests:   every active test that fills that field in, with its names in
               the order typed and the parameter each one resolved to (null =
               a name the Parameter list doesn't know, e.g. "Note")
      used_in: parameter id -> names of the tests that report it
    """
    from services.ranges import _match_key
    from services.parameters import names_of
    # Names are matched exactly first, then loosely (letters and digits only,
    # as the report does). Loose matching makes "P. C. V" and "PCV" — or
    # "Basophils" and "Basophils %" — the same key; when that happens the row
    # whose own name matches, that has a section and an order, wins, because
    # that is the row the report uses for the heading and position.
    exact, by_key = {}, {}
    def _exact(x):
        return " ".join(str(x or "").split()).lower()
    params = db.query(Parameter).filter(Parameter.is_active.isnot(False)).all()
    for prm in params:
        exact.setdefault(_exact(prm.name), prm.id)
    for prm in params:
        for n in names_of(prm)[1:]:
            exact.setdefault(_exact(n), prm.id)
        for i, n in enumerate(names_of(prm)):
            k = _match_key(n)
            if k:
                rank = (0 if i == 0 else 1, 0 if prm.section else 1,
                        prm.sort_order if prm.sort_order is not None else 10**6, prm.id)
                if k not in by_key or rank < by_key[k][0]:
                    by_key[k] = (rank, prm.id)
    tq = db.query(TestCatalog).filter(TestCatalog.is_active.isnot(False),
                                      TestCatalog.parameters.isnot(None))
    tq = apply_scope(tq, TestCatalog, scope)
    tests, used_in = [], {}
    for t in tq.order_by(TestCatalog.name).all():
        declared, seen = [], set()
        for piece in (t.parameters or "").replace(";", ",").split(","):
            name = piece.strip()
            k = _match_key(name)
            if not k or k in seen:
                continue
            seen.add(k)
            pid = exact.get(_exact(name)) or (by_key.get(k) or (None, None))[1]
            declared.append({"name": name, "parameter_id": pid})
            if pid is not None and t.name not in used_in.setdefault(pid, []):
                used_in[pid].append(t.name)
        if declared:
            tests.append({"id": t.id, "name": t.name, "code": getattr(t, "code", None), "declared": declared})
    return {"tests": tests, "used_in": used_in}


@router.post("/parameters", dependencies=[Depends(WRITE)])
def create_parameter(p: ParameterIn, db: Session = Depends(get_db)):
    d = _clean_param(p); _check_param(db, d)
    r = Parameter(**d)
    db.add(r); db.commit(); db.refresh(r)
    return r


@router.put("/parameters/{parameter_id}", dependencies=[Depends(WRITE)])
def update_parameter(parameter_id: int, p: ParameterIn, db: Session = Depends(get_db)):
    r = db.query(Parameter).filter(Parameter.id == parameter_id).first()
    if not r:
        raise HTTPException(status_code=404, detail="Parameter not found")
    d = _clean_param(p); _check_param(db, d, exclude_id=parameter_id)
    for k, v in d.items():
        setattr(r, k, v)
    db.commit(); db.refresh(r)
    return r


@router.delete("/parameters/{parameter_id}", dependencies=[Depends(WRITE)])
def delete_parameter(parameter_id: int, db: Session = Depends(get_db)):
    """Retires, never deletes — same rule as every other catalog record."""
    r = db.query(Parameter).filter(Parameter.id == parameter_id).first()
    if not r:
        raise HTTPException(status_code=404, detail="Parameter not found")
    r.is_active = False
    db.commit()
    return {"id": parameter_id, "is_active": False}
