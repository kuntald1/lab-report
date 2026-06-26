"""Phase 3 — report workflow (doctor validation + Need More History).

Flow:
  tested --(doctor validates)--> reported
  tested --(doctor flags)------> needs_history=true  (WhatsApp to organization)
  needs_history --(org/admin fills history)--> needs_history=false (WhatsApp to doctor)
                                               -> back to doctor's tested queue
  reported is final (cannot change once validated)

Endpoints (mounted under /api/reports):
  GET  /reports/pending           -> doctor's queue: assigned + status 'tested'
  GET  /reports/validated         -> doctor's validated list (date range optional)
  GET  /reports/{patient_id}      -> one report bundle (patient + results)
  POST /reports/{patient_id}/validate         -> tested -> reported (immutable after)
  POST /reports/{patient_id}/need-history      -> flag + open history_request + WhatsApp org
  GET  /reports/history-needed     -> lab-wide queue of needs_history patients
  POST /reports/{patient_id}/fill-history      -> answer history + WhatsApp doctor
  GET  /reports/notifications      -> count + list of needs_history (for top-right badge)
"""
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session
from sqlalchemy import and_, or_
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime

from database import get_db
from auth.deps import get_current_user, get_scope, Scope
from auth.audit import write_audit
from models.org import User, Role, Franchise
from models.models import Patient, LabResult
from models.clinical import TestCatalog
from models.billing import Bill, BillItem
from models.reports import HistoryRequest
from services.whatsapp import send_whatsapp

router = APIRouter()
ADMIN_ROLES = (Role.SUPER_ADMIN, Role.LAB_ADMIN)


def _ip(request: Request) -> Optional[str]:
    return request.client.host if request.client else None


def _patient_brief(p: Patient) -> dict:
    return {"id": p.id, "barcode": p.barcode, "patient_name": p.patient_name,
            "age": p.age, "gender": p.gender, "status": p.status,
            "needs_history": bool(p.needs_history),
            "assigned_doctor_id": p.assigned_doctor_id,
            "organization_id": p.organization_id,
            "created_at": p.created_at}


