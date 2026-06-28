from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from database import get_db
from models.models import LabResult, Patient, Device
from auth.deps import get_scope, apply_scope, Scope, get_current_user
from models.org import User, Role, Franchise
from services.credit import is_franchise_locked
from parsers.astm_parser import auto_parse
from pydantic import BaseModel
from typing import Optional
from sqlalchemy import or_

router = APIRouter()

class RawDataSubmit(BaseModel):
    raw_data:    str
    device_id:   Optional[int] = None
    barcode:     Optional[str] = None
    device_type: Optional[str] = "Hematology"

@router.get("/")
def get_all_results(db: Session = Depends(get_db), scope: Scope = Depends(get_scope),
                    user: User = Depends(get_current_user),
                    barcode: Optional[str] = None, patient_id: Optional[str] = None):
    q = apply_scope(db.query(LabResult), LabResult, scope)

    # LabResult has no franchise column, so a franchise login must be scoped to
    # its own patients explicitly. We also compute whether THIS franchise is over
    # its credit limit (dynamic) -> locks the values/PDF for its own login.
    fr_locked = False
    if user.role == Role.FRANCHISE and user.franchise_id:
        own_ids = [pid for (pid,) in
                   db.query(Patient.id).filter(Patient.organization_id == user.franchise_id).all()]
        q = q.filter(LabResult.patient_id.in_(own_ids or [-1]))
        fr_locked = is_franchise_locked(db, user.franchise_id)

    if barcode:
        # match the result's own barcode OR the owning patient's barcode, so a
        # result stored under a slightly different barcode is still found.
        bc_pids = [pid for (pid,) in
                   db.query(Patient.id).filter(Patient.barcode.ilike(f"%{barcode}%")).all()]
        q = q.filter(or_(LabResult.barcode.ilike(f"%{barcode}%"),
                         LabResult.patient_id.in_(bc_pids or [-1])))
    if patient_id:
        pid = patient_id.strip()
        if pid.isdigit():
            q = q.filter(LabResult.patient_id == int(pid))
        else:
            # non-numeric: treat as a patient barcode/name search, never 422
            match = [p for (p,) in db.query(Patient.id).filter(
                or_(Patient.barcode.ilike(f"%{pid}%"),
                    Patient.patient_name.ilike(f"%{pid}%"))).all()]
            q = q.filter(LabResult.patient_id.in_(match or [-1]))
    results = q.order_by(LabResult.created_at.desc()).limit(200).all()

    # map patient -> organization, and which organizations are over limit (for the
    # lab's informational "OVER LIMIT" chip; lab access itself is never blocked).
    pat_ids = {r.patient_id for r in results if r.patient_id}
    pat_org = {p.id: p.organization_id for p in
               db.query(Patient.id, Patient.organization_id)
                 .filter(Patient.id.in_(pat_ids or [-1])).all()} if pat_ids else {}
    org_ids = {o for o in pat_org.values() if o}
    over_orgs = {oid for oid in org_ids if is_franchise_locked(db, oid)}
    org_names = {o.id: o.name for o in
                 db.query(Franchise).filter(Franchise.id.in_(org_ids or [-1])).all()}

    output = []
    for r in results:
        org_id = pat_org.get(r.patient_id)
        row = {
            "id":           r.id,
            "barcode":      r.barcode,
            "test_name":    r.test_name,
            "status":       r.status,
            "lifecycle_status": r.patient.status if r.patient else None,
            "parsed_data":  None if fr_locked else r.parsed_data,
            "created_at":   r.created_at,
            "patient_name": r.patient.patient_name if r.patient else "Unknown",
            "device_name":  r.device.name if r.device else "Manual",
            "franchise":    org_names.get(org_id),
            "over_limit":   bool(org_id in over_orgs),
            "locked":       bool(fr_locked),   # this franchise viewer is over limit
        }
        output.append(row)
    return output

@router.post("/parse")
def parse_raw_data(payload: RawDataSubmit, db: Session = Depends(get_db)):
    """
    Submit raw ASTM/HL7 text data → parse → save to DB
    This is the core middleware function
    """
    try:
        parsed = auto_parse(payload.raw_data, payload.device_type)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Parse error: {str(e)}")

    # Find patient by barcode
    barcode = payload.barcode or parsed.get("barcode") or "UNKNOWN"
    patient = db.query(Patient).filter(Patient.barcode == barcode).first()

    # Find device
    device = None
    if payload.device_id:
        device = db.query(Device).filter(Device.id == payload.device_id).first()

    # Determine test name from parameters
    params = parsed.get("parameters", [])
    test_name = payload.device_type or "Unknown Test"
    if params:
        test_name = f"{payload.device_type} ({len(params)} parameters)"

    db_result = LabResult(
        patient_id  = patient.id if patient else None,
        device_id   = device.id if device else None,
        barcode     = barcode,
        test_name   = test_name,
        raw_data    = payload.raw_data,
        parsed_data = parsed,
        status      = "completed"
    )
    db.add(db_result)
    db.commit()
    db.refresh(db_result)

    # Phase 2: auto-record a 'resulted' sample_event for TAT (never breaks ingestion)
    try:
        from services.sample_event_hook import emit_resulted_event
        emit_resulted_event(db, barcode=barcode, patient=patient,
                            device_id=(device.id if device else None))
    except Exception:
        pass

    return {
        "message":    "Data parsed and saved successfully",
        "result_id":  db_result.id,
        "barcode":    barcode,
        "patient":    patient.patient_name if patient else None,
        "parameters": len(params),
        "parsed":     parsed
    }

@router.get("/{result_id}")
def get_result(result_id: int, db: Session = Depends(get_db),
               user: User = Depends(get_current_user)):
    result = db.query(LabResult).filter(LabResult.id == result_id).first()
    if not result:
        raise HTTPException(status_code=404, detail="Result not found")

    # Franchise: only their own patients, and values withheld when over limit.
    if user.role == Role.FRANCHISE:
        patient = db.query(Patient).filter(Patient.id == result.patient_id).first()
        if not patient or patient.organization_id != user.franchise_id:
            raise HTTPException(status_code=403, detail="not your patient")
        if is_franchise_locked(db, user.franchise_id):
            return {
                "id": result.id, "barcode": result.barcode, "status": result.status,
                "created_at": result.created_at, "locked": True,
                "parsed_data": None, "raw_data": None,
                "patient": result.patient, "device": result.device,
            }

    return {
        "id":          result.id,
        "barcode":     result.barcode,
        "raw_data":    result.raw_data,
        "parsed_data": result.parsed_data,
        "status":      result.status,
        "created_at":  result.created_at,
        "locked":      False,
        "patient":     result.patient,
        "device":      result.device,
    }
