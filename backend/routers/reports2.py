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
from models.org import User, Franchise, Role
from models.models import Patient, LabResult
from models.billing import Bill, BillItem, Payment
from models.clinical import TestCatalog
from models.messaging import PaymentTransaction
from models.reports import HistoryRequest
from services.credit import franchise_locked, is_franchise_locked

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
    # SECURITY: a franchise login only sees patients registered under it.
    if user.role == Role.FRANCHISE and user.franchise_id:
        franchise_id = user.franchise_id
    locked = franchise_locked(db, user)   # over credit limit -> hide values/PDF
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
    # which of those franchises are over their credit limit (for the info banner)
    over_limit_orgs = {fid for fid in fr_ids if fid and is_franchise_locked(db, fid)}
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

    # --- lab results keyed by (patient_id, normalized test_name) -> latest result_id (for PDF link) ---
    result_id_by_key = {}
    for r in (db.query(LabResult).filter(LabResult.patient_id.in_(pids))
                .order_by(LabResult.created_at.desc()).all()):
        key = (r.patient_id, (r.test_name or "").strip().lower())
        if key not in result_id_by_key:        # keep latest (desc order)
            result_id_by_key[key] = r.id

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
                rid = result_id_by_key.get((p.id, (it.test_name or "").strip().lower()))
                tests.append({
                    "test_name": it.test_name,
                    "doctor": doc_names.get(tc_doc.get(it.test_id), None),
                    "price": it.price, "mrp": it.mrp,
                    "bill_no": b.bill_no,
                    "result_id": None if locked else rid,  # locked franchise: no PDF link
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
            "over_limit": bool(p.organization_id in over_limit_orgs or p.registered_franchise_id in over_limit_orgs),
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
            "locked": locked,
            "any_over_limit": any(r.get("over_limit") for r in rows),
            "totals": {"patients": len(rows),
                       "billed": round(tot_billed, 2),
                       "collected": round(tot_collected, 2),
                       "balance": round(tot_billed - tot_collected, 2)}}


# ============================================================ DASHBOARD (revenue)
def _norm_method(raw: Optional[str]) -> str:
    """Map stored payment methods to canonical buckets: CASH / UPI / CARD / CREDIT / ONLINE."""
    m = (raw or "").strip().lower()
    if m in ("cash",): return "CASH"
    if m in ("upi", "gpay", "googlepay", "phonepe", "paytm", "bhim", "qr"): return "UPI"
    if m in ("card", "credit_card", "debit_card", "creditcard", "debitcard"): return "CARD"
    if m in ("credit", "due", "outstanding"): return "CREDIT"
    if m in ("netbanking", "net_banking", "online", "razorpay", "wallet", "payment_link", "paymentlink", "link"): return "ONLINE"
    if not m: return "CASH"          # blank mode on a manual payment = cash
    return m.upper()


@router.get("/patient-detail/{patient_id}")
def patient_detail(patient_id: int, db: Session = Depends(get_db),
                   user: User = Depends(get_current_user)):
    """Full drill-down for one patient: tests, payment history, clinical history.
    Reuses the same assembly as /sample-details for a single patient."""
    res = sample_details(patient_id=str(patient_id), db=db, user=user)
    rows = res.get("rows", [])
    return rows[0] if rows else None


@router.get("/dashboard")
def dashboard(
    franchise_id: Optional[int] = None,
    branch_id: Optional[int] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """CurryCloud-style revenue dashboard. Shows BOTH billed (bill totals) and
    collected (payments received). Filters: franchise, branch, from, to."""
    # SECURITY: a franchise login may only ever see its own organization's data.
    if user.role == Role.FRANCHISE and user.franchise_id:
        franchise_id = user.franchise_id
    q = db.query(Bill)
    if franchise_id:
        q = q.filter(Bill.organization_id == franchise_id)
    if branch_id:
        q = q.filter(Bill.branch_id == branch_id)
    if date_from:
        q = q.filter(Bill.created_at >= date_from)
    if date_to:
        q = q.filter(Bill.created_at <= date_to + " 23:59:59")
    bills = q.order_by(Bill.created_at.desc()).limit(5000).all()

    n = len(bills)
    billed    = sum(b.total or 0.0 for b in bills)
    collected = sum(b.paid or 0.0 for b in bills)
    discount  = sum(b.discount_amount or 0.0 for b in bills)
    credit    = sum((b.total or 0.0) - (b.paid or 0.0) for b in bills if (b.status or "") == "credit")
    balance   = billed - collected
    avg_bill  = (billed / n) if n else 0.0

    # daily series (billed + collected per day)
    daily = {}
    for b in bills:
        d = (b.created_at.date().isoformat() if b.created_at else "—")
        slot = daily.setdefault(d, {"date": d, "billed": 0.0, "collected": 0.0, "bills": 0})
        slot["billed"] += (b.total or 0.0)
        slot["collected"] += (b.paid or 0.0)
        slot["bills"] += 1
    daily_list = sorted(daily.values(), key=lambda x: x["date"])

    # payment-method split from successful payments + transactions
    bill_ids = [b.id for b in bills]
    # payment-method split.
    #   Online money (razorpay / payment_link / etc.) is recorded in
    #   payment_transactions with status='success'. Cash, however, is settled
    #   directly onto the bill (bills.paid) WITHOUT any transaction row.
    #   So: ONLINE = sum of successful gateway transactions per bill;
    #       CASH   = residual (bills.paid - online) for that bill.
    #   This makes the method split reconcile exactly to total collected.
    method_tot = {}
    if bill_ids:
        # successful online amount per bill, classified by gateway method
        online_by_bill = {}        # bill_id -> total online amount
        for t in (db.query(PaymentTransaction)
                    .filter(PaymentTransaction.bill_id.in_(bill_ids),
                            PaymentTransaction.status == "success").all()):
            raw = (t.method or "").strip().lower()
            kind = (t.kind or "").strip().lower()
            amt = t.amount or 0.0
            # gateway label: prefer method; payment_link rows have null method
            label = raw or ("payment_link" if kind == "payment_link" else "online")
            m = _norm_method(label)
            method_tot[m] = method_tot.get(m, 0.0) + amt
            online_by_bill[t.bill_id] = online_by_bill.get(t.bill_id, 0.0) + amt

        # cash = whatever a bill marked paid that did NOT come through a gateway
        for b in bills:
            paid = b.paid or 0.0
            online = online_by_bill.get(b.id, 0.0)
            cash = round(paid - online, 2)
            if cash > 0.005:
                method_tot["CASH"] = method_tot.get("CASH", 0.0) + cash
    methods = [{"method": k, "amount": round(v, 2)} for k, v in sorted(method_tot.items(), key=lambda x: -x[1])]

    # franchise breakdown
    fr_ids = {b.organization_id for b in bills}
    fr_names = _name_map(db, Franchise, fr_ids)
    fr_break = {}
    for b in bills:
        key = b.organization_id
        name = fr_names.get(key, "Direct / Walk-in") if key else "Direct / Walk-in"
        slot = fr_break.setdefault(name, {"company": name, "bills": 0, "billed": 0.0, "collected": 0.0, "credit": 0.0})
        slot["bills"] += 1
        slot["billed"] += (b.total or 0.0)
        slot["collected"] += (b.paid or 0.0)
        if (b.status or "") == "credit":
            slot["credit"] += (b.total or 0.0) - (b.paid or 0.0)
    for s in fr_break.values():
        s["avg_bill"] = round(s["billed"] / s["bills"], 2) if s["bills"] else 0.0
        s["share"] = round((s["billed"] / billed * 100), 1) if billed else 0.0
        s["billed"] = round(s["billed"], 2); s["collected"] = round(s["collected"], 2); s["credit"] = round(s["credit"], 2)
    breakdown = sorted(fr_break.values(), key=lambda x: -x["billed"])

    # recent bills list (with patient id + barcode for drill-down)
    rb_pids = {b.patient_id for b in bills[:30] if b.patient_id}
    pat_map = {}
    if rb_pids:
        for pt in db.query(Patient).filter(Patient.id.in_(rb_pids)).all():
            pat_map[pt.id] = {"barcode": pt.barcode, "patient_name": pt.patient_name}
    recent = [{
        "bill_no": b.bill_no, "company": (fr_names.get(b.organization_id) if b.organization_id else "Direct / Walk-in"),
        "status": b.status, "total": round(b.total or 0.0, 2), "paid": round(b.paid or 0.0, 2),
        "created_at": b.created_at,
        "patient_id": b.patient_id,
        "barcode": pat_map.get(b.patient_id, {}).get("barcode"),
        "patient_name": pat_map.get(b.patient_id, {}).get("patient_name"),
    } for b in bills[:30]]

    return {
        "kpis": {"bills": n, "billed": round(billed, 2), "collected": round(collected, 2),
                 "balance": round(balance, 2), "discount": round(discount, 2),
                 "credit": round(credit, 2), "avg_bill": round(avg_bill, 2)},
        "daily": daily_list, "methods": methods, "breakdown": breakdown, "recent": recent,
    }
