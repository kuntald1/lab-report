"""Razorpay checkout for MediCloud bills (standard server-verified flow).

Flow:
  1) POST /billing/bills/{id}/razorpay/order
       -> creates a Razorpay Order for the bill's DUE amount, returns
          { key_id, order_id, amount, currency, bill_no, name, ... }
       Frontend opens Razorpay Checkout with these.
  2) Checkout success returns razorpay_payment_id + razorpay_order_id + signature.
  3) POST /billing/bills/{id}/razorpay/verify
       -> verifies HMAC signature server-side, then records a Payment row
          (method='razorpay', status='success') and recomputes the bill.

Keys are read from environment (never hardcode):
    RAZORPAY_KEY_ID       e.g. rzp_test_XXXXXXXXXXXXXX
    RAZORPAY_KEY_SECRET   e.g. xxxxxxxxxxxxxxxxxxxxxxxx
Uses Razorpay's REST API directly (no SDK dependency) via `requests`.
"""
import os
import hmac
import hashlib
import requests
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional

from database import get_db
from auth.deps import get_current_user
from auth.audit import write_audit
from models.org import User
from models.billing import Bill, Payment
from models.b2b import OrgLedger

router = APIRouter()

RZP_KEY_ID     = os.getenv("RAZORPAY_KEY_ID", "")
RZP_KEY_SECRET = os.getenv("RAZORPAY_KEY_SECRET", "")
RZP_API        = "https://api.razorpay.com/v1"


def _ip(request: Request) -> Optional[str]:
    return request.client.host if request.client else None


def _due(bill: Bill) -> float:
    return max(0.0, round((bill.total or 0) - (bill.paid or 0), 2))


def _org_outstanding(db: Session, organization_id: int) -> float:
    last = (db.query(OrgLedger)
              .filter(OrgLedger.organization_id == organization_id)
              .order_by(OrgLedger.id.desc()).first())
    return float(last.balance_after) if last and last.balance_after is not None else 0.0


def _recompute_bill(db: Session, bill: Bill):
    paid = sum(p.amount for p in db.query(Payment)
               .filter(Payment.bill_id == bill.id, Payment.status == "success").all())
    bill.paid = round(paid, 2)
    if bill.status != "credit":
        if paid <= 0:            bill.status = "unpaid"
        elif paid < bill.total:  bill.status = "partial"
        else:                    bill.status = "paid"


# ------------------------------------------------------------------ create order
@router.post("/bills/{bill_id}/razorpay/order")
def create_rzp_order(bill_id: int, db: Session = Depends(get_db),
                     user: User = Depends(get_current_user)):
    if not RZP_KEY_ID or not RZP_KEY_SECRET:
        raise HTTPException(500, "Razorpay keys not configured (RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET)")
    bill = db.query(Bill).filter(Bill.id == bill_id).first()
    if not bill:
        raise HTTPException(404, "bill not found")
    due = _due(bill)
    if due <= 0:
        raise HTTPException(400, "nothing due on this bill")

    amount_paise = int(round(due * 100))   # Razorpay works in paise
    try:
        resp = requests.post(
            f"{RZP_API}/orders",
            auth=(RZP_KEY_ID, RZP_KEY_SECRET),
            json={"amount": amount_paise, "currency": "INR",
                  "receipt": bill.bill_no or f"B{bill.id}",
                  "notes": {"bill_id": str(bill.id), "bill_no": bill.bill_no or ""}},
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
        "bill_no": bill.bill_no,
        "name": "MediCloud",
        "description": f"Bill {bill.bill_no}",
    }


# ------------------------------------------------------------------ verify + record
class VerifyIn(BaseModel):
    razorpay_order_id: str
    razorpay_payment_id: str
    razorpay_signature: str


@router.post("/bills/{bill_id}/razorpay/verify")
def verify_rzp_payment(bill_id: int, payload: VerifyIn, request: Request,
                       db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    if not RZP_KEY_SECRET:
        raise HTTPException(500, "Razorpay secret not configured")
    bill = db.query(Bill).filter(Bill.id == bill_id).first()
    if not bill:
        raise HTTPException(404, "bill not found")

    # HMAC-SHA256(order_id|payment_id, secret) must equal the signature
    body = f"{payload.razorpay_order_id}|{payload.razorpay_payment_id}".encode()
    expected = hmac.new(RZP_KEY_SECRET.encode(), body, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, payload.razorpay_signature):
        # record the failed attempt for audit, then reject
        db.add(Payment(tenant_id=bill.tenant_id, bill_id=bill.id, method="razorpay",
                       amount=_due(bill), status="failed",
                       rzp_order_id=payload.razorpay_order_id,
                       rzp_payment_id=payload.razorpay_payment_id,
                       note="signature mismatch", created_by=user.id))
        db.commit()
        raise HTTPException(400, "signature verification failed")

    amount = _due(bill)
    pay = Payment(tenant_id=bill.tenant_id, bill_id=bill.id, method="razorpay",
                  amount=amount, status="success",
                  rzp_order_id=payload.razorpay_order_id,
                  rzp_payment_id=payload.razorpay_payment_id, created_by=user.id)
    db.add(pay); db.flush()
    _recompute_bill(db, bill)
    if bill.organization_id:
        bal = _org_outstanding(db, bill.organization_id) - amount
        db.add(OrgLedger(organization_id=bill.organization_id, entry_type="payment",
                         amount=amount, balance_after=bal, ref=bill.bill_no))
    db.commit()
    write_audit(db, action="payment", user=user, entity="bill", entity_id=bill.id,
                after={"method": "razorpay", "amount": amount,
                       "rzp_payment_id": payload.razorpay_payment_id}, ip=_ip(request))
    return {"ok": True, "bill_id": bill.id, "paid": bill.paid, "status": bill.status}
