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
from models.clinical import TestCatalog, Package, PackageTest
from models.billing import Bill, BillItem, Payment
from models.b2b import OrgLedger
from services.pricing import resolve_price

router = APIRouter()
ADMIN_ROLES = (Role.SUPER_ADMIN, Role.LAB_ADMIN)


def _ip(request: Request) -> Optional[str]:
    return request.client.host if request.client else None


def _suffix(idx: int) -> str:
    """0->A, 1->B, ... 25->Z, 26->AA, 27->AB ... (Excel-column style, always uppercase letters)."""
    s = ""
    idx += 1
    while idx > 0:
        idx, rem = divmod(idx - 1, 26)
        s = chr(65 + rem) + s
    return s


def _accession_taken(db: Session, value: str, exclude_item_id: Optional[int] = None) -> bool:
    q = db.query(BillItem).filter(BillItem.accession_number == value)
    if exclude_item_id is not None:
        q = q.filter(BillItem.id != exclude_item_id)
    return q.first() is not None


def _next_accessions(db: Session, base_barcode: str, count: int) -> List[str]:
    """Next `count` accession numbers for this barcode that are NOT already used
    anywhere in bill_items — globally unique, gap-aware (skips ones already taken,
    e.g. by an earlier bill for the same patient)."""
    out, n = [], 0
    while len(out) < count:
        candidate = f"{base_barcode}{_suffix(n)}"
        n += 1
        if not _accession_taken(db, candidate) and candidate not in out:
            out.append(candidate)
    return out


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


@router.get("/find-by-accession")
def find_by_accession(q: str = Query(..., min_length=1), db: Session = Depends(get_db),
                      user: User = Depends(get_current_user)):
    """Used by the New Bill patient filter: given a partial accession number,
    return the ids of patients who have a bill item matching it."""
    items = (db.query(BillItem)
               .filter(BillItem.accession_number.ilike(f"%{q}%"))
               .order_by(BillItem.id.desc()).limit(200).all())
    bill_ids = list({it.bill_id for it in items})
    if not bill_ids:
        return {"patient_ids": []}
    bills = db.query(Bill).filter(Bill.id.in_(bill_ids)).all()
    patient_ids = sorted({b.patient_id for b in bills if b.patient_id})
    return {"patient_ids": patient_ids}


@router.get("/next-accessions")
def next_accessions(barcode: str, count: int = 1, db: Session = Depends(get_db),
                    user: User = Depends(get_current_user)):
    """Used by New Bill to preview accession-number suggestions that are
    guaranteed not to collide with any already-issued ones for this barcode."""
    count = max(1, min(count, 50))
    return {"barcode": barcode, "accessions": _next_accessions(db, barcode, count)}


# ----------------------------------------------------------------- create bill
class BillItemIn(BaseModel):
    test_id: int

class BillCreate(BaseModel):
    patient_id: int
    organization_id: Optional[int] = None   # if omitted, taken from the patient
    test_ids: List[int]
    group_ids: List[int] = []               # test-group (panel) ids
    discount_type: Optional[str] = None     # 'flat' | 'percent' | None
    discount_value: float = 0.0
    on_credit: bool = False                 # B2B: bill to org ledger instead of immediate pay
    accessions: dict = {}                   # {str(test_id): accession_number} — client-previewed/edited values from New Bill; falls back to auto-generated when absent


