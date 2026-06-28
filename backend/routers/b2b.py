"""
B2B Phase 2 — management API for the admin screens.

Covers:
  - Sample tubes (colour master)         /api/b2b/tubes
  - Doctors list (for assignment)        /api/b2b/doctors
  - Test catalog list + edit             /api/b2b/tests
  - Test groups (packages) + members     /api/b2b/test-groups
  - Org groups CRUD                       /api/b2b/org-groups
  - Org group priced tests (tick+price)  /api/b2b/org-groups/{id}/tests
  - Organizations CRUD + group assign    /api/b2b/organizations
  - Org priced tests (tick+price)        /api/b2b/organizations/{id}/tests

Follows the existing conventions: get_db / get_scope / require_roles / write_audit,
and tenant pinning via the lab_admin's own tenant.
"""
from fastapi import APIRouter, Depends, HTTPException, Request
import os, hmac, hashlib, requests
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional, List

from database import get_db
from auth.deps import get_current_user, get_scope, Scope
from auth.audit import write_audit
from models.org import User, Franchise, Role
from models.clinical import TestCatalog, Department, Package, PackageTest
from models.b2b import OrgGroup, SampleTube, OrgGroupTest, OrgTest, OrgLedger
from services.whatsapp import send_whatsapp
from services.credit import is_franchise_locked

RZP_KEY_ID     = os.getenv("RAZORPAY_KEY_ID", "")
RZP_KEY_SECRET = os.getenv("RAZORPAY_KEY_SECRET", "")
RZP_API        = "https://api.razorpay.com/v1"

router = APIRouter()

ADMIN_ROLES = (Role.SUPER_ADMIN, Role.LAB_ADMIN)


def _ip(request: Request) -> Optional[str]:
    return request.client.host if request.client else None


def _tenant(user: User) -> Optional[int]:
    """lab_admin pinned to own tenant; super_admin operates tenant-wide (None ok here)."""
    return user.tenant_id


def _require_admin(user: User):
    if user.role not in ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="admin only")


# =================================================================== sample tubes
class TubeIn(BaseModel):
    name: str
    color: Optional[str] = None


