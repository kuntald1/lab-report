"""Phase 3 — billing endpoints.

Flow:
  - GET  /billing/resolve?organization_id=&test_ids=   -> live price preview per test
  - POST /billing/bills                                -> create a bill:
        * resolves each test's price (group->org->base) and FREEZES onto bill_items
        * applies admin-only discount (flat | percent)
        * writes an org_ledger 'bill' entry when the bill is on credit to an org
  - GET  /billing/bills            -> list bills (scoped)
  - GET  /billing/bills/{id}       -> one bill with its items + payments

Discount is admin-only: staff roles may create bills but any discount they send
is ignored (zeroed). Only lab_admin / super_admin discounts are honoured.
"""
from fastapi import APIRouter, Depends, HTTPException, Request, Query
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional, List

from database import get_db
from auth.deps import get_current_user, get_scope, Scope
from auth.audit import write_audit
from models.org import User, Franchise, Role
from models.models import Patient
from models.clinical import TestCatalog
from models.billing import Bill, BillItem, Payment
from models.b2b import OrgLedger
from services.pricing import resolve_price

router = APIRouter()
ADMIN_ROLES = (Role.SUPER_ADMIN, Role.LAB_ADMIN)


def _ip(request: Request) -> Optional[str]:
    return request.client.host if request.client else None


def _org_outstanding(db: Session, organization_id: int) -> float:
    """Latest running balance for an org from its ledger (0 if none)."""
    last = (db.query(OrgLedger)
              .filter(OrgLedger.organization_id == organization_id)
              .order_by(OrgLedger.id.desc()).first())
    return float(last.balance_after) if last and last.balance_after is not None else 0.0