@router.post("/bills")
def create_bill(payload: BillCreate, request: Request,
                db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    patient = db.query(Patient).filter(Patient.id == payload.patient_id).first()
    if not patient:
        raise HTTPException(404, "patient not found")
    if not payload.test_ids and not payload.group_ids:
        raise HTTPException(400, "no tests selected")

    org_id = payload.organization_id if payload.organization_id is not None else (patient.organization_id or patient.registered_franchise_id)

    items, subtotal = [], 0.0

    # --- test groups (panels): one bundled price, expanded into member lines ---
    group_member_ids = set()        # member tests covered by a group (for dedupe)
    for gid in (payload.group_ids or []):
        pkg = db.query(Package).filter(Package.id == gid).first()
        if not pkg:
            continue
        member_ids = [pt.test_id for pt in
                      db.query(PackageTest).filter(PackageTest.package_id == gid).all()]
        if not member_ids:
            continue
        gprice = pkg.price or 0.0
        for idx, tid in enumerate(member_ids):
            if tid in group_member_ids:
                continue
            group_member_ids.add(tid)
            t = db.query(TestCatalog).filter(TestCatalog.id == tid).first()
            items.append(BillItem(
                test_id=tid, test_name=t.name if t else f"#{tid}",
                mrp=(t.mrp if t else 0) or 0,
                price=(gprice if idx == 0 else 0.0),   # whole group price on first member -> lines sum to gprice
                price_source="group_panel", package_id=pkg.id, package_name=pkg.name))
        subtotal += gprice

    # --- standalone tests (skip any already covered by a selected group) ---
    for tid in payload.test_ids:
        if tid in group_member_ids:
            continue                                   # dedupe: already in a group
        try:
            rp = resolve_price(db, tid, org_id)
        except ValueError:
            continue
        t = db.query(TestCatalog).filter(TestCatalog.id == tid).first()
        items.append(BillItem(test_id=tid, test_name=t.name if t else f"#{tid}",
                              mrp=rp.mrp, price=rp.price, price_source=rp.source))
        subtotal += rp.price or 0.0

    if not items:
        raise HTTPException(400, "no billable tests")

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
    base_barcode = patient.barcode or ""
    used_this_bill = set()   # guards against duplicates within THIS bill too, not just against the DB
    for idx, it in enumerate(items):
        it.bill_id = bill.id
        override = (payload.accessions or {}).get(str(it.test_id))
        if override and override.strip():
            candidate = override.strip()
            if candidate in used_this_bill or _accession_taken(db, candidate):
                db.rollback()
                raise HTTPException(400, f"Accession number '{candidate}' is already in use — "
                                          f"please choose a different one for {it.test_name}")
        else:
            # auto-generate: walk the suffix sequence, skipping anything already taken (by any bill/patient)
            n = idx
            candidate = f"{base_barcode}{_suffix(n)}"
            while candidate in used_this_bill or _accession_taken(db, candidate):
                n += 1
                candidate = f"{base_barcode}{_suffix(n)}"
        it.accession_number = candidate
        used_this_bill.add(candidate)
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
        "phone": getattr(patient, "phone", None) if patient else None,
        "organization_id": b.organization_id, "organization_name": org.name if org else None,
        "subtotal": b.subtotal, "discount_type": b.discount_type,
        "discount_value": b.discount_value, "discount_amount": b.discount_amount,
        "total": b.total, "paid": b.paid, "status": b.status,
        "created_at": b.created_at,
        "items": [{"id": i.id, "test_id": i.test_id, "test_name": i.test_name, "mrp": i.mrp,
                   "price": i.price, "price_source": i.price_source,
                   "package_id": i.package_id, "package_name": i.package_name,
                   "accession_number": i.accession_number} for i in its],
        "payments": [{"id": p.id, "method": p.method, "amount": p.amount,
                      "status": p.status, "created_at": p.created_at} for p in pays],
    }


@router.get("/bills")
def list_bills(db: Session = Depends(get_db), scope: Scope = Depends(get_scope),
               organization_id: Optional[int] = None, patient_id: Optional[int] = None,
               branch_id: Optional[int] = None, barcode: Optional[str] = None,
               date_from: Optional[str] = None, date_to: Optional[str] = None):
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
    if branch_id is not None:
        q = q.filter(Bill.branch_id == branch_id)
    if barcode:
        ids = [p.id for p in db.query(Patient.id).filter(Patient.barcode.ilike(f"%{barcode}%")).all()]
        q = q.filter(Bill.patient_id.in_(ids or [-1]))
    if date_from:
        q = q.filter(Bill.created_at >= date_from)
    if date_to:
        q = q.filter(Bill.created_at <= date_to + " 23:59:59")
    rows = q.order_by(Bill.id.desc()).limit(500).all()
    return [_bill_dict(db, b) for b in rows]


