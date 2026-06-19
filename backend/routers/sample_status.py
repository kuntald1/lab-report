"""
Change Report Status — search samples and advance their status (single or batch).

Search and advance are both scope-filtered, so a franchise can only see/change
its own samples and a lab_admin the whole tenant.
"""
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional, List

from database import get_db
from models.org import User
from models.models import Patient, LabResult
from auth.deps import get_current_user, get_scope, apply_scope, Scope
from auth.audit import write_audit
from services.lifecycle import record_status, STATUS_ORDER

router = APIRouter()


@router.get("/search")
def search_samples(db: Session = Depends(get_db), scope: Scope = Depends(get_scope),
                   patient_id: Optional[int] = None, barcode: Optional[str] = None,
                   branch_id: Optional[int] = None, franchise_id: Optional[int] = None,
                   status: Optional[str] = None, limit: int = 200):
    q = apply_scope(db.query(Patient), Patient, scope)
    if patient_id is not None:
        q = q.filter(Patient.id == patient_id)
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
    status: str   # dispatched | received | tested | validated | reported (or collected)


@router.post("/advance")
def advance_status(p: AdvanceIn, request: Request,
                   db: Session = Depends(get_db), user: User = Depends(get_current_user),
                   scope: Scope = Depends(get_scope)):
    if user.role == "patient":
        raise HTTPException(status_code=403, detail="patients cannot change status")
    if p.status not in STATUS_ORDER:
        raise HTTPException(status_code=400, detail=f"status must be one of {STATUS_ORDER}")
    if not p.patient_ids:
        raise HTTPException(status_code=400, detail="no samples selected")

    # only operate on in-scope patients
    rows = (apply_scope(db.query(Patient), Patient, scope)
              .filter(Patient.id.in_(p.patient_ids)).all())
    if not rows:
        raise HTTPException(status_code=404, detail="no matching samples in your scope")

    for patient in rows:
        record_status(db, patient, p.status, actor_id=user.id, commit=False)
    db.commit()
    write_audit(db, action="status_change", user=user, entity="patient",
                entity_id=",".join(str(r.id) for r in rows),
                after={"status": p.status, "count": len(rows)},
                ip=request.client.host if request.client else None)
    return {"updated": len(rows), "status": p.status,
            "ids": [r.id for r in rows]}
