"""Cost Estimate — a quote, before any sample exists.

A walk-in asks what a panel will cost, or a franchise asks for a rate card.
Nothing here creates a patient, a bill or a sample: it prices a basket of
tests and groups through the same resolver billing uses, applies a discount,
and can send the result over WhatsApp.

Direct / walk-in prices come from the base catalog; a franchise gets its own
group or organization rate, exactly as it would on a real bill.
"""
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database import get_db
from auth.deps import get_current_user, get_scope, Scope
from auth.audit import write_audit
from models.org import User, Franchise, Role
from models.clinical import TestCatalog, Package
from services.pricing import resolve_price, resolve_package_price
from services.whatsapp import send_whatsapp

router = APIRouter()

ADMIN_ROLES = (Role.SUPER_ADMIN, Role.LAB_ADMIN)


class EstimateIn(BaseModel):
    organization_id: Optional[int] = None     # None = Direct / walk-in
    test_ids:  List[int] = []
    group_ids: List[int] = []
    discount:  float = 0.0                    # flat rupees off the total
    patient_name: Optional[str] = None


class SendIn(EstimateIn):
    to_number: Optional[str] = None           # blank = the franchise's own number


def _org_for(scope: Scope, organization_id: Optional[int]) -> Optional[int]:
    """A franchise login can only ever quote its own rates."""
    if scope.role == Role.FRANCHISE:
        return scope.franchise_id
    return organization_id


def _build(db: Session, p: EstimateIn, scope: Scope) -> dict:
    org_id = _org_for(scope, p.organization_id)
    if org_id is not None and not db.query(Franchise).filter(Franchise.id == org_id).first():
        raise HTTPException(404, "organization not found")

    lines, mrp_total, price_total = [], 0.0, 0.0

    for tid in dict.fromkeys(p.test_ids):          # de-duplicated, order kept
        try:
            rp = resolve_price(db, tid, org_id)
        except ValueError:
            continue
        t = db.query(TestCatalog).filter(TestCatalog.id == tid).first()
        lines.append({"kind": "test", "id": tid, "name": t.name if t else f"#{tid}",
                      "mrp": rp.mrp, "price": rp.price, "source": rp.source})
        mrp_total += rp.mrp or 0.0
        price_total += rp.price or 0.0

    for gid in dict.fromkeys(p.group_ids):
        try:
            rp = resolve_package_price(db, gid, org_id)
        except ValueError:
            continue
        g = db.query(Package).filter(Package.id == gid).first()
        lines.append({"kind": "group", "id": gid, "name": g.name if g else f"#{gid}",
                      "mrp": rp.mrp, "price": rp.price, "source": rp.source})
        mrp_total += rp.mrp or 0.0
        price_total += rp.price or 0.0

    if not lines:
        raise HTTPException(400, "pick at least one test or group")

    # A discount cannot take the total below zero, and cannot be negative —
    # a typo in that box must not quietly inflate the quote.
    discount = max(0.0, min(float(p.discount or 0.0), price_total))
    org = db.query(Franchise).filter(Franchise.id == org_id).first() if org_id else None

    return {
        "organization_id": org_id,
        "organization_name": org.name if org else "Direct / Walk-in",
        "organization_phone": getattr(org, "phone", None) if org else None,
        "patient_name": (p.patient_name or "").strip() or None,
        "lines": lines,
        "mrp_total": round(mrp_total, 2),
        "price_total": round(price_total, 2),
        "discount": round(discount, 2),
        "payable": round(price_total - discount, 2),
    }


def _message(est: dict, lab_name: str = "Healthycian") -> str:
    """The WhatsApp body. Plain text — it has to read well on a phone."""
    out = [f"*{lab_name} — Cost Estimate*", ""]
    if est["patient_name"]:
        out.append(f"Patient: {est['patient_name']}")
    out.append(f"For: {est['organization_name']}")
    out.append("")
    for ln in est["lines"]:
        label = ln["name"] + (" (group)" if ln["kind"] == "group" else "")
        out.append(f"• {label} — Rs {ln['price']:.0f}")
    out.append("")
    out.append(f"Total: Rs {est['price_total']:.0f}")
    if est["discount"]:
        out.append(f"Discount: Rs {est['discount']:.0f}")
        out.append(f"*Payable: Rs {est['payable']:.0f}*")
    else:
        out.append(f"*Payable: Rs {est['payable']:.0f}*")
    out.append("")
    out.append("This is an estimate, not a bill. Prices may change.")
    return "\n".join(out)


@router.post("/quote")
def quote(p: EstimateIn, db: Session = Depends(get_db),
          user: User = Depends(get_current_user), scope: Scope = Depends(get_scope)):
    """Price a basket. Creates nothing."""
    est = _build(db, p, scope)
    est["message"] = _message(est)
    return est


@router.post("/send")
def send(p: SendIn, request: Request, db: Session = Depends(get_db),
         user: User = Depends(get_current_user), scope: Scope = Depends(get_scope)):
    """Send the estimate on WhatsApp.

    With no number, a franchise estimate goes to the franchise's own number —
    the "send straight to them" case. A Direct estimate always needs a number,
    because a walk-in has no number on file yet.
    """
    est = _build(db, p, scope)
    to = (p.to_number or "").strip() or est["organization_phone"]
    if not to:
        raise HTTPException(400, "no WhatsApp number — type one, or set a phone on the organization")

    body = _message(est)
    res = send_whatsapp(db, user.tenant_id, to, body)
    write_audit(db, action="estimate_sent", user=user, entity="estimate", entity_id=None,
                after={"to": to, "payable": est["payable"], "lines": len(est["lines"]),
                       "ok": bool(res.get("ok"))},
                ip=request.client.host if request.client else None)
    if not res.get("ok"):
        raise HTTPException(502, f"WhatsApp failed: {res.get('error', 'unknown error')}")
    return {"ok": True, "to": to, "payable": est["payable"], "sid": res.get("sid")}