@router.get("/bills/{bill_id}")
def get_bill(bill_id: int, db: Session = Depends(get_db), scope: Scope = Depends(get_scope)):
    b = db.query(Bill).filter(Bill.id == bill_id).first()
    if not b:
        raise HTTPException(404, "bill not found")
    if scope.role == Role.FRANCHISE and scope.franchise_id is not None:
        if b.organization_id != scope.franchise_id:
            # also allow if patient is registered under this franchise
            from models.models import Patient as Pat
            pt = db.query(Pat).filter(Pat.id == b.patient_id).first()
            if not pt or pt.registered_franchise_id != scope.franchise_id:
                raise HTTPException(403, "not your bill")
    return _bill_dict(db, b)


# ----------------------------------------------------------------- update discount
class AccessionIn(BaseModel):
    accession_number: str


@router.put("/bills/{bill_id}/items/{item_id}/accession")
def update_accession_number(bill_id: int, item_id: int, payload: AccessionIn, request: Request,
                            db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    it = db.query(BillItem).filter(BillItem.id == item_id, BillItem.bill_id == bill_id).first()
    if not it:
        raise HTTPException(404, "bill item not found")
    new_value = payload.accession_number.strip()
    if not new_value:
        raise HTTPException(400, "accession number cannot be blank")
    if _accession_taken(db, new_value, exclude_item_id=it.id):
        raise HTTPException(400, f"Accession number '{new_value}' is already in use by another test")
    before = it.accession_number
    it.accession_number = new_value
    db.commit()
    write_audit(db, action="update", user=user, entity="bill_item", entity_id=it.id,
                before={"accession_number": before}, after={"accession_number": it.accession_number}, ip=_ip(request))
    b = db.query(Bill).filter(Bill.id == bill_id).first()
    return _bill_dict(db, b)


class DiscountIn(BaseModel):
    discount_type: Optional[str] = None     # 'flat' | 'percent' | None
    discount_value: float = 0.0


@router.put("/bills/{bill_id}/discount")
def update_discount(bill_id: int, payload: DiscountIn, request: Request,
                    db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    if user.role not in ADMIN_ROLES:
        raise HTTPException(403, "discount is admin-only")
    bill = db.query(Bill).filter(Bill.id == bill_id).first()
    if not bill:
        raise HTTPException(404, "bill not found")
    if (bill.paid or 0) > 0:
        raise HTTPException(400, "cannot change discount after payment started")

    subtotal = bill.subtotal or 0.0
    d_type = payload.discount_type or None
    d_value = payload.discount_value or 0.0
    d_amount = 0.0
    if d_type == "flat":
        d_amount = min(d_value, subtotal)
    elif d_type == "percent":
        d_amount = round(subtotal * (d_value / 100.0), 2)
    bill.discount_type = d_type
    bill.discount_value = d_value
    bill.discount_amount = d_amount
    bill.total = round(subtotal - d_amount, 2)
    db.commit()
    write_audit(db, action="discount", user=user, entity="bill", entity_id=bill.id,
                after={"type": d_type, "value": d_value, "amount": d_amount, "total": bill.total}, ip=_ip(request))
    return _bill_dict(db, bill)


# ----------------------------------------------------------------- payments
class PaymentIn(BaseModel):
    method: str                    # cash | upi | razorpay | credit
    amount: float
    rzp_order_id: Optional[str] = None
    rzp_payment_id: Optional[str] = None
    note: Optional[str] = None


def _recompute_bill(db: Session, bill: Bill):
    paid = sum(p.amount for p in db.query(Payment)
               .filter(Payment.bill_id == bill.id, Payment.status == "success").all())
    bill.paid = round(paid, 2)
    if bill.status != "credit":
        if paid <= 0:                bill.status = "unpaid"
        elif paid < bill.total:      bill.status = "partial"
        else:                        bill.status = "paid"


@router.post("/bills/{bill_id}/payments")
def add_payment(bill_id: int, payload: PaymentIn, request: Request,
                db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    bill = db.query(Bill).filter(Bill.id == bill_id).first()
    if not bill:
        raise HTTPException(404, "bill not found")
    if payload.method not in ("cash", "upi", "razorpay", "credit"):
        raise HTTPException(400, "bad method")
    pay = Payment(tenant_id=bill.tenant_id, bill_id=bill.id, method=payload.method,
                  amount=payload.amount, status="success",
                  rzp_order_id=payload.rzp_order_id, rzp_payment_id=payload.rzp_payment_id,
                  note=payload.note, created_by=user.id)
    db.add(pay); db.flush()
    _recompute_bill(db, bill)
    # if this bill was on org credit, a payment reduces the org outstanding
    if bill.organization_id and payload.method != "credit":
        bal = _org_outstanding(db, bill.organization_id) - payload.amount
        db.add(OrgLedger(organization_id=bill.organization_id, entry_type="payment",
                         amount=payload.amount, balance_after=bal, ref=bill.bill_no))
    db.commit()
    write_audit(db, action="payment", user=user, entity="bill", entity_id=bill.id,
                after={"method": payload.method, "amount": payload.amount}, ip=_ip(request))
    return _bill_dict(db, bill)


# ----------------------------------------------------------------- bill PDF
@router.get("/bills/{bill_id}/pdf")
def bill_pdf(bill_id: int, db: Session = Depends(get_db), scope: Scope = Depends(get_scope)):
    from fastapi.responses import StreamingResponse
    from reportlab.lib.pagesizes import A4
    from reportlab.lib import colors
    from reportlab.lib.units import cm
    from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer
    from reportlab.lib.styles import getSampleStyleSheet
    import io

    b = db.query(Bill).filter(Bill.id == bill_id).first()
    if not b:
        raise HTTPException(404, "bill not found")
    if scope.role == Role.FRANCHISE and scope.franchise_id is not None:
        if b.organization_id != scope.franchise_id:
            # also allow if patient is registered under this franchise
            from models.models import Patient as Pat
            pt = db.query(Pat).filter(Pat.id == b.patient_id).first()
            if not pt or pt.registered_franchise_id != scope.franchise_id:
                raise HTTPException(403, "not your bill")
    data = _bill_dict(db, b)

    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, topMargin=1.5*cm, bottomMargin=1.5*cm)
    styles = getSampleStyleSheet()
    el = []
    el.append(Paragraph(f"<b>MediCloud — Bill {data['bill_no']}</b>", styles["Title"]))
    el.append(Spacer(1, 6))
    who = data.get("organization_name") or "Direct / Walk-in"
    el.append(Paragraph(f"Patient: {data['patient_name'] or '-'} ({data.get('barcode') or '-'})", styles["Normal"]))
    el.append(Paragraph(f"Billed to: {who}", styles["Normal"]))
    el.append(Paragraph(f"Status: {data['status']}", styles["Normal"]))
    el.append(Spacer(1, 12))

    rows = [["Test", "MRP", "Price"]]
    for it in data["items"]:
        rows.append([it["test_name"], f"INR {it['mrp']:.0f}", f"INR {it['price']:.0f}"])
    rows.append(["", "Subtotal", f"INR {data['subtotal']:.0f}"])
    if data["discount_amount"]:
        rows.append(["", "Discount", f"- INR {data['discount_amount']:.0f}"])
    rows.append(["", "Total", f"INR {data['total']:.0f}"])
    rows.append(["", "Paid", f"INR {data['paid']:.0f}"])

    t = Table(rows, colWidths=[10*cm, 3*cm, 3*cm])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0,0), (-1,0), colors.HexColor("#f97316")),
        ("TEXTCOLOR", (0,0), (-1,0), colors.white),
        ("FONTNAME", (0,0), (-1,0), "Helvetica-Bold"),
        ("ALIGN", (1,0), (-1,-1), "RIGHT"),
        ("GRID", (0,0), (-1,-1), 0.5, colors.HexColor("#e8ecf4")),
        ("FONTNAME", (1,-3), (-1,-1), "Helvetica-Bold"),
    ]))
    el.append(t)
    doc.build(el)
    buf.seek(0)
    return StreamingResponse(buf, media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename={data['bill_no']}.pdf"})


# ----------------------------------------------------------------- money receipt
def _amount_in_words(n: float) -> str:
    """Indian-style rupees in words (paise ignored)."""
    n = int(round(n))
    if n == 0:
        return "Zero Rupees Only"
    ones = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
            "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen",
            "Seventeen", "Eighteen", "Nineteen"]
    tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"]

    def two(x):
        if x < 20: return ones[x]
        return (tens[x // 10] + (" " + ones[x % 10] if x % 10 else "")).strip()

    def three(x):
        h = x // 100
        r = x % 100
        s = ""
        if h: s += ones[h] + " Hundred"
        if r: s += (" " if s else "") + two(r)
        return s

    parts = []
    crore = n // 10000000; n %= 10000000
    lakh = n // 100000; n %= 100000
    thousand = n // 1000; n %= 1000
    hundred = n
    if crore: parts.append(three(crore) + " Crore")
    if lakh: parts.append(three(lakh) + " Lakh")
    if thousand: parts.append(three(thousand) + " Thousand")
    if hundred: parts.append(three(hundred))
    return " ".join(parts).strip() + " Rupees Only"


@router.get("/bills/{bill_id}/receipt")
def money_receipt(bill_id: int, db: Session = Depends(get_db), scope: Scope = Depends(get_scope)):
    """Auto-generated money receipt PDF (paid amount, mode, in words, signatory)."""
    from fastapi.responses import StreamingResponse
    from reportlab.lib.pagesizes import A4
    from reportlab.lib import colors
    from reportlab.lib.units import cm
    from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.enums import TA_CENTER, TA_RIGHT
    import io

    b = db.query(Bill).filter(Bill.id == bill_id).first()
    if not b:
        raise HTTPException(404, "bill not found")
    if scope.role == Role.FRANCHISE and scope.franchise_id is not None:
        if b.organization_id != scope.franchise_id:
            # also allow if patient is registered under this franchise
            from models.models import Patient as Pat
            pt = db.query(Pat).filter(Pat.id == b.patient_id).first()
            if not pt or pt.registered_franchise_id != scope.franchise_id:
                raise HTTPException(403, "not your bill")
    data = _bill_dict(db, b)
    pays = data.get("payments", [])
    modes = ", ".join(sorted({p["method"].upper() for p in pays if p.get("status") == "success"})) or "—"

    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, topMargin=1.4*cm, bottomMargin=1.4*cm)
    styles = getSampleStyleSheet()
    center = ParagraphStyle("c", parent=styles["Normal"], alignment=TA_CENTER)
    right = ParagraphStyle("r", parent=styles["Normal"], alignment=TA_RIGHT)
    el = []

    el.append(Paragraph("<b>MediCloud Diagnostics</b>", ParagraphStyle("h", parent=styles["Title"], alignment=TA_CENTER, fontSize=18)))
    el.append(Paragraph("MONEY RECEIPT", ParagraphStyle("sub", parent=styles["Normal"], alignment=TA_CENTER, fontSize=11, textColor=colors.HexColor("#f97316"))))
    el.append(Spacer(1, 10))

    # scannable barcode of the patient barcode (Code128)
    bc_value = data.get("barcode") or data["bill_no"] or f"B{b.id}"
    try:
        from reportlab.graphics.barcode import code128
        from reportlab.platypus import Flowable
        from reportlab.lib.units import mm

        class _Barcode(Flowable):
            def __init__(self, value):
                super().__init__()
                self.bc = code128.Code128(value, barHeight=12*mm, barWidth=0.42)
                self.value = value
                self.width = self.bc.width
                self.height = 16*mm
            def draw(self):
                self.bc.drawOn(self.canv, 0, 4*mm)
                self.canv.setFont("Helvetica", 7)
                self.canv.drawCentredString(self.bc.width/2.0, 0, self.value)

        bc_tbl = Table([[_Barcode(bc_value)]], colWidths=[16*cm])
        bc_tbl.setStyle(TableStyle([("ALIGN", (0,0), (-1,-1), "CENTER")]))
        el.append(bc_tbl)
    except Exception:
        pass
    el.append(Spacer(1, 12))

    meta = [
        [Paragraph(f"<b>Receipt No:</b> R{b.id:06d}", styles["Normal"]),
         Paragraph(f"<b>Bill No:</b> {data['bill_no']}", right)],
        [Paragraph(f"<b>Patient:</b> {data['patient_name'] or '-'}", styles["Normal"]),
         Paragraph(f"<b>Barcode No:</b> {data.get('barcode') or '-'}", right)],
        [Paragraph(f"<b>Billed To:</b> {data.get('organization_name') or 'Direct / Walk-in'}", styles["Normal"]),
         Paragraph(f"<b>Date:</b> {str(b.created_at)[:16]}", right)],
    ]
    mt = Table(meta, colWidths=[9*cm, 7.2*cm])
    mt.setStyle(TableStyle([("BOTTOMPADDING", (0,0), (-1,-1), 6)]))
    el.append(mt)
    el.append(Spacer(1, 10))

    # Direct/Walk-in patients have no app login, so this is their only digital
    # access to the report — scan to open the same password-gated viewer used
    # for the lab report PDF, scoped to every reported test on this patient.
    if b.organization_id is None:
        from services.report_link import patient_view_url
        from routers.pdf import _qr_drawing
        qr_cap = ParagraphStyle("qrcap", parent=styles["Normal"], alignment=TA_CENTER,
                                fontSize=7, textColor=colors.HexColor("#5a7060"))
        qr_block = [_qr_drawing(patient_view_url(b.patient_id), 2.2),
                   Paragraph("Scan to view & download your report online", qr_cap)]
        qr_tbl = Table([[qr_block]], colWidths=[16.2*cm])
        qr_tbl.setStyle(TableStyle([("ALIGN", (0,0), (-1,-1), "CENTER")]))
        el.append(qr_tbl)
        el.append(Spacer(1, 10))

    rows = [["Received With Thanks", ""]]
    rows.append(["Total Bill Amount", f"INR {data['total']:.2f}"])
    if data["discount_amount"]:
        rows.append(["Discount", f"INR {data['discount_amount']:.2f}"])
    rows.append(["Amount Paid", f"INR {data['paid']:.2f}"])
    due = max(0.0, data["total"] - data["paid"])
    rows.append(["Balance Due", f"INR {due:.2f}"])
    rows.append(["Payment Mode", modes])
    t = Table(rows, colWidths=[11*cm, 5.2*cm])
    t.setStyle(TableStyle([
        ("SPAN", (0,0), (1,0)),
        ("BACKGROUND", (0,0), (-1,0), colors.HexColor("#f97316")),
        ("TEXTCOLOR", (0,0), (-1,0), colors.white),
        ("FONTNAME", (0,0), (-1,0), "Helvetica-Bold"),
        ("ALIGN", (1,1), (1,-1), "RIGHT"),
        ("GRID", (0,0), (-1,-1), 0.5, colors.HexColor("#e8ecf4")),
        ("FONTNAME", (0,3), (-1,3), "Helvetica-Bold"),
        ("ROWBACKGROUNDS", (0,1), (-1,-1), [colors.white, colors.HexColor("#fafbfc")]),
    ]))
    el.append(t)
    el.append(Spacer(1, 12))

    el.append(Paragraph(f"<b>Amount in words:</b> {_amount_in_words(data['paid'])}", styles["Normal"]))
    el.append(Spacer(1, 40))
    el.append(Paragraph("For <b>MediCloud Diagnostics</b>", right))
    el.append(Spacer(1, 18))
    el.append(Paragraph("Authorised Signatory", right))

    doc.build(el)
    buf.seek(0)
    return StreamingResponse(buf, media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename=Receipt_{data['bill_no']}.pdf"})