# ----------------------------------------------------------------- price preview
@router.get("/resolve")
def resolve_prices(organization_id: Optional[int] = None,
                   test_ids: str = Query("", description="comma-separated test ids"),
                   db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    ids = [int(x) for x in test_ids.split(",") if x.strip().isdigit()]
    out = []
    for tid in ids:
        try:
            rp = resolve_price(db, tid, organization_id)
            t = db.query(TestCatalog).filter(TestCatalog.id == tid).first()
            out.append({"test_id": tid, "name": t.name if t else f"#{tid}",
                        "mrp": rp.mrp, "price": rp.price, "source": rp.source})
        except ValueError:
            continue
    return out


# ----------------------------------------------------------------- create bill
class BillItemIn(BaseModel):
    test_id: int

class BillCreate(BaseModel):
    patient_id: int
    organization_id: Optional[int] = None   # if omitted, taken from the patient
    test_ids: List[int]
    discount_type: Optional[str] = None     # 'flat' | 'percent' | None
    discount_value: float = 0.0
    on_credit: bool = False                 # B2B: bill to org ledger instead of immediate pay


@router.post("/bills")
def create_bill(payload: BillCreate, request: Request,
                db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    patient = db.query(Patient).filter(Patient.id == payload.patient_id).first()
    if not patient:
        raise HTTPException(404, "patient not found")
    if not payload.test_ids:
        raise HTTPException(400, "no tests selected")

    org_id = payload.organization_id if payload.organization_id is not None else patient.organization_id

    # resolve + freeze each line
    items, subtotal = [], 0.0
    for tid in payload.test_ids:
        try:
            rp = resolve_price(db, tid, org_id)
        except ValueError:
            continue
        t = db.query(TestCatalog).filter(TestCatalog.id == tid).first()
        items.append(BillItem(test_id=tid, test_name=t.name if t else f"#{tid}",
                              mrp=rp.mrp, price=rp.price, price_source=rp.source))
        subtotal += rp.price or 0.0

    # discount is admin-only
    d_type = payload.discount_type
    d_value = payload.discount_value or 0.0
    if user.role not in ADMIN_ROLES:
        d_type, d_value = None, 0.0
    d_amount = 0.0
    if d_type == "flat":
        d_amount = min(d_value, subtotal)
    elif d_type == "percent":
        d_amount = round(subtotal * (d_value / 100.0), 2)
    total = round(subtotal - d_amount, 2)

    bill = Bill(
        tenant_id=patient.tenant_id, branch_id=patient.branch_id,
        patient_id=patient.id, organization_id=org_id,
        subtotal=round(subtotal, 2), discount_type=d_type, discount_value=d_value,
        discount_amount=d_amount, total=total, paid=0.0,
        status="credit" if payload.on_credit and org_id else "unpaid",
        created_by=user.id,
    )
    db.add(bill); db.flush()                # get bill.id
    bill.bill_no = f"B{bill.id:06d}"
    for it in items:
        it.bill_id = bill.id
        db.add(it)

    # B2B credit -> add to the org ledger
    if payload.on_credit and org_id:
        new_balance = _org_outstanding(db, org_id) + total
        db.add(OrgLedger(organization_id=org_id, entry_type="bill", amount=total,
                         balance_after=new_balance, ref=bill.bill_no))

    db.commit(); db.refresh(bill)
    write_audit(db, action="create", user=user, entity="bill", entity_id=bill.id,
                after={"bill_no": bill.bill_no, "total": total, "org": org_id}, ip=_ip(request))
    return _bill_dict(db, bill)


# ----------------------------------------------------------------- read
def _bill_dict(db: Session, b: Bill) -> dict:
    its = db.query(BillItem).filter(BillItem.bill_id == b.id).all()
    pays = db.query(Payment).filter(Payment.bill_id == b.id).all()
    patient = db.query(Patient).filter(Patient.id == b.patient_id).first()
    org = db.query(Franchise).filter(Franchise.id == b.organization_id).first() if b.organization_id else None
    return {
        "id": b.id, "bill_no": b.bill_no, "patient_id": b.patient_id,
        "patient_name": patient.patient_name if patient else None,
        "barcode": patient.barcode if patient else None,
        "organization_id": b.organization_id, "organization_name": org.name if org else None,
        "subtotal": b.subtotal, "discount_type": b.discount_type,
        "discount_value": b.discount_value, "discount_amount": b.discount_amount,
        "total": b.total, "paid": b.paid, "status": b.status,
        "created_at": b.created_at,
        "items": [{"test_id": i.test_id, "test_name": i.test_name, "mrp": i.mrp,
                   "price": i.price, "price_source": i.price_source} for i in its],
        "payments": [{"id": p.id, "method": p.method, "amount": p.amount,
                      "status": p.status, "created_at": p.created_at} for p in pays],
    }


@router.get("/bills")
def list_bills(db: Session = Depends(get_db), scope: Scope = Depends(get_scope),
               organization_id: Optional[int] = None, patient_id: Optional[int] = None):
    q = db.query(Bill)
    if scope.tenant_id is not None:
        q = q.filter(Bill.tenant_id == scope.tenant_id)
    # org-login sees only its own bills
    if scope.role == Role.FRANCHISE and scope.franchise_id is not None:
        q = q.filter(Bill.organization_id == scope.franchise_id)
    if organization_id is not None:
        q = q.filter(Bill.organization_id == organization_id)
    if patient_id is not None:
        q = q.filter(Bill.patient_id == patient_id)
    rows = q.order_by(Bill.id.desc()).limit(300).all()
    return [_bill_dict(db, b) for b in rows]


@router.get("/bills/{bill_id}")
def get_bill(bill_id: int, db: Session = Depends(get_db), scope: Scope = Depends(get_scope)):
    b = db.query(Bill).filter(Bill.id == bill_id).first()
    if not b:
        raise HTTPException(404, "bill not found")
    if scope.role == Role.FRANCHISE and scope.franchise_id is not None and b.organization_id != scope.franchise_id:
        raise HTTPException(403, "not your bill")
    return _bill_dict(db, b)
