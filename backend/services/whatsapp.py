"""WhatsApp sending via Twilio REST API, with credentials read from the
messaging_settings table (CurryCloud pattern). No Twilio SDK dependency."""
import requests
from typing import Optional
from sqlalchemy.orm import Session
from models.messaging import MessagingSettings

TWILIO_API = "https://api.twilio.com/2010-04-01"


def get_settings(db: Session, tenant_id: Optional[int]) -> Optional[MessagingSettings]:
    q = db.query(MessagingSettings)
    if tenant_id is not None:
        s = q.filter(MessagingSettings.tenant_id == tenant_id).first()
        if s:
            return s
    return q.first()   # fall back to the single/global row


def _wa(num: str) -> str:
    """Normalise to Twilio whatsapp: format."""
    num = (num or "").strip()
    if num.startswith("whatsapp:"):
        return num
    if not num.startswith("+"):
        # assume India if a bare 10-digit number
        digits = "".join(c for c in num if c.isdigit())
        if len(digits) == 10:
            num = "+91" + digits
        else:
            num = "+" + digits
    return "whatsapp:" + num


def send_whatsapp(db: Session, tenant_id: Optional[int], to_number: str, body: str) -> dict:
    """Returns {ok, sid|error}. Never raises — caller treats failure as non-blocking."""
    s = get_settings(db, tenant_id)
    if not s or not s.whatsapp_enabled:
        return {"ok": False, "error": "whatsapp not configured/enabled"}
    if not (s.account_sid and s.auth_token and s.from_number):
        return {"ok": False, "error": "missing twilio credentials"}
    try:
        resp = requests.post(
            f"{TWILIO_API}/Accounts/{s.account_sid}/Messages.json",
            auth=(s.account_sid, s.auth_token),
            data={"From": _wa(s.from_number), "To": _wa(to_number), "Body": body},
            timeout=15,
        )
    except requests.RequestException as e:
        return {"ok": False, "error": f"twilio unreachable: {e}"}
    if resp.status_code >= 400:
        return {"ok": False, "error": resp.text[:200]}
    return {"ok": True, "sid": resp.json().get("sid")}


def render_bill_message(s: Optional[MessagingSettings], *, name: str, lab: str,
                        amount, bill_no: str, link: str = "") -> str:
    tmpl = (s.template_bill if s and s.template_bill else
            "Dear {name}, your bill at {lab} is ₹{amount}. Bill No: {bill_no}. {link}")
    try:
        return tmpl.format(name=name or "Patient", lab=lab or "Healthycian",
                           amount=amount, bill_no=bill_no, link=link or "").strip()
    except Exception:
        return f"Dear {name}, your bill {bill_no} is ₹{amount}. {link}".strip()
