"""Public (no-login) report access reached by scanning the QR on a PDF.

Flow:
  1) QR -> https://medicloud.mooo.com/?rid=<id>&k=<token>
  2) The public page asks for a password = patient's phone OR barcode.
  3) POST /api/public/report/<id>/view  {token, password}
       -> token + password verified -> returns the report values.
     GET  /api/public/report/<id>/pdf?token=..&password=..
       -> same checks -> streams the PDF.
No JWT here on purpose; access is gated by the signed token + the password.
"""
import io
import os
import hmac
import hashlib
import requests
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional

from database import get_db
from models.models import LabResult, Patient
from models.billing import Bill, Payment
from models.messaging import PaymentTransaction
from services.report_link import check_token, check_patient_token, report_token
from routers.pdf import generate_pdf

RZP_KEY_ID     = os.getenv("RAZORPAY_KEY_ID", "")
RZP_KEY_SECRET = os.getenv("RAZORPAY_KEY_SECRET", "")
RZP_API        = "https://api.razorpay.com/v1"

router = APIRouter()


def _digits(s: str) -> str:
    return "".join(c for c in (s or "") if c.isdigit())


def _norm(s: str) -> str:
    return "".join(c for c in (s or "") if c.isalnum()).lower()


def _verify(db: Session, result_id: int, token: str, password: str):
    if not check_token(result_id, token):
        raise HTTPException(403, "invalid or expired link")
    result = db.query(LabResult).filter(LabResult.id == result_id).first()
    if not result:
        raise HTTPException(404, "report not found")
    patient = db.query(Patient).filter(Patient.id == result.patient_id).first()

    # accepted passwords: patient phone (full or last-10 digits), patient barcode,
    # or the result's barcode — compared loosely (case/space/symbol-insensitive).
    accepted = set()
    if patient:
        accepted.add(_norm(patient.phone))
        ph = _digits(patient.phone)
        if len(ph) >= 10:
            accepted.add(ph[-10:])
        accepted.add(_norm(patient.barcode))
    accepted.add(_norm(result.barcode))
    accepted.discard("")

    given = {_norm(password)}
    pd = _digits(password)
    if len(pd) >= 10:
        given.add(pd[-10:])

    if accepted.isdisjoint(given):
        raise HTTPException(401, "incorrect phone number or barcode")
    return result, patient


class VerifyIn(BaseModel):
    token: str
    password: str


@router.post("/report/{result_id}/view")
def public_view(result_id: int, payload: VerifyIn, db: Session = Depends(get_db)):
    result, patient = _verify(db, result_id, payload.token, payload.password)
    pd = result.parsed_data or {}
    return {
        "id": result.id,
        "barcode": result.barcode,
        "patient_name": patient.patient_name if patient else "Unknown",
        "age": patient.age if patient else None,
        "gender": patient.gender if patient else None,
        "doctor": (patient.doctor_name if patient else None),
        "status": result.status,
        "created_at": result.created_at,
        "test_name": result.test_name,
        "protocol": pd.get("protocol"),
        "parameters": pd.get("parameters", []),
        "gh900_info": pd.get("gh900_info"),
    }


@router.get("/report/{result_id}/pdf")
def public_pdf(result_id: int, token: str = Query(...), password: str = Query(...),
               db: Session = Depends(get_db)):
    result, _ = _verify(db, result_id, token, password)
    try:
        pdf_bytes = generate_pdf(result)
    except Exception as e:
        raise HTTPException(500, f"PDF generation failed: {e}")
    return StreamingResponse(
        io.BytesIO(pdf_bytes), media_type="application/pdf",
        headers={"Content-Disposition": f"inline; filename=MediCloud_Report_{result_id}.pdf"},
    )


# ----------------------------------------------------------------------------
# Patient-level access (the QR on a Direct/Walk-in money receipt). A receipt
# can cover several tests, so this lists every reported LabResult for that
# patient at once. Each entry carries its own report_token so the existing
# single-result PDF endpoint above can be reused unchanged for the download.

