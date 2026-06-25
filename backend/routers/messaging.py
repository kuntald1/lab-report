"""Phase 3 — WhatsApp bill sending + Razorpay payment links + transactions.

Endpoints (mounted under /api/billing):
  POST /bills/{id}/payment-link     -> create a Razorpay Payment Link for the due
                                       amount; logs a 'payment_link' transaction
  POST /bills/{id}/send-whatsapp    -> send the bill over WhatsApp to a number;
                                       optionally includes a payment link
  GET  /transactions                -> list gateway transactions (filters)
  GET  /messaging-settings          -> current WhatsApp settings (token masked)
  PUT  /messaging-settings          -> upsert WhatsApp settings (admin)
"""
import os
import requests
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional

from database import get_db
from auth.deps import get_current_user, get_scope, Scope
from auth.audit import write_audit
from models.org import User, Role
from models.models import Patient
from models.billing import Bill
from models.messaging import PaymentTransaction, MessagingSettings
from services.whatsapp import send_whatsapp, get_settings, render_bill_message

router = APIRouter()
RZP_KEY_ID     = os.getenv("RAZORPAY_KEY_ID", "")
RZP_KEY_SECRET = os.getenv("RAZORPAY_KEY_SECRET", "")
RZP_API        = "https://api.razorpay.com/v1"
ADMIN_ROLES = (Role.SUPER_ADMIN, Role.LAB_ADMIN)


def _ip(request: Request) -> Optional[str]:
    return request.client.host if request.client else None


def _due(bill: Bill) -> float:
    return max(0.0, round((bill.total or 0) - (bill.paid or 0), 2))


