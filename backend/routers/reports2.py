"""Phase 3 — analytical reports.

  GET /reports2/sample-details   one row per patient/barcode, with nested
      tests (name/doctor/price), payment history (every attempt incl. failures),
      and clinical history trail. Filters: franchise, branch, from, to,
      patient_id, barcode, status.

Mounted under /api/reports2 (separate from the clinical /api/reports router).
"""
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from typing import Optional
from datetime import datetime

from database import get_db
from auth.deps import get_current_user
from models.org import User, Franchise
from models.models import Patient, LabResult
from models.billing import Bill, BillItem, Payment
from models.clinical import TestCatalog
from models.messaging import PaymentTransaction
from models.reports import HistoryRequest

router = APIRouter()


def _name_map(db: Session, model, ids):
    ids = {i for i in ids if i}
    if not ids:
        return {}
    rows = db.query(model).filter(model.id.in_(ids)).all()
    out = {}
    for r in rows:
        out[r.id] = getattr(r, "name", None) or getattr(r, "branch_name", None) or str(r.id)
    return out


@router.get("/sample-details")
def sample_details(
    franchise_id: Optional[int] = None,
    branch_id: Optional[int] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    patient_id: Optional[str] = None,
    barcode: Optional[str] = None,
    status: Optional[str] = None,        # dispatched|received|tested|validated|reported
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    # --- base patient query with filters ---
    q = db.query(Patient).filter(Patient.is_active.is_(True))
    if franchise_id:
        q = q.filter((Patient.organization_id == franchise_id) |
                     (Patient.registered_franchise_id == franchise_id))
    if branch_id:
        q = q.filter(Patient.branch_id == branch_id)
    if patient_id:
        q = q.filter(Patient.id == int(patient_id)) if patient_id.isdigit() else q
    if barcode:
        q = q.filter(Patient.barcode.ilike(f"%{barcode}%"))
    if status:
        q = q.filter(Patient.status == status)
    if date_from:
        q = q.filter(Patient.created_at >= date_from)
    if date_to:
        q = q.filter(Patient.created_at <= date_to + " 23:59:59")
    patients = q.order_by(Patient.created_at.desc()).limit(1000).all()
    if not patients:
        return {"rows": [], "totals": {"patients": 0, "billed": 0.0, "collected": 0.0}}

    pids = [p.id for p in patients]

    # --- franchise + branch name maps ---
    fr_ids = {p.organization_id for p in patients} | {p.registered_franchise_id for p in patients}
    franchises = _name_map(db, Franchise, fr_ids)
    # branches may be a separate table; fall back to id if unavailable
    try:
        from models.org import Branch  # type: ignore
        branches = _name_map(db, Branch, {p.branch_id for p in patients})
    except Exception:
        branches = {}

    # --- bills + items for these patients ---
    bills = db.query(Bill).filter(Bill.patient_id.in_(pids)).all()
    bills_by_patient = {}
    bill_ids = []
    for b in bills:
        bills_by_patient.setdefault(b.patient_id, []).append(b)
        bill_ids.append(b.id)

    items_by_bill = {}
    if bill_ids:
        for it in db.query(BillItem).filter(BillItem.bill_id.in_(bill_ids)).all():
            items_by_bill.setdefault(it.bill_id, []).append(it)

    # doctor names for the tests (test_catalog.assigned_doctor_id -> user.name)
    test_ids = {it.test_id for items in items_by_bill.values() for it in items if it.test_id}
    tc_doc = {}
    if test_ids:
        for tc in db.query(TestCatalog).filter(TestCatalog.id.in_(test_ids)).all():
            tc_doc[tc.id] = tc.assigned_doctor_id
    doc_ids = {d for d in tc_doc.values() if d}
    doc_names = {}
    if doc_ids:
        for u in db.query(User).filter(User.id.in_(doc_ids)).all():
            doc_names[u.id] = getattr(u, "name", None) or getattr(u, "full_name", None) or u.email

    # --- payment transactions (the full attempt history) keyed by bill ---
    tx_by_bill = {}
    if bill_ids:
        for t in (db.query(PaymentTransaction)
                    .filter(PaymentTransaction.bill_id.in_(bill_ids))
                    .order_by(PaymentTransaction.created_at.asc()).all()):
            tx_by_bill.setdefault(t.bill_id, []).append(t)
    # successful cash/manual payments are in the Payment table
    pay_by_bill = {}
    if bill_ids:
        for pay in db.query(Payment).filter(Payment.bill_id.in_(bill_ids)).all():
            pay_by_bill.setdefault(pay.bill_id, []).append(pay)

    # --- clinical history trail keyed by patient ---
    hist_by_patient = {}
    for h in (db.query(HistoryRequest).filter(HistoryRequest.patient_id.in_(pids))
                .order_by(HistoryRequest.id.desc()).all()):
        asked = [k for k, v in (h.checklist or {}).items() if v] if h.checklist else []
        hist_by_patient.setdefault(h.patient_id, []).append({
            "asked_for": asked, "note": h.note, "status": h.status,
            "answer": h.answer, "answered_at": h.answered_at, "created_at": h.created_at,
        })

    # --- assemble one row per patient ---
    rows, tot_billed, tot_collected = [], 0.0, 0.0
    for p in patients:
        pbills = bills_by_patient.get(p.id, [])
        tests, billed, collected = [], 0.0, 0.0
        payment_history = []
        payment_modes = set()

        for b in pbills:
            billed += (b.total or 0.0)
            collected += (b.paid or 0.0)
            for it in items_by_bill.get(b.id, []):
                tests.append({
                    "test_name": it.test_name,
                    "doctor": doc_names.get(tc_doc.get(it.test_id), None),
                    "price": it.price, "mrp": it.mrp,
                    "bill_no": b.bill_no,
                })
            # payment history: every transaction attempt (incl. failures)
            for t in tx_by_bill.get(b.id, []):
                if t.method:
                    payment_modes.add(t.method)
                payment_history.append({
                    "bill_no": b.bill_no, "kind": t.kind, "amount": t.amount,
                    "method": t.method, "status": t.status,
                    "error": t.error_description, "at": t.created_at,
                })
            # successful manual/cash payments
            for pay in pay_by_bill.get(b.id, []):
                if getattr(pay, "mode", None):
                    payment_modes.add(pay.mode)
                payment_history.append({
                    "bill_no": b.bill_no, "kind": "payment",
                    "amount": getattr(pay, "amount", None),
                    "method": getattr(pay, "mode", None),
                    "status": getattr(pay, "status", "success"),
                    "error": None, "at": getattr(pay, "created_at", None),
                })

        payment_history.sort(key=lambda x: (x["at"] or datetime.min))
        tot_billed += billed
        tot_collected += collected

        rows.append({
            "patient_id": p.id, "barcode": p.barcode, "patient_name": p.patient_name,
            "age": p.age, "gender": p.gender, "status": p.status,
            "franchise": franchises.get(p.organization_id) or franchises.get(p.registered_franchise_id) or "Direct / Walk-in",
            "branch": branches.get(p.branch_id) or (str(p.branch_id) if p.branch_id else "—"),
            "referring_doctor": p.doctor_name,
            "registered_at": p.created_at,
            "tests": tests,
            "billed": round(billed, 2), "collected": round(collected, 2),
            "balance": round(billed - collected, 2),
            "payment_modes": sorted(payment_modes),
            "payment_history": payment_history,
            "clinical_history": hist_by_patient.get(p.id, []),
        })

    return {"rows": rows,
            "totals": {"patients": len(rows),
                       "billed": round(tot_billed, 2),
                       "collected": round(tot_collected, 2),
                       "balance": round(tot_billed - tot_collected, 2)}}
