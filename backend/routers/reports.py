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
from models.org import ReferralDoctor
from models.commission import DoctorCommission
from models.reports import HistoryRequest
from services.whatsapp import send_whatsapp

router = APIRouter()
ADMIN_ROLES = (Role.SUPER_ADMIN, Role.LAB_ADMIN)
# internal lab staff who can see + fill the History Needed queue and notifications
LAB_ROLES = (Role.SUPER_ADMIN, Role.LAB_ADMIN, Role.TECHNICIAN, Role.RECEPTIONIST)


def _ip(request: Request) -> Optional[str]:
    return request.client.host if request.client else None


def _patient_brief(p: Patient) -> dict:
    return {"id": p.id, "barcode": p.barcode, "patient_name": p.patient_name,
            "age": p.age, "gender": p.gender, "status": p.status,
            "needs_history": bool(p.needs_history),
            "assigned_doctor_id": p.assigned_doctor_id,
            "organization_id": p.organization_id,
            "created_at": p.created_at}


def _accessions_for_patients(db: Session, patient_ids: list, statuses: list = None) -> dict:
    """{patient_id: [accession_number, ...]} across that patient's bills — batched, no N+1.
    Pass `statuses` to only include bill_items currently at those statuses (e.g. ['tested']
    for "ready to validate") instead of every accession the patient has ever had, regardless
    of whether that specific test has actually reached this stage yet."""
    if not patient_ids:
        return {}
    q = (db.query(BillItem.accession_number, Bill.patient_id)
           .join(Bill, Bill.id == BillItem.bill_id)
           .filter(Bill.patient_id.in_(patient_ids), BillItem.accession_number.isnot(None)))
    if statuses:
        q = q.filter(BillItem.status.in_(statuses))
    out = {}
    for acc, pid in q.all():
        out.setdefault(pid, []).append(acc)
    return out


# ------------------------------------------------------------------ doctor queue
def _pending_query(db: Session, user: User):
    """Shared filter for a doctor's pending queue. A patient qualifies if at least one of
    their TESTS (bill_items) has actually reached 'tested' status — not the old patient-level
    Patient.status field, which isn't kept in sync with the per-test status system anymore
    (Change Report Status moved to per-accession status on bill_items a while back)."""
    tested_patient_ids = (db.query(Bill.patient_id)
                             .join(BillItem, BillItem.bill_id == Bill.id)
                             .filter(BillItem.status == "tested")
                             .distinct())
    q = db.query(Patient).filter(Patient.id.in_(tested_patient_ids), Patient.is_active.is_(True))
    q = q.filter(Patient.needs_history.isnot(True))
    if user.role not in ADMIN_ROLES:
        by_bill = (db.query(Bill.patient_id)
                     .join(BillItem, BillItem.bill_id == Bill.id)
                     .join(TestCatalog, TestCatalog.id == BillItem.test_id)
                     .filter(TestCatalog.assigned_doctor_id == user.id))
        by_result = (db.query(LabResult.patient_id)
                       .join(TestCatalog, TestCatalog.name == LabResult.test_name)
                       .filter(TestCatalog.assigned_doctor_id == user.id))
        q = q.filter(or_(Patient.assigned_doctor_id == user.id,
                         Patient.id.in_(by_bill),
                         Patient.id.in_(by_result)))
    return q


