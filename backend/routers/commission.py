"""Referral doctor commission — ledger + payout.

Commission rows are created elsewhere (routers/reports.py, at the moment a
report is validated). This router only reads/aggregates that ledger and
lets the lab admin pay a doctor out.

Endpoints (mounted under /api/commission):
  GET  /doctors                    -> lab/admin: every referral doctor + earned/paid/outstanding
  GET  /doctors/{id}/ledger        -> lab/admin: that doctor's commission rows (+ summary), date_from/date_to optional
  POST /doctors/{id}/pay           -> lab/admin: marks unpaid rows in range as paid, creates a DoctorPayment
  GET  /me                         -> any logged-in user: matches their name to a referral doctor (for pathologists who also refer)
  GET  /me/ledger                  -> same as the by-id ledger, scoped to the matched doctor, self-service
"""
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session
from sqlalchemy import func as sqlfunc
from pydantic import BaseModel
from typing import Optional

from database import get_db
from auth.deps import get_current_user, get_scope, Scope
from models.org import User, Role, ReferralDoctor
from models.commission import DoctorCommission, DoctorPayment
from services.report_settings import asset_url

router = APIRouter()
ADMIN_ROLES = (Role.SUPER_ADMIN, Role.LAB_ADMIN)
LAB_ROLES   = (Role.SUPER_ADMIN, Role.LAB_ADMIN, Role.TECHNICIAN, Role.RECEPTIONIST)


def _require_lab(user: User):
    if user.role not in LAB_ROLES:
        raise HTTPException(403, "lab staff only")


def _ip(request: Request) -> Optional[str]:
    return request.client.host if request.client else None


def _match_doctor(db: Session, user: User) -> Optional[ReferralDoctor]:
    """Loose match: a pathologist's full_name against a referral doctor's name
    (case/space-insensitive), scoped to the same tenant when known."""
    name = (user.full_name or "").strip().lower()
    if not name:
        return None
    q = db.query(ReferralDoctor).filter(ReferralDoctor.is_active.is_(True))
    if getattr(user, "tenant_id", None) is not None:
        q = q.filter(ReferralDoctor.tenant_id == user.tenant_id)
    for d in q.all():
        if (d.name or "").strip().lower() == name:
            return d
    return None


def _ledger_rows(db: Session, doctor_id: int, date_from: Optional[str], date_to: Optional[str]):
    q = db.query(DoctorCommission).filter(DoctorCommission.referral_doctor_id == doctor_id)
    if date_from:
        q = q.filter(DoctorCommission.created_at >= date_from)
    if date_to:
        q = q.filter(DoctorCommission.created_at <= date_to + " 23:59:59")
    return q.order_by(DoctorCommission.created_at.desc()).all()


def _row_dict(r: DoctorCommission) -> dict:
    return {
        "id": r.id, "patient_name": r.patient_name, "barcode": r.barcode,
        "bill_no": r.bill_no, "test_name": r.test_name, "package_name": r.package_name,
        "accession_number": r.accession_number,
        "base_amount": r.base_amount, "commission_percent": r.commission_percent,
        "commission_amount": r.commission_amount, "is_paid": r.is_paid,
        "paid_at": r.paid_at, "validated_at": r.validated_at, "created_at": r.created_at,
    }


def _summary(rows) -> dict:
    earned = round(sum(r.commission_amount or 0 for r in rows), 2)
    paid   = round(sum(r.commission_amount or 0 for r in rows if r.is_paid), 2)
    return {"earned": earned, "paid": paid, "outstanding": round(earned - paid, 2), "count": len(rows)}


