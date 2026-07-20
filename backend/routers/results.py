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
    fr_locked = False
    locked_pids = set()   # patient_ids whose bills were created over the credit limit
    if user.role == Role.FRANCHISE and user.franchise_id:
        own_ids = [pid for (pid,) in
                   db.query(Patient.id).filter(
                       or_(Patient.organization_id == user.franchise_id,
                           Patient.registered_franchise_id == user.franchise_id),
                       or_(Patient.status == "reported", Patient.status == "sample_rejected")
                   ).all()]
        q = q.filter(LabResult.patient_id.in_(own_ids or [-1]))
        fr_locked = is_franchise_locked(db, user.franchise_id)
        if fr_locked:
            from models.b2b import OrgLedger as OL
            from models.billing import Bill as BillModel
            from services.credit import franchise_credit_limit
            climit = franchise_credit_limit(db, user.franchise_id)
            ledger = (db.query(OL)
                       .filter(OL.organization_id == user.franchise_id)
                       .order_by(OL.id.asc()).all())
            over_refs = {e.ref for e in ledger
                         if e.entry_type == 'bill' and float(e.balance_after or 0) > climit}
            if over_refs:
                locked_pids = {pid for (pid,) in
                                db.query(BillModel.patient_id)
                                  .filter(BillModel.bill_no.in_(over_refs)).all()}

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

    # Also include manually reported patients who have no LabResult rows.
    # Build set of patient_ids already covered by LabResults.
    covered_pids = {r.patient_id for r in results}
    # Query reported/validated patients in scope
    pq = db.query(Patient).filter(
        Patient.status.in_(["reported", "validated", "sample_rejected"]),
        Patient.is_active.is_(True),
    )
    if scope.tenant_id is not None:
        pq = pq.filter(Patient.tenant_id == scope.tenant_id)
    if user.role == Role.FRANCHISE and user.franchise_id:
        pq = pq.filter(
            or_(Patient.organization_id == user.franchise_id,
                Patient.registered_franchise_id == user.franchise_id),
            or_(Patient.status == "reported", Patient.status == "sample_rejected")
        )
    if barcode:
        pq = pq.filter(Patient.barcode.ilike(f"%{barcode}%"))
    manual_patients = [p for p in pq.order_by(Patient.created_at.desc()).limit(200).all()
                       if p.id not in covered_pids]

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
            "over_limit":   bool(r.patient_id in locked_pids) if user.role == Role.FRANCHISE else False,
            "locked":       bool(r.patient_id in locked_pids),
        }
        output.append(row)
    # Append manual-only patients as synthetic result rows
    for p in manual_patients:
        org_id = p.organization_id
        output.append({
            "id":           None,
            "barcode":      p.barcode,
            "test_name":    "Manual Report",
            "status":       p.status,
            "lifecycle_status": p.status,
            "parsed_data":  None,
            "created_at":   p.created_at,
            "patient_name": p.patient_name,
            "device_name":  "Manual",
            "franchise":    org_names.get(org_id) if org_id in (org_names or {}) else None,
            "over_limit":   False,
            "locked":       bool(fr_locked),
        })
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

    # Find patient by barcode (or by a specific accession number scanned at the analyser)
    barcode = payload.barcode or parsed.get("barcode") or "UNKNOWN"
    params = parsed.get("parameters", [])
    test_name = payload.device_type or "Unknown Test"
    if params:
        test_name = f"{payload.device_type} ({len(params)} parameters)"
    try:
        from services.accession import resolve_patient_and_accession
        patient, accession_number = resolve_patient_and_accession(db, barcode, test_name)
    except Exception:
        patient = db.query(Patient).filter(Patient.barcode == barcode).first()
        accession_number = None

    # Find device
    device = None
    if payload.device_id:
        device = db.query(Device).filter(Device.id == payload.device_id).first()

    db_result = LabResult(
        patient_id  = patient.id if patient else None,
        device_id   = device.id if device else None,
        barcode     = barcode,
        accession_number = accession_number,
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