# --------------------------------------------------------- payment link
@router.post("/bills/{bill_id}/payment-link")
def create_payment_link(bill_id: int, request: Request,
                        db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    if not RZP_KEY_ID or not RZP_KEY_SECRET:
        raise HTTPException(500, "Razorpay keys not configured")
    bill = db.query(Bill).filter(Bill.id == bill_id).first()
    if not bill:
        raise HTTPException(404, "bill not found")
    due = _due(bill)
    if due <= 0:
        raise HTTPException(400, "nothing due")
    patient = db.query(Patient).filter(Patient.id == bill.patient_id).first()
    try:
        resp = requests.post(
            f"{RZP_API}/payment_links",
            auth=(RZP_KEY_ID, RZP_KEY_SECRET),
            json={
                "amount": int(round(due * 100)), "currency": "INR",
                "description": f"Bill {bill.bill_no}",
                "customer": {"name": patient.patient_name if patient else "Patient",
                             "contact": getattr(patient, "phone", None) or ""},
                "notify": {"sms": False, "email": False},
                "reference_id": f"{bill.bill_no}-{bill.id}",
                "notes": {"bill_id": str(bill.id), "bill_no": bill.bill_no or ""},
            },
            timeout=15,
        )
    except requests.RequestException as e:
        raise HTTPException(502, f"Razorpay unreachable: {e}")
    if resp.status_code >= 400:
        # log the failure
        db.add(PaymentTransaction(tenant_id=bill.tenant_id, bill_id=bill.id, bill_no=bill.bill_no,
               kind="payment_link", amount=due, status="failed",
               error_description=resp.text[:200], created_by=user.id))
        db.commit()
        raise HTTPException(502, f"payment link failed: {resp.text[:200]}")
    link = resp.json()
    db.add(PaymentTransaction(tenant_id=bill.tenant_id, bill_id=bill.id, bill_no=bill.bill_no,
           kind="payment_link", amount=due, status="created",
           razorpay_link_id=link.get("id"), created_by=user.id))
    db.commit()
    return {"id": link.get("id"), "short_url": link.get("short_url"), "amount": due, "bill_no": bill.bill_no}


# --------------------------------------------------------- send whatsapp
class SendWhatsAppIn(BaseModel):
    to_number: str
    include_payment_link: bool = False
    save_patient_phone: bool = True


@router.post("/bills/{bill_id}/send-whatsapp")
def send_bill_whatsapp(bill_id: int, payload: SendWhatsAppIn, request: Request,
                       db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    bill = db.query(Bill).filter(Bill.id == bill_id).first()
    if not bill:
        raise HTTPException(404, "bill not found")
    patient = db.query(Patient).filter(Patient.id == bill.patient_id).first()

    # optionally remember the patient's phone for next time
    if payload.save_patient_phone and patient and payload.to_number:
        patient.phone = payload.to_number
        db.commit()

    link_url = ""
    if payload.include_payment_link and _due(bill) > 0:
        try:
            pl = create_payment_link(bill_id, request, db, user)
            link_url = pl.get("short_url") or ""
        except HTTPException:
            link_url = ""   # non-blocking: still send the bill text

    s = get_settings(db, bill.tenant_id)
    body = render_bill_message(
        s, name=patient.patient_name if patient else "Patient", lab="MediCloud",
        amount=bill.total, bill_no=bill.bill_no,
        link=(f"Pay here: {link_url}" if link_url else "Thank you!"),
    )
    res = send_whatsapp(db, bill.tenant_id, payload.to_number, body)
    write_audit(db, action="whatsapp", user=user, entity="bill", entity_id=bill.id,
                after={"to": payload.to_number, "ok": res.get("ok")}, ip=_ip(request))
    if not res.get("ok"):
        raise HTTPException(502, res.get("error", "whatsapp failed"))
    return {"ok": True, "sid": res.get("sid"), "payment_link": link_url or None}


# --------------------------------------------------------- send receipt on WhatsApp
class SendReceiptIn(BaseModel):
    to_number: Optional[str] = None     # if omitted, uses the patient's saved phone


@router.post("/bills/{bill_id}/send-receipt")
def send_receipt_whatsapp(bill_id: int, payload: SendReceiptIn, request: Request,
                          db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Send the money receipt over WhatsApp. Used after payment completes.
    Twilio sandbox can't attach PDFs, so we send a paid-confirmation message with
    the receipt download link."""
    bill = db.query(Bill).filter(Bill.id == bill_id).first()
    if not bill:
        raise HTTPException(404, "bill not found")
    patient = db.query(Patient).filter(Patient.id == bill.patient_id).first()
    to_number = payload.to_number or (patient.phone if patient else None)
    if not to_number:
        raise HTTPException(400, "no phone number for this patient")

    paid = round(bill.paid or 0, 2)
    body = (f"Dear {patient.patient_name if patient else 'Patient'}, "
            f"we have received ₹{paid:.0f} for Bill {bill.bill_no} at MediCloud. "
            f"Your money receipt is ready. Thank you!")
    res = send_whatsapp(db, bill.tenant_id, to_number, body)
    write_audit(db, action="whatsapp_receipt", user=user, entity="bill", entity_id=bill.id,
                after={"to": to_number, "ok": res.get("ok")}, ip=_ip(request))
    if not res.get("ok"):
        raise HTTPException(502, res.get("error", "whatsapp failed"))
    return {"ok": True, "sid": res.get("sid")}


# --------------------------------------------------------- transactions list
@router.get("/transactions")
def list_transactions(db: Session = Depends(get_db), scope: Scope = Depends(get_scope),
                      bill_no: Optional[str] = None, status: Optional[str] = None):
    q = db.query(PaymentTransaction)
    if scope.tenant_id is not None:
        q = q.filter(PaymentTransaction.tenant_id == scope.tenant_id)
    if bill_no:
        q = q.filter(PaymentTransaction.bill_no.ilike(f"%{bill_no}%"))
    if status:
        q = q.filter(PaymentTransaction.status == status)
    rows = q.order_by(PaymentTransaction.id.desc()).limit(500).all()
    return [{"id": t.id, "bill_no": t.bill_no, "kind": t.kind, "amount": t.amount,
             "method": t.method, "status": t.status,
             "razorpay_order_id": t.razorpay_order_id, "razorpay_payment_id": t.razorpay_payment_id,
             "razorpay_link_id": t.razorpay_link_id,
             "error_code": t.error_code, "error_description": t.error_description,
             "created_at": t.created_at} for t in rows]


# --------------------------------------------------------- settings
class MsgSettingsIn(BaseModel):
    provider: str = "twilio"
    account_sid: Optional[str] = None
    auth_token: Optional[str] = None
    from_number: Optional[str] = None
    whatsapp_enabled: bool = True
    template_bill: Optional[str] = None


def _mask(tok: Optional[str]) -> Optional[str]:
    if not tok:
        return None
    return tok[:4] + "…" + tok[-2:] if len(tok) > 6 else "•••"


@router.get("/messaging-settings")
def get_messaging_settings(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    s = get_settings(db, user.tenant_id)
    if not s:
        return {"configured": False}
    return {"configured": True, "provider": s.provider, "account_sid": s.account_sid,
            "auth_token": _mask(s.auth_token), "from_number": s.from_number,
            "whatsapp_enabled": s.whatsapp_enabled, "template_bill": s.template_bill}


@router.put("/messaging-settings")
def upsert_messaging_settings(payload: MsgSettingsIn, request: Request,
                              db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    if user.role not in ADMIN_ROLES:
        raise HTTPException(403, "admin only")
    s = db.query(MessagingSettings).filter(MessagingSettings.tenant_id == user.tenant_id).first()
    if not s:
        s = MessagingSettings(tenant_id=user.tenant_id)
        db.add(s)
    s.provider = payload.provider
    if payload.account_sid is not None: s.account_sid = payload.account_sid
    # only overwrite token if a fresh (unmasked) one is supplied
    if payload.auth_token and "…" not in payload.auth_token and "•" not in payload.auth_token:
        s.auth_token = payload.auth_token
    if payload.from_number is not None: s.from_number = payload.from_number
    s.whatsapp_enabled = payload.whatsapp_enabled
    if payload.template_bill is not None: s.template_bill = payload.template_bill
    db.commit()
    write_audit(db, action="update", user=user, entity="messaging_settings", entity_id=s.id,
                after={"provider": s.provider, "enabled": s.whatsapp_enabled}, ip=_ip(request))
    return {"ok": True}
