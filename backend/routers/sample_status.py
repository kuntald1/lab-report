"""
Change Report Status — search samples and advance their status (single or batch).

Search and advance are both scope-filtered, so a franchise can only see/change
its own samples and a lab_admin the whole tenant.
"""
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session
from sqlalchemy import or_
from pydantic import BaseModel
from typing import Optional, List

from database import get_db
from models.org import User, Franchise
from models.models import Patient, LabResult
from auth.deps import get_current_user, get_scope, apply_scope, Scope
from auth.audit import write_audit
from services.lifecycle import record_status, STATUS_ORDER
from services.whatsapp import send_whatsapp

router = APIRouter()

REJECTION_VALID = STATUS_ORDER + ["sample_rejected"]


@router.get("/search")
def search_samples(db: Session = Depends(get_db), scope: Scope = Depends(get_scope),
                   patient_id: Optional[str] = None, barcode: Optional[str] = None,
                   branch_id: Optional[int] = None, franchise_id: Optional[int] = None,
                   status: Optional[str] = None, limit: int = 200):
    q = apply_scope(db.query(Patient), Patient, scope)
    if patient_id:
        pid = patient_id.strip()
        if pid.isdigit():
            q = q.filter(Patient.id == int(pid))
        else:
            # non-numeric: treat as a barcode/name search, never 422
            q = q.filter(or_(Patient.barcode.ilike(f"%{pid}%"),
                             Patient.patient_name.ilike(f"%{pid}%")))
    if barcode:
        q = q.filter(Patient.barcode.ilike(f"%{barcode}%"))
    if branch_id is not None:
        q = q.filter(Patient.branch_id == branch_id)
    if franchise_id is not None:
        q = q.filter(Patient.registered_franchise_id == franchise_id)
    if status:
        q = q.filter(Patient.status == status)
    patients = q.order_by(Patient.created_at.desc()).limit(min(limit, 500)).all()

    # which samples already have an analyser result (by barcode)
    barcodes = [p.barcode for p in patients if p.barcode]
    have = set()
    if barcodes:
        for (bc,) in db.query(LabResult.barcode).filter(LabResult.barcode.in_(barcodes)).all():
            have.add(bc)

    return [{
        "id": p.id, "barcode": p.barcode, "patient_name": p.patient_name,
        "status": p.status or "collected", "branch_id": p.branch_id,
        "franchise_id": p.registered_franchise_id, "has_result": p.barcode in have,
        "created_at": p.created_at,
    } for p in patients]


class AdvanceIn(BaseModel):
    patient_ids: List[int]
    status: str   # received | tested | validated | reported | sample_rejected


@router.post("/advance")
def advance_status(p: AdvanceIn, request: Request,
                   db: Session = Depends(get_db), user: User = Depends(get_current_user),
                   scope: Scope = Depends(get_scope)):
    if user.role == "patient":
        raise HTTPException(status_code=403, detail="patients cannot change status")
    if p.status not in REJECTION_VALID:
        raise HTTPException(status_code=400, detail=f"status must be one of {REJECTION_VALID}")
    if not p.patient_ids:
        raise HTTPException(status_code=400, detail="no samples selected")

    rows = (apply_scope(db.query(Patient), Patient, scope)
              .filter(Patient.id.in_(p.patient_ids)).all())
    if not rows:
        raise HTTPException(status_code=404, detail="no matching samples in your scope")

    for patient in rows:
        record_status(db, patient, p.status, actor_id=user.id, commit=False)
    db.commit()

    # When a sample is rejected → WhatsApp the franchise (if patient belongs to one)
    if p.status == "sample_rejected":
        for patient in rows:
            if patient.registered_franchise_id:
                franchise = db.query(Franchise).filter(Franchise.id == patient.registered_franchise_id).first()
                if franchise and franchise.phone:
                    msg = (f"⚠ Sample Rejected — {patient.patient_name} "
                           f"(Barcode: {patient.barcode}). "
                           f"Please collect a fresh sample and resubmit. Contact the lab for details.")
                    try:
                        send_whatsapp(franchise.phone, msg)
                    except Exception:
                        pass   # don't fail the status change if WhatsApp errors

    write_audit(db, action="status_change", user=user, entity="patient",
                entity_id=",".join(str(r.id) for r in rows),
                after={"status": p.status, "count": len(rows)},
                ip=request.client.host if request.client else None)
    return {"updated": len(rows), "status": p.status, "ids": [r.id for r in rows]}