@router.get("/doctors")
def list_doctors_with_totals(db: Session = Depends(get_db), scope: Scope = Depends(get_scope),
                             user: User = Depends(get_current_user)):
    _require_lab(user)
    from services.doctor_sync import sync_pathologist_doctors, pathologist_name_set
    sync_pathologist_doctors(db, scope.tenant_id)
    path_names = pathologist_name_set(db, scope.tenant_id)
    q = db.query(ReferralDoctor).filter(ReferralDoctor.is_active.is_(True))
    if scope.tenant_id is not None:
        q = q.filter(ReferralDoctor.tenant_id == scope.tenant_id)
    out = []
    for d in q.order_by(ReferralDoctor.name).all():
        rows = db.query(DoctorCommission).filter(DoctorCommission.referral_doctor_id == d.id).all()
        s = _summary(rows)
        out.append({"id": d.id, "name": d.name, "phone": d.phone or "",
                    "commission_percent": d.commission_percent or 0,
                    "has_login": (d.name or "").strip().lower() in path_names,
                    "qualification": d.qualification or "",
                    "registration_no": d.registration_no or "",
                    "signature_url": asset_url(d.signature_filename) if d.signature_filename else None,
                    **s})
    return out


@router.get("/doctors/{doctor_id}/ledger")
def doctor_ledger(doctor_id: int, date_from: Optional[str] = None, date_to: Optional[str] = None,
                  db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    _require_lab(user)
    d = db.query(ReferralDoctor).filter(ReferralDoctor.id == doctor_id).first()
    if not d:
        raise HTTPException(404, "doctor not found")
    rows = _ledger_rows(db, doctor_id, date_from, date_to)
    return {"doctor": {"id": d.id, "name": d.name, "phone": d.phone or "",
                       "commission_percent": d.commission_percent or 0},
            "summary": _summary(rows), "entries": [_row_dict(r) for r in rows]}


class PayIn(BaseModel):
    date_from: Optional[str] = None
    date_to:   Optional[str] = None
    note:      Optional[str] = None


@router.post("/doctors/{doctor_id}/pay")
def pay_doctor(doctor_id: int, payload: PayIn, request: Request,
              db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    if user.role not in ADMIN_ROLES:
        raise HTTPException(403, "lab admin only")
    d = db.query(ReferralDoctor).filter(ReferralDoctor.id == doctor_id).first()
    if not d:
        raise HTTPException(404, "doctor not found")

    q = db.query(DoctorCommission).filter(
        DoctorCommission.referral_doctor_id == doctor_id,
        DoctorCommission.is_paid.is_(False),
    )
    if payload.date_from:
        q = q.filter(DoctorCommission.created_at >= payload.date_from)
    if payload.date_to:
        q = q.filter(DoctorCommission.created_at <= payload.date_to + " 23:59:59")
    unpaid = q.all()
    if not unpaid:
        raise HTTPException(400, "nothing unpaid in this range")

    total = round(sum(r.commission_amount or 0 for r in unpaid), 2)
    from datetime import datetime
    payment = DoctorPayment(referral_doctor_id=doctor_id, amount=total,
                            date_from=payload.date_from, date_to=payload.date_to,
                            note=payload.note, paid_by=user.id)
    db.add(payment); db.flush()
    now = datetime.utcnow()
    for r in unpaid:
        r.is_paid = True
        r.paid_at = now
        r.payment_id = payment.id
    db.commit()
    return {"ok": True, "paid": total, "entries_settled": len(unpaid), "payment_id": payment.id}


@router.get("/me")
def my_doctor_profile(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    d = _match_doctor(db, user)
    if not d:
        return {"matched": False}
    return {"matched": True, "id": d.id, "name": d.name, "phone": d.phone or "",
            "commission_percent": d.commission_percent or 0}


@router.get("/me/ledger")
def my_ledger(date_from: Optional[str] = None, date_to: Optional[str] = None,
             db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    d = _match_doctor(db, user)
    if not d:
        return {"matched": False, "summary": {"earned": 0, "paid": 0, "outstanding": 0, "count": 0}, "entries": []}
    rows = _ledger_rows(db, d.id, date_from, date_to)
    return {"matched": True,
            "doctor": {"id": d.id, "name": d.name, "commission_percent": d.commission_percent or 0},
            "summary": _summary(rows), "entries": [_row_dict(r) for r in rows]}