@router.get("/pending")
def pending_reports(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Patients in 'tested' status whose chosen tests are assigned to this doctor.

    A patient surfaces for a doctor if ANY of these hold:
      1. patient.assigned_doctor_id == doctor            (direct/manual assignment)
      2. the patient has a BILL ITEM for a test assigned to this doctor
      3. the patient has a LAB RESULT for a test assigned to this doctor
    Admins see all tested patients.
    """
    rows = _pending_query(db, user).order_by(Patient.created_at.desc()).limit(500).all()
    accmap = _accessions_for_patients(db, [p.id for p in rows], statuses=["tested"])
    out = []
    for p in rows:
        d = _patient_brief(p)
        d["accession_numbers"] = accmap.get(p.id, [])
        out.append(d)
    return out


@router.get("/notifications/pending")
def pending_notifications(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Doctor bell: count + list of reports awaiting THIS doctor's validation.
    Scoped to the logged-in doctor only (same filter as the pending queue),
    so one doctor never sees another doctor's reports. Non-doctor lab/admin
    roles can still call it; it just reflects their own pending scope."""
    rows = _pending_query(db, user).order_by(Patient.created_at.desc()).limit(50).all()
    return {"count": len(rows),
            "items": [{"patient_id": p.id, "barcode": p.barcode, "patient_name": p.patient_name}
                      for p in rows]}


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
    accmap = _accessions_for_patients(db, [p.id for p in rows], statuses=["reported"])
    out = []
    for p in rows:
        d = _patient_brief(p)
        d["validated_at"] = p.validated_at
        d["accession_numbers"] = accmap.get(p.id, [])
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
    # full history trail: every request the doctor(s) raised, latest first
    all_reqs = (db.query(HistoryRequest)
                  .filter(HistoryRequest.patient_id == patient_id)
                  .order_by(HistoryRequest.id.desc()).all())

    def _asked(req):
        if req.checklist:
            return [k for k, v in req.checklist.items() if v]
        return []

    history_trail = [{
        "id": r.id,
        "asked_for": _asked(r),
        "note": r.note,
        "status": r.status,                      # open | answered
        "answer": r.answer,
        "answer_checklist": ([k for k, v in (r.answer_checklist or {}).items() if v]),
        "created_at": r.created_at,
        "answered_at": r.answered_at,
    } for r in all_reqs]

    d = _patient_brief(p)
    d.update({
        "doctor_name": p.doctor_name,
        "clinical_history": p.clinical_history,
        "history_checklist": p.history_checklist,
        "validated_by": p.validated_by, "validated_at": p.validated_at,
        "results": [{"id": r.id, "test_name": r.test_name, "parsed_data": r.parsed_data,
                     "accession_number": r.accession_number, "note": r.note,
                     "status": r.status, "created_at": r.created_at} for r in results],
        "open_history_request": ({"id": open_req.id, "note": open_req.note,
                                  "checklist": open_req.checklist} if open_req else None),
        "history_trail": history_trail,
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
    # history must be resolved before validating
    if p.needs_history:
        raise HTTPException(400, "history is pending — fill it before validating")
    # re-validation is allowed: re-stamp validator + timestamp each time
    was_reported = (p.status == "reported")
    p.status = "reported"
    p.validated_by = user.id
    p.validated_at = datetime.utcnow()

    # Advance the actual per-test status too — this is what Change Report Status, Results,
    # and receipts read from; only touch bill_items that were genuinely ready (status='tested'),
    # never ones still sitting at collected/received so we don't silently skip stages on them.
    bill_ids = [b.id for b in db.query(Bill.id).filter(Bill.patient_id == p.id).all()]
    advanced_items = []
    if bill_ids:
        advanced_items = (db.query(BillItem)
                            .filter(BillItem.bill_id.in_(bill_ids), BillItem.status == "tested")
                            .all())
        for it in advanced_items:
            it.status = "reported"

    db.commit()
    write_audit(db, action=("revalidate" if was_reported else "validate"),
                user=user, entity="patient", entity_id=p.id,
                after={"status": "reported", "bill_items_advanced": [it.id for it in advanced_items]},
                ip=_ip(request))

    # Commission: fires once, the first time a report is validated, off whatever
    # bill items exist for this patient at that moment. Wrapped so a commission
    # issue can never block the doctor from validating the report.
    if not was_reported and p.referral_doctor_id:
        try:
            doctor = db.query(ReferralDoctor).filter(ReferralDoctor.id == p.referral_doctor_id,
                                                      ReferralDoctor.is_active.is_(True)).first()
            if doctor and (doctor.commission_percent or 0) > 0:
                bill_ids = [b.id for b in db.query(Bill.id).filter(Bill.patient_id == p.id).all()]
                if bill_ids:
                    bills_by_id = {b.id: b for b in db.query(Bill).filter(Bill.id.in_(bill_ids)).all()}
                    items = db.query(BillItem).filter(BillItem.bill_id.in_(bill_ids)).all()
                    for it in items:
                        already = db.query(DoctorCommission.id).filter(
                            DoctorCommission.patient_id == p.id,
                            DoctorCommission.bill_id == it.bill_id,
                            DoctorCommission.test_name == it.test_name,
                        ).first()
                        if already:
                            continue   # idempotent guard against double-firing
                        base = it.price or 0.0   # pre-discount resolved price, per the agreed commission basis
                        pct = doctor.commission_percent or 0.0
                        bill = bills_by_id.get(it.bill_id)
                        db.add(DoctorCommission(
                            tenant_id=p.tenant_id, referral_doctor_id=doctor.id,
                            patient_id=p.id, patient_name=p.patient_name, barcode=p.barcode,
                            bill_id=it.bill_id, bill_no=bill.bill_no if bill else None,
                            test_name=it.test_name, package_name=it.package_name,
                            accession_number=it.accession_number,
                            base_amount=base, commission_percent=pct,
                            commission_amount=round(base * pct / 100.0, 2),
                            validated_at=p.validated_at,
                        ))
                    db.commit()
        except Exception:
            db.rollback()   # never let a commission glitch affect the validation that already succeeded

    return {"ok": True, "status": p.status, "validated_at": p.validated_at,
            "revalidated": was_reported}


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
        body = (f"Healthycian: For patient {p.patient_name} ({p.barcode}), the doctor needs "
                f"more history: {ask}.{note} Please update it in the portal.")
        send_whatsapp(db, p.tenant_id, org_phone, body)

    return {"ok": True, "needs_history": True, "history_request_id": req.id,
            "org_notified": bool(org_phone)}


# ------------------------------------------------------------------ history-needed queue
@router.get("/queue/history-needed")
def history_needed_queue(db: Session = Depends(get_db), scope: Scope = Depends(get_scope),
                               user: User = Depends(get_current_user)):
    if scope.role not in LAB_ROLES and scope.role != "franchise":
        raise HTTPException(403, "lab staff or franchise only")
    q = db.query(Patient).filter(Patient.needs_history.is_(True), Patient.is_active.is_(True))
    if scope.tenant_id is not None:
        q = q.filter(Patient.tenant_id == scope.tenant_id)
    if scope.role == "franchise" and scope.franchise_id is not None:
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
    if user.role not in LAB_ROLES and user.role != "franchise":
        raise HTTPException(403, "lab staff or franchise only")
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
            body = (f"Healthycian: History updated for patient {p.patient_name} ({p.barcode}). "
                    f"It is back in your validation queue.")
            send_whatsapp(db, p.tenant_id, doc_phone, body)
    return {"ok": True, "needs_history": False}


# ------------------------------------------------------------------ notifications (badge)
@router.get("/notifications/history")
def history_notifications(db: Session = Depends(get_db), scope: Scope = Depends(get_scope),
                           user: User = Depends(get_current_user)):
    """For the top-right badge: patients needing history.
    Lab staff see all; franchise sees only their own patients."""
    if scope.role not in LAB_ROLES and scope.role != "franchise":
        return {"count": 0, "items": []}
    q = db.query(Patient).filter(Patient.needs_history.is_(True), Patient.is_active.is_(True))
    if scope.tenant_id is not None:
        q = q.filter(Patient.tenant_id == scope.tenant_id)
    if scope.role == "franchise" and scope.franchise_id is not None:
        q = q.filter(Patient.organization_id == scope.franchise_id)
    rows = q.order_by(Patient.created_at.desc()).limit(50).all()
    return {"count": len(rows),
            "items": [{"patient_id": p.id, "barcode": p.barcode, "patient_name": p.patient_name}
                      for p in rows]}


# ------------------------------------------------------------------ rejected-sample notifications
@router.get("/notifications/rejected")
def rejected_notifications(db: Session = Depends(get_db), user: User = Depends(get_current_user),
                            scope: Scope = Depends(get_scope)):
    """Bell badge for rejected samples — visible to lab roles AND the owning franchise."""
    import datetime as dt
    cutoff = dt.datetime.utcnow() - dt.timedelta(days=30)
    q = db.query(Patient).filter(
        Patient.status == "sample_rejected",
        Patient.is_active.is_(True),
        Patient.created_at >= cutoff,
    )
    if scope.tenant_id is not None:
        q = q.filter(Patient.tenant_id == scope.tenant_id)
    if scope.role == "franchise":
        q = q.filter(Patient.registered_franchise_id == user.franchise_id)
    elif scope.role not in LAB_ROLES:
        return {"count": 0, "items": []}

    rows = q.order_by(Patient.created_at.desc()).limit(50).all()
    return {
        "count": len(rows),
        "items": [{"patient_id": p.id, "barcode": p.barcode, "patient_name": p.patient_name,
                   "rejected_at": p.created_at} for p in rows],
    }