# ------------------------------------------------------------------ doctor queue
@router.get("/pending")
def pending_reports(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Patients in 'tested' status whose chosen tests are assigned to this doctor.

    A patient surfaces for a doctor if ANY of these hold:
      1. patient.assigned_doctor_id == doctor            (direct/manual assignment)
      2. the patient has a BILL ITEM for a test assigned to this doctor
         (Patient -> Bill -> BillItem.test_id -> TestCatalog.assigned_doctor_id)
         -- this is the reliable path: tests are chosen when billing.
      3. the patient has a LAB RESULT for a test assigned to this doctor
         (LabResult.test_name -> TestCatalog.name -> assigned_doctor_id)
    Admins see all tested patients.
    """
    q = db.query(Patient).filter(Patient.status == "tested", Patient.is_active.is_(True))
    q = q.filter(Patient.needs_history.isnot(True))
    if user.role not in ADMIN_ROLES:
        # (2) patient ids whose bill items are for a test assigned to this doctor
        by_bill = (db.query(Bill.patient_id)
                     .join(BillItem, BillItem.bill_id == Bill.id)
                     .join(TestCatalog, TestCatalog.id == BillItem.test_id)
                     .filter(TestCatalog.assigned_doctor_id == user.id))
        # (3) patient ids with a result for a test assigned to this doctor
        by_result = (db.query(LabResult.patient_id)
                       .join(TestCatalog, TestCatalog.name == LabResult.test_name)
                       .filter(TestCatalog.assigned_doctor_id == user.id))
        q = q.filter(or_(Patient.assigned_doctor_id == user.id,
                         Patient.id.in_(by_bill),
                         Patient.id.in_(by_result)))
    rows = q.order_by(Patient.created_at.desc()).limit(500).all()
    return [_patient_brief(p) for p in rows]


@router.get("/validated")
def validated_reports(date_from: Optional[str] = None, date_to: Optional[str] = None,
                      db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Doctor's validated/reported history, optional date range on validated_at."""
    q = db.query(Patient).filter(Patient.validated_by.isnot(None))
    if user.role not in ADMIN_ROLES:
        q = q.filter(Patient.validated_by == user.id)
    if date_from:
        q = q.filter(Patient.validated_at >= date_from)
    if date_to:
        q = q.filter(Patient.validated_at <= date_to + " 23:59:59")
    rows = q.order_by(Patient.validated_at.desc()).limit(500).all()
    out = []
    for p in rows:
        d = _patient_brief(p)
        d["validated_at"] = p.validated_at
        out.append(d)
    return out


@router.get("/{patient_id}")
def report_bundle(patient_id: int, db: Session = Depends(get_db),
                  user: User = Depends(get_current_user)):
    p = db.query(Patient).filter(Patient.id == patient_id).first()
    if not p:
        raise HTTPException(404, "patient not found")
    # newest first; keep only the latest result per (test_name, calendar day).
    # Same test re-run on the SAME day -> keep latest only.
    # Same test on DIFFERENT days -> keep each day (legitimate repeat).
    all_results = (db.query(LabResult).filter(LabResult.patient_id == patient_id)
                     .order_by(LabResult.created_at.desc()).all())
    seen, results = set(), []
    for r in all_results:
        day = r.created_at.date().isoformat() if r.created_at else ""
        key = ((r.test_name or "").strip().lower(), day)
        if key in seen:
            continue
        seen.add(key)
        results.append(r)
    open_req = (db.query(HistoryRequest)
                  .filter(HistoryRequest.patient_id == patient_id,
                          HistoryRequest.status == "open")
                  .order_by(HistoryRequest.id.desc()).first())
    d = _patient_brief(p)
    d.update({
        "doctor_name": p.doctor_name,
        "clinical_history": p.clinical_history,
        "history_checklist": p.history_checklist,
        "validated_by": p.validated_by, "validated_at": p.validated_at,
        "results": [{"id": r.id, "test_name": r.test_name, "parsed_data": r.parsed_data,
                     "status": r.status, "created_at": r.created_at} for r in results],
        "open_history_request": ({"id": open_req.id, "note": open_req.note,
                                  "checklist": open_req.checklist} if open_req else None),
    })
    return d


# ------------------------------------------------------------------ validate
@router.post("/{patient_id}/validate")
def validate_report(patient_id: int, request: Request,
                    db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    p = db.query(Patient).filter(Patient.id == patient_id).first()
    if not p:
        raise HTTPException(404, "patient not found")
    # only the assigned doctor (or admin) can validate
    if user.role not in ADMIN_ROLES and p.assigned_doctor_id not in (None, user.id):
        raise HTTPException(403, "not your assigned report")
    # immutable once reported/validated
    if p.status == "reported" or p.validated_by is not None:
        raise HTTPException(400, "report already validated — cannot change")
    if p.status != "tested":
        raise HTTPException(400, f"can only validate a 'tested' report (current: {p.status})")
    if p.needs_history:
        raise HTTPException(400, "history is pending — fill it before validating")
    p.status = "reported"
    p.validated_by = user.id
    p.validated_at = datetime.utcnow()
    db.commit()
    write_audit(db, action="validate", user=user, entity="patient", entity_id=p.id,
                after={"status": "reported"}, ip=_ip(request))
    return {"ok": True, "status": p.status, "validated_at": p.validated_at}


# ------------------------------------------------------------------ need more history
class NeedHistoryIn(BaseModel):
    checklist: Optional[dict] = None     # {"diabetic": true, "fasting": false, ...}
    note: Optional[str] = None


def _org_phone(db: Session, organization_id: Optional[int]) -> Optional[str]:
    if not organization_id:
        return None
    org = db.query(Franchise).filter(Franchise.id == organization_id).first()
    return getattr(org, "phone", None) if org else None


@router.post("/{patient_id}/need-history")
def need_history(patient_id: int, payload: NeedHistoryIn, request: Request,
                 db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    p = db.query(Patient).filter(Patient.id == patient_id).first()
    if not p:
        raise HTTPException(404, "patient not found")
    if p.status == "reported":
        raise HTTPException(400, "report already validated — cannot reopen")
    p.needs_history = True
    req = HistoryRequest(tenant_id=p.tenant_id, patient_id=p.id, requested_by=user.id,
                         doctor_id=p.assigned_doctor_id or user.id,
                         checklist=payload.checklist, note=payload.note, status="open")
    db.add(req); db.commit()
    write_audit(db, action="need_history", user=user, entity="patient", entity_id=p.id,
                after={"note": payload.note}, ip=_ip(request))

    # WhatsApp the organization the patient belongs to
    org_phone = _org_phone(db, p.organization_id)
    if org_phone:
        items = []
        if payload.checklist:
            items = [k for k, v in payload.checklist.items() if v]
        ask = (", ".join(items) if items else "additional clinical history")
        note = f" Note: {payload.note}" if payload.note else ""
        body = (f"MediCloud: For patient {p.patient_name} ({p.barcode}), the doctor needs "
                f"more history: {ask}.{note} Please update it in the portal.")
        send_whatsapp(db, p.tenant_id, org_phone, body)

    return {"ok": True, "needs_history": True, "history_request_id": req.id,
            "org_notified": bool(org_phone)}


# ------------------------------------------------------------------ history-needed queue
@router.get("/queue/history-needed")
def history_needed_queue(db: Session = Depends(get_db), scope: Scope = Depends(get_scope)):
    q = db.query(Patient).filter(Patient.needs_history.is_(True), Patient.is_active.is_(True))
    if scope.tenant_id is not None:
        q = q.filter(Patient.tenant_id == scope.tenant_id)
    # org-login sees only its own patients
    if scope.role == Role.FRANCHISE and scope.franchise_id is not None:
        q = q.filter(Patient.organization_id == scope.franchise_id)
    rows = q.order_by(Patient.created_at.desc()).limit(500).all()
    out = []
    for p in rows:
        req = (db.query(HistoryRequest).filter(HistoryRequest.patient_id == p.id,
               HistoryRequest.status == "open").order_by(HistoryRequest.id.desc()).first())
        d = _patient_brief(p)
        d["request"] = ({"note": req.note, "checklist": req.checklist} if req else None)
        out.append(d)
    return out


# ------------------------------------------------------------------ fill history
class FillHistoryIn(BaseModel):
    answer: Optional[str] = None
    answer_checklist: Optional[dict] = None


@router.post("/{patient_id}/fill-history")
def fill_history(patient_id: int, payload: FillHistoryIn, request: Request,
                 db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    p = db.query(Patient).filter(Patient.id == patient_id).first()
    if not p:
        raise HTTPException(404, "patient not found")
    req = (db.query(HistoryRequest).filter(HistoryRequest.patient_id == p.id,
           HistoryRequest.status == "open").order_by(HistoryRequest.id.desc()).first())

    # store the answer onto the patient + close the request
    p.clinical_history = payload.answer
    p.history_checklist = payload.answer_checklist
    p.needs_history = False
    if req:
        req.status = "answered"
        req.answer = payload.answer
        req.answer_checklist = payload.answer_checklist
        req.answered_by = user.id
        req.answered_at = datetime.utcnow()
    db.commit()
    write_audit(db, action="fill_history", user=user, entity="patient", entity_id=p.id,
                after={"answered": True}, ip=_ip(request))

    # WhatsApp the assigned doctor that history is ready
    doctor_id = (req.doctor_id if req else None) or p.assigned_doctor_id
    if doctor_id:
        doc = db.query(User).filter(User.id == doctor_id).first()
        doc_phone = getattr(doc, "phone", None) if doc else None
        if doc_phone:
            body = (f"MediCloud: History updated for patient {p.patient_name} ({p.barcode}). "
                    f"It is back in your validation queue.")
            send_whatsapp(db, p.tenant_id, doc_phone, body)
    return {"ok": True, "needs_history": False}


# ------------------------------------------------------------------ notifications (badge)
@router.get("/notifications/history")
def history_notifications(db: Session = Depends(get_db), scope: Scope = Depends(get_scope)):
    """For the top-right badge: patients needing history (lab-wide / org-scoped)."""
    q = db.query(Patient).filter(Patient.needs_history.is_(True), Patient.is_active.is_(True))
    if scope.tenant_id is not None:
        q = q.filter(Patient.tenant_id == scope.tenant_id)
    if scope.role == Role.FRANCHISE and scope.franchise_id is not None:
        q = q.filter(Patient.organization_id == scope.franchise_id)
    rows = q.order_by(Patient.created_at.desc()).limit(50).all()
    return {"count": len(rows),
            "items": [{"patient_id": p.id, "barcode": p.barcode, "patient_name": p.patient_name}
                      for p in rows]}