@router.get("/tubes")
def list_tubes(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return db.query(SampleTube).filter(SampleTube.is_active.is_(True)).order_by(SampleTube.name).all()


@router.post("/tubes")
def create_tube(payload: TubeIn, request: Request,
                db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    _require_admin(user)
    t = SampleTube(tenant_id=_tenant(user), name=payload.name, color=payload.color)
    db.add(t); db.commit(); db.refresh(t)
    write_audit(db, action="create", user=user, entity="sample_tube", entity_id=t.id,
                after={"name": t.name, "color": t.color}, ip=_ip(request))
    return t


@router.put("/tubes/{tube_id}")
def update_tube(tube_id: int, payload: TubeIn, db: Session = Depends(get_db),
                user: User = Depends(get_current_user)):
    _require_admin(user)
    t = db.query(SampleTube).filter(SampleTube.id == tube_id).first()
    if not t: raise HTTPException(404, "tube not found")
    t.name, t.color = payload.name, payload.color
    db.commit(); db.refresh(t)
    return t


@router.delete("/tubes/{tube_id}")
def delete_tube(tube_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    _require_admin(user)
    t = db.query(SampleTube).filter(SampleTube.id == tube_id).first()
    if not t: raise HTTPException(404, "tube not found")
    t.is_active = False; db.commit()
    return {"id": tube_id, "is_active": False}


# =================================================================== doctors
@router.get("/doctors")
def list_doctors(db: Session = Depends(get_db), scope: Scope = Depends(get_scope)):
    """Doctors = pathologist users (created on the Users/Doctors screen). They
    later gate tested -> validated. is_active NULL counts as active."""
    from sqlalchemy import or_
    q = db.query(User).filter(
        User.role == Role.PATHOLOGIST,
        or_(User.is_active.is_(True), User.is_active.is_(None)),
    )
    if scope.tenant_id is not None:
        q = q.filter(User.tenant_id == scope.tenant_id)
    return [{"id": u.id, "name": u.full_name or u.email, "email": u.email, "role": u.role}
            for u in q.order_by(User.full_name)]


# =================================================================== test catalog
class TestPatch(BaseModel):
    mrp: Optional[float] = None
    price: Optional[float] = None
    normal_value: Optional[str] = None
    sample_tube_id: Optional[int] = None
    assigned_doctor_id: Optional[int] = None
    department_id: Optional[int] = None


def _test_dict(t: TestCatalog) -> dict:
    return {"id": t.id, "name": t.name, "mrp": t.mrp, "price": t.price,
            "sample_type": t.sample_type, "normal_value": t.normal_value,
            "sample_tube_id": t.sample_tube_id, "assigned_doctor_id": t.assigned_doctor_id,
            "department_id": t.department_id, "tat_target_minutes": t.tat_target_minutes}


@router.get("/tests")
def list_tests(db: Session = Depends(get_db), scope: Scope = Depends(get_scope), q: Optional[str] = None):
    query = db.query(TestCatalog).filter(TestCatalog.is_active.is_(True))
    if scope.tenant_id is not None:
        query = query.filter(TestCatalog.tenant_id == scope.tenant_id)
    if q:
        query = query.filter(TestCatalog.name.ilike(f"%{q}%"))
    return [_test_dict(t) for t in query.order_by(TestCatalog.name).limit(1000).all()]


@router.put("/tests/{test_id}")
def update_test(test_id: int, payload: TestPatch, request: Request,
                db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    _require_admin(user)
    t = db.query(TestCatalog).filter(TestCatalog.id == test_id).first()
    if not t: raise HTTPException(404, "test not found")
    for k, v in payload.model_dump(exclude_unset=True).items():
        setattr(t, k, v)
    db.commit(); db.refresh(t)
    write_audit(db, action="update", user=user, entity="test", entity_id=t.id,
                after=payload.model_dump(exclude_unset=True), ip=_ip(request))
    return _test_dict(t)


@router.delete("/tests/{test_id}")
def delete_test(test_id: int, request: Request,
                db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    _require_admin(user)
    t = db.query(TestCatalog).filter(TestCatalog.id == test_id).first()
    if not t: raise HTTPException(404, "test not found")
    t.is_active = False
    db.commit()
    write_audit(db, action="delete", user=user, entity="test", entity_id=test_id,
                after={"is_active": False}, ip=_ip(request))
    return {"id": test_id, "is_active": False}


# =================================================================== test groups (packages)
class TestGroupIn(BaseModel):
    name: str
    test_ids: List[int] = []


@router.get("/test-groups")
def list_test_groups(db: Session = Depends(get_db), scope: Scope = Depends(get_scope)):
    q = db.query(Package).filter(Package.is_active.is_(True))
    if scope.tenant_id is not None:
        q = q.filter(Package.tenant_id == scope.tenant_id)
    out = []
    for p in q.order_by(Package.name).all():
        items = db.query(PackageTest).filter(PackageTest.package_id == p.id).all()
        out.append({"id": p.id, "name": p.name, "test_ids": [i.test_id for i in items]})
    return out


@router.post("/test-groups")
def create_test_group(payload: TestGroupIn, db: Session = Depends(get_db),
                      user: User = Depends(get_current_user)):
    _require_admin(user)
    p = Package(tenant_id=_tenant(user), name=payload.name)
    db.add(p); db.flush()
    for tid in payload.test_ids:
        db.add(PackageTest(package_id=p.id, test_id=tid))
    db.commit(); db.refresh(p)
    return {"id": p.id, "name": p.name, "test_ids": payload.test_ids}


@router.put("/test-groups/{group_id}")
def update_test_group(group_id: int, payload: TestGroupIn, db: Session = Depends(get_db),
                      user: User = Depends(get_current_user)):
    _require_admin(user)
    p = db.query(Package).filter(Package.id == group_id).first()
    if not p: raise HTTPException(404, "group not found")
    p.name = payload.name
    db.query(PackageTest).filter(PackageTest.package_id == p.id).delete()
    for tid in payload.test_ids:
        db.add(PackageTest(package_id=p.id, test_id=tid))
    db.commit()
    return {"id": p.id, "name": p.name, "test_ids": payload.test_ids}


# =================================================================== org groups
class OrgGroupIn(BaseModel):
    name: str


@router.get("/org-groups")
def list_org_groups(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    q = db.query(OrgGroup).filter(OrgGroup.is_active.is_(True))
    if user.tenant_id is not None:
        q = q.filter(OrgGroup.tenant_id == user.tenant_id)
    return q.order_by(OrgGroup.name).all()


@router.post("/org-groups")
def create_org_group(payload: OrgGroupIn, request: Request,
                     db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    _require_admin(user)
    g = OrgGroup(tenant_id=_tenant(user), name=payload.name)
    db.add(g); db.commit(); db.refresh(g)
    write_audit(db, action="create", user=user, entity="org_group", entity_id=g.id,
                after={"name": g.name}, ip=_ip(request))
    return g


@router.put("/org-groups/{group_id}")
def update_org_group(group_id: int, payload: OrgGroupIn, db: Session = Depends(get_db),
                     user: User = Depends(get_current_user)):
    _require_admin(user)
    g = db.query(OrgGroup).filter(OrgGroup.id == group_id).first()
    if not g: raise HTTPException(404, "group not found")
    g.name = payload.name; db.commit(); db.refresh(g)
    return g


@router.delete("/org-groups/{group_id}")
def delete_org_group(group_id: int, request: Request,
                     db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    _require_admin(user)
    g = db.query(OrgGroup).filter(OrgGroup.id == group_id).first()
    if not g: raise HTTPException(404, "group not found")
    # guard: don't delete a group that still has organizations in it
    members = db.query(Franchise).filter(Franchise.org_group_id == group_id).count()
    if members > 0:
        raise HTTPException(400, f"{members} organization(s) still in this group — move them out first")
    g.is_active = False
    db.query(OrgGroupTest).filter(OrgGroupTest.org_group_id == group_id).delete()
    db.commit()
    write_audit(db, action="delete", user=user, entity="org_group", entity_id=group_id,
                after={"is_active": False}, ip=_ip(request))
    return {"id": group_id, "is_active": False}


# ---- priced test list for a group (the tick + own mrp/price builder) ----
class PricedTestIn(BaseModel):
    test_id: int
    mrp: float = 0
    price: float = 0


@router.get("/org-groups/{group_id}/tests")
def list_group_tests(group_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    rows = db.query(OrgGroupTest).filter(OrgGroupTest.org_group_id == group_id).all()
    return [{"test_id": r.test_id, "mrp": r.mrp, "price": r.price} for r in rows]


@router.put("/org-groups/{group_id}/tests")
def set_group_tests(group_id: int, items: List[PricedTestIn], request: Request,
                    db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Replace the group's priced-test set. Each item carries its OWN mrp+price
    (frozen copy) — editing here never touches the base test or any other context."""
    _require_admin(user)
    if not db.query(OrgGroup).filter(OrgGroup.id == group_id).first():
        raise HTTPException(404, "group not found")
    db.query(OrgGroupTest).filter(OrgGroupTest.org_group_id == group_id).delete()
    for it in items:
        db.add(OrgGroupTest(org_group_id=group_id, test_id=it.test_id, mrp=it.mrp, price=it.price))
    db.commit()
    write_audit(db, action="update", user=user, entity="org_group_tests", entity_id=group_id,
                after={"count": len(items)}, ip=_ip(request))
    return {"group_id": group_id, "count": len(items)}


# =================================================================== organizations
class OrganizationIn(BaseModel):
    name: str
    org_group_id: Optional[int] = None
    address: Optional[str] = None
    pan: Optional[str] = None
    aadhaar: Optional[str] = None
    gstin: Optional[str] = None
    contact_person: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    credit_limit: Optional[int] = 0


def _org_dict(o: Franchise) -> dict:
    return {"id": o.id, "name": o.name, "org_group_id": o.org_group_id,
            "address": o.address, "pan": o.pan, "aadhaar": o.aadhaar, "gstin": o.gstin,
            "contact_person": o.contact_person, "phone": o.phone, "email": o.email,
            "credit_limit": o.credit_limit, "is_active": o.is_active}


@router.get("/organizations")
def list_organizations(db: Session = Depends(get_db), scope: Scope = Depends(get_scope)):
    from sqlalchemy import or_
    q = db.query(Franchise).filter(or_(Franchise.is_active.is_(True), Franchise.is_active.is_(None)))
    if scope.tenant_id is not None:
        q = q.filter(Franchise.tenant_id == scope.tenant_id)
    if scope.role == Role.FRANCHISE and scope.franchise_id is not None:
        q = q.filter(Franchise.id == scope.franchise_id)   # org-login sees only itself
    return [_org_dict(o) for o in q.order_by(Franchise.name).all()]


def _org_outstanding(db: Session, org_id: int) -> float:
    last = (db.query(OrgLedger).filter(OrgLedger.organization_id == org_id)
              .order_by(OrgLedger.id.desc()).first())
    return float(last.balance_after) if last and last.balance_after is not None else 0.0


def _ledger_payload(db: Session, org: Franchise) -> dict:
    entries = (db.query(OrgLedger).filter(OrgLedger.organization_id == org.id)
                 .order_by(OrgLedger.id.desc()).limit(500).all())
    return {
        "organization": {"id": org.id, "name": org.name,
                         "credit_limit": org.credit_limit, "phone": org.phone},
        "outstanding": _org_outstanding(db, org.id),
        "entries": [{"id": e.id, "type": e.entry_type, "amount": e.amount,
                     "balance_after": e.balance_after, "ref": e.ref,
                     "created_at": e.created_at} for e in entries],
    }


@router.get("/my-ledger")
def my_ledger(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Franchise login: own org, credit limit, outstanding + full debit/credit list."""
    if user.role != Role.FRANCHISE or not user.franchise_id:
        raise HTTPException(403, "franchise login only")
    org = db.query(Franchise).filter(Franchise.id == user.franchise_id).first()
    if not org:
        raise HTTPException(404, "organization not found")
    return _ledger_payload(db, org)


@router.get("/organizations/{org_id}/ledger")
def org_ledger(org_id: int, db: Session = Depends(get_db),
               scope: Scope = Depends(get_scope)):
    """Admin (or the franchise itself) reads an organization's ledger."""
    if scope.role == Role.FRANCHISE and scope.franchise_id != org_id:
        raise HTTPException(403, "not your organization")
    org = db.query(Franchise).filter(Franchise.id == org_id).first()
    if not org:
        raise HTTPException(404, "organization not found")
    return _ledger_payload(db, org)


class OrgPayVerifyIn(BaseModel):
    razorpay_order_id: str
    razorpay_payment_id: str
    razorpay_signature: str


@router.post("/pay/razorpay/order")
def org_rzp_order(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Franchise pays down its OUTSTANDING balance. Creates a Razorpay order for
    the current outstanding amount."""
    if user.role != Role.FRANCHISE or not user.franchise_id:
        raise HTTPException(403, "franchise login only")
    if not RZP_KEY_ID or not RZP_KEY_SECRET:
        raise HTTPException(500, "Razorpay keys not configured")
    org = db.query(Franchise).filter(Franchise.id == user.franchise_id).first()
    if not org:
        raise HTTPException(404, "organization not found")
    outstanding = _org_outstanding(db, org.id)
    if outstanding <= 0:
        raise HTTPException(400, "no outstanding balance to pay")

    amount_paise = int(round(outstanding * 100))
    try:
        resp = requests.post(
            f"{RZP_API}/orders",
            auth=(RZP_KEY_ID, RZP_KEY_SECRET),
            json={"amount": amount_paise, "currency": "INR",
                  "receipt": f"ORG{org.id}",
                  "notes": {"organization_id": str(org.id), "kind": "org_outstanding"}},
            timeout=15,
        )
    except requests.RequestException as e:
        raise HTTPException(502, f"Razorpay unreachable: {e}")
    if resp.status_code >= 400:
        raise HTTPException(502, f"Razorpay order failed: {resp.text[:200]}")
    order = resp.json()
    return {
        "key_id": RZP_KEY_ID,
        "order_id": order["id"],
        "amount": amount_paise,
        "currency": "INR",
        "name": "MediCloud",
        "description": f"{org.name} - outstanding",
    }


@router.post("/pay/razorpay/verify")
def org_rzp_verify(payload: OrgPayVerifyIn, request: Request,
                   db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Verify the Razorpay signature, then post a PAYMENT ledger entry that
    reduces outstanding (which auto-unlocks reports via is_franchise_locked)."""
    if user.role != Role.FRANCHISE or not user.franchise_id:
        raise HTTPException(403, "franchise login only")
    if not RZP_KEY_SECRET:
        raise HTTPException(500, "Razorpay secret not configured")
    org = db.query(Franchise).filter(Franchise.id == user.franchise_id).first()
    if not org:
        raise HTTPException(404, "organization not found")

    body = f"{payload.razorpay_order_id}|{payload.razorpay_payment_id}".encode()
    expected = hmac.new(RZP_KEY_SECRET.encode(), body, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, payload.razorpay_signature):
        raise HTTPException(400, "signature verification failed")

    # authoritative amount from the Razorpay order (never trust the client)
    try:
        ores = requests.get(f"{RZP_API}/orders/{payload.razorpay_order_id}",
                            auth=(RZP_KEY_ID, RZP_KEY_SECRET), timeout=15)
        amount = round(ores.json().get("amount", 0) / 100.0, 2)
    except Exception:
        amount = _org_outstanding(db, org.id)   # fallback to current outstanding

    bal = round(_org_outstanding(db, org.id) - amount, 2)
    db.add(OrgLedger(organization_id=org.id, entry_type="payment",
                     amount=amount, balance_after=bal,
                     ref=payload.razorpay_payment_id))
    db.commit()
    write_audit(db, action="payment", user=user, entity="organization", entity_id=org.id,
                after={"method": "razorpay", "amount": amount,
                       "rzp_payment_id": payload.razorpay_payment_id}, ip=_ip(request))
    return {"ok": True, "paid": amount, "outstanding": bal,
            "locked": is_franchise_locked(db, org.id)}


class OrgWhatsAppIn(BaseModel):
    message: str
    to_number: Optional[str] = None     # defaults to the org's saved phone


@router.post("/organizations/{org_id}/whatsapp")
def org_whatsapp(org_id: int, payload: OrgWhatsAppIn, request: Request,
                 db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Admin/super-admin sends a WhatsApp message to an organization's phone."""
    _require_admin(user)
    org = db.query(Franchise).filter(Franchise.id == org_id).first()
    if not org:
        raise HTTPException(404, "organization not found")
    to_number = (payload.to_number or org.phone or "").strip()
    if not to_number:
        raise HTTPException(400, "no phone number on file for this organization")
    res = send_whatsapp(db, org.tenant_id, to_number, payload.message)
    write_audit(db, action="whatsapp", user=user, entity="organization", entity_id=org.id,
                after={"to": to_number}, ip=_ip(request))
    if not res.get("ok", True) and res.get("error"):
        raise HTTPException(502, res.get("error", "whatsapp failed"))
    return {"sent": True, "to": to_number}


@router.post("/organizations")
def create_organization(payload: OrganizationIn, request: Request,
                        db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    _require_admin(user)
    o = Franchise(tenant_id=_tenant(user), **payload.model_dump())
    db.add(o); db.commit(); db.refresh(o)
    write_audit(db, action="create", user=user, entity="organization", entity_id=o.id,
                after={"name": o.name, "group": o.org_group_id}, ip=_ip(request))
    return _org_dict(o)


@router.put("/organizations/{org_id}")
def update_organization(org_id: int, payload: OrganizationIn, request: Request,
                        db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    _require_admin(user)
    o = db.query(Franchise).filter(Franchise.id == org_id).first()
    if not o: raise HTTPException(404, "organization not found")
    for k, v in payload.model_dump().items():
        setattr(o, k, v)
    db.commit(); db.refresh(o)
    write_audit(db, action="update", user=user, entity="organization", entity_id=o.id,
                after=payload.model_dump(), ip=_ip(request))
    return _org_dict(o)


@router.delete("/organizations/{org_id}")
def delete_organization(org_id: int, request: Request,
                        db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    _require_admin(user)
    o = db.query(Franchise).filter(Franchise.id == org_id).first()
    if not o: raise HTTPException(404, "organization not found")
    o.is_active = False
    db.commit()
    write_audit(db, action="delete", user=user, entity="organization", entity_id=org_id,
                after={"is_active": False}, ip=_ip(request))
    return {"id": org_id, "is_active": False}


@router.get("/organizations/{org_id}/tests")
def list_org_tests(org_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    rows = db.query(OrgTest).filter(OrgTest.organization_id == org_id).all()
    return [{"test_id": r.test_id, "mrp": r.mrp, "price": r.price} for r in rows]


@router.put("/organizations/{org_id}/tests")
def set_org_tests(org_id: int, items: List[PricedTestIn], request: Request,
                  db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Replace a standalone org's priced-test set (own mrp+price, frozen)."""
    _require_admin(user)
    if not db.query(Franchise).filter(Franchise.id == org_id).first():
        raise HTTPException(404, "organization not found")
    db.query(OrgTest).filter(OrgTest.organization_id == org_id).delete()
    for it in items:
        db.add(OrgTest(organization_id=org_id, test_id=it.test_id, mrp=it.mrp, price=it.price))
    db.commit()
    write_audit(db, action="update", user=user, entity="org_tests", entity_id=org_id,
                after={"count": len(items)}, ip=_ip(request))
    return {"organization_id": org_id, "count": len(items)}