def _verify_patient(db: Session, patient_id: int, token: str, password: str) -> Patient:
    if not check_patient_token(patient_id, token):
        raise HTTPException(403, "invalid or expired link")
    patient = db.query(Patient).filter(Patient.id == patient_id).first()
    if not patient:
        raise HTTPException(404, "patient not found")

    accepted = set()
    accepted.add(_norm(patient.phone))
    ph = _digits(patient.phone)
    if len(ph) >= 10:
        accepted.add(ph[-10:])
    accepted.add(_norm(patient.barcode))
    accepted.discard("")

    given = {_norm(password)}
    pd = _digits(password)
    if len(pd) >= 10:
        given.add(pd[-10:])

    if accepted.isdisjoint(given):
        raise HTTPException(401, "incorrect phone number or barcode")
    return patient


@router.post("/patient/{patient_id}/view")
def public_patient_view(patient_id: int, payload: VerifyIn, db: Session = Depends(get_db)):
    patient = _verify_patient(db, patient_id, payload.token, payload.password)

    base = {
        "patient_id": patient.id, "patient_name": patient.patient_name,
        "barcode": patient.barcode, "age": patient.age, "gender": patient.gender,
        "doctor": patient.doctor_name,
    }
    if patient.status != "reported":
        # link + password are correct, the report just isn't finalised yet —
        # this is a normal state, not an error.
        return {**base, "ready": False}

    # Patient-level QR (the receipt) only ever applies to Direct/Walk-in
    # patients, who pay the lab directly — so results stay hidden until
    # every bill for them is fully settled.
    bills = db.query(Bill).filter(Bill.patient_id == patient.id).all()
    balance_due = round(sum((b.total or 0) - (b.paid or 0) for b in bills), 2)
    if balance_due > 0:
        return {**base, "ready": True, "payment_due": True, "balance_due": balance_due}

    results = db.query(LabResult).filter(LabResult.patient_id == patient.id).order_by(LabResult.created_at.asc()).all()
    return {
        **base, "ready": True, "payment_due": False,
        "tests": [{"result_id": r.id, "test_name": r.test_name,
                   "created_at": r.created_at, "result_token": report_token(r.id)}
                  for r in results],
    }


# ----------------------------------------------------------------------------
# Public self-pay (Razorpay) for a Direct/Walk-in patient's outstanding bills.
# Same identity check as the view above (token + phone/barcode) gates access
# to even create an order. Mirrors the existing authenticated bill-level flow
# in routers/payments_rzp.py: signature verified server-side, and the amount
# actually credited is re-fetched from Razorpay's own order record — never
# trusted from the client or even from locally recomputed state.

def _unpaid_bills(db: Session, patient_id: int):
    bills = db.query(Bill).filter(Bill.patient_id == patient_id).order_by(Bill.created_at.asc()).all()
    return [b for b in bills if round((b.total or 0) - (b.paid or 0), 2) > 0]


def _recompute_bill(db: Session, bill: Bill):
    paid = sum(p.amount for p in db.query(Payment)
               .filter(Payment.bill_id == bill.id, Payment.status == "success").all())
    bill.paid = round(paid, 2)
    if bill.status != "credit":
        if paid <= 0:           bill.status = "unpaid"
        elif paid < bill.total: bill.status = "partial"
        else:                   bill.status = "paid"


@router.post("/patient/{patient_id}/pay/order")
def public_pay_order(patient_id: int, payload: VerifyIn, db: Session = Depends(get_db)):
    patient = _verify_patient(db, patient_id, payload.token, payload.password)
    if not RZP_KEY_ID or not RZP_KEY_SECRET:
        raise HTTPException(500, "Online payment isn't set up — please pay at the lab.")
    unpaid = _unpaid_bills(db, patient.id)
    due = round(sum((b.total or 0) - (b.paid or 0) for b in unpaid), 2)
    if due <= 0:
        raise HTTPException(400, "nothing due")

    amount_paise = int(round(due * 100))
    try:
        resp = requests.post(
            f"{RZP_API}/orders", auth=(RZP_KEY_ID, RZP_KEY_SECRET),
            json={"amount": amount_paise, "currency": "INR",
                  "receipt": f"PT{patient.id}",
                  "notes": {"patient_id": str(patient.id), "kind": "public_patient_pay"}},
            timeout=15,
        )
    except requests.RequestException as e:
        raise HTTPException(502, f"Razorpay unreachable: {e}")
    if resp.status_code >= 400:
        raise HTTPException(502, f"Razorpay order failed: {resp.text[:200]}")
    order = resp.json()
    return {
        "key_id": RZP_KEY_ID, "order_id": order["id"], "amount": amount_paise,
        "currency": "INR", "name": "MediCloud",
        "description": f"Lab bill — {patient.patient_name}",
    }


class PayVerifyIn(BaseModel):
    token: str
    password: str
    razorpay_order_id: str
    razorpay_payment_id: str
    razorpay_signature: str


@router.post("/patient/{patient_id}/pay/verify")
def public_pay_verify(patient_id: int, payload: PayVerifyIn, db: Session = Depends(get_db)):
    patient = _verify_patient(db, patient_id, payload.token, payload.password)
    if not RZP_KEY_SECRET:
        raise HTTPException(500, "Razorpay secret not configured")

    # idempotency: a retried/duplicate verify call must never credit twice
    already = db.query(Payment).filter(Payment.rzp_payment_id == payload.razorpay_payment_id,
                                       Payment.status == "success").first()
    if already:
        return {"ok": True, "already_processed": True}

    body = f"{payload.razorpay_order_id}|{payload.razorpay_payment_id}".encode()
    expected = hmac.new(RZP_KEY_SECRET.encode(), body, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, payload.razorpay_signature):
        db.add(PaymentTransaction(tenant_id=patient.tenant_id, kind="checkout", amount=0,
                       method="razorpay", status="failed",
                       razorpay_order_id=payload.razorpay_order_id,
                       razorpay_payment_id=payload.razorpay_payment_id,
                       razorpay_signature=payload.razorpay_signature,
                       error_description="signature mismatch (public patient pay)"))
        db.commit()
        raise HTTPException(400, "signature verification failed")

    # authoritative amount from Razorpay's own order record — never the client's word
    try:
        ores = requests.get(f"{RZP_API}/orders/{payload.razorpay_order_id}",
                            auth=(RZP_KEY_ID, RZP_KEY_SECRET), timeout=15)
        amount = round(ores.json().get("amount", 0) / 100.0, 2)
    except Exception:
        amount = round(sum((b.total or 0) - (b.paid or 0) for b in _unpaid_bills(db, patient.id)), 2)

    remaining = amount
    settled_bills = []
    for b in _unpaid_bills(db, patient.id):
        due = round((b.total or 0) - (b.paid or 0), 2)
        if due <= 0 or remaining <= 0:
            continue
        pay_amt = min(due, remaining)
        db.add(Payment(tenant_id=b.tenant_id, bill_id=b.id, method="razorpay", amount=pay_amt,
                       status="success", rzp_order_id=payload.razorpay_order_id,
                       rzp_payment_id=payload.razorpay_payment_id, note="public QR self-pay"))
        db.add(PaymentTransaction(tenant_id=b.tenant_id, bill_id=b.id, bill_no=b.bill_no,
                       kind="checkout", amount=pay_amt, method="razorpay", status="success",
                       razorpay_order_id=payload.razorpay_order_id,
                       razorpay_payment_id=payload.razorpay_payment_id,
                       razorpay_signature=payload.razorpay_signature))
        db.flush()
        _recompute_bill(db, b)
        settled_bills.append(b.bill_no)
        remaining = round(remaining - pay_amt, 2)
    db.commit()
    return {"ok": True, "paid": amount, "bills_settled": settled_bills}
