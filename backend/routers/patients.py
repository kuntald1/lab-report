from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session
from database import get_db
from models.models import Patient
from auth.deps import get_current_user, get_scope, apply_scope, Scope
from auth.audit import write_audit
from services.lifecycle import record_status
from models.org import User
from pydantic import BaseModel
from typing import Optional
import random, string

router = APIRouter()


class PatientCreate(BaseModel):
    patient_name: str
    age:          Optional[int] = None
    gender:       Optional[str] = None
    doctor_name:  Optional[str] = None
    sample_type:  Optional[str] = "Blood"
    barcode:      Optional[str] = None
    abha_number:  Optional[str] = None
    phone:        Optional[str] = None
    branch_id:               Optional[int] = None
    registered_franchise_id: Optional[int] = None
    organization_id:         Optional[int] = None   # B2B link; NULL = Direct/walk-in
    clinical_history:        Optional[str]  = None   # free-text note captured at registration
    history_checklist:       Optional[dict] = None   # {diabetic, fasting, on_medication, pregnant, hypertension}


class PatientUpdate(BaseModel):
    """All fields optional — only the ones sent are changed."""
    patient_name: Optional[str] = None
    age:          Optional[int] = None
    gender:       Optional[str] = None
    doctor_name:  Optional[str] = None
    sample_type:  Optional[str] = None
    abha_number:  Optional[str] = None
    phone:        Optional[str] = None
    branch_id:               Optional[int] = None
    registered_franchise_id: Optional[int] = None
    organization_id:         Optional[int] = None
    clinical_history:        Optional[str]  = None
    history_checklist:       Optional[dict] = None


def generate_barcode():
    return "MC" + ''.join(random.choices(string.digits, k=8))


def _clean_abha(v: Optional[str]) -> Optional[str]:
    """Keep digits only (ABHA is a 14-digit number; users may type spaces/hyphens)."""
    if not v:
        return None
    digits = ''.join(ch for ch in v if ch.isdigit())
    return digits or None


def _serialize(p: Patient) -> dict:
    return {
        "id": p.id, "barcode": p.barcode, "patient_name": p.patient_name,
        "age": p.age, "gender": p.gender, "doctor_name": p.doctor_name,
        "sample_type": p.sample_type, "status": p.status,
        "abha_number": p.abha_number, "phone": p.phone, "is_active": p.is_active,
        "tenant_id": p.tenant_id, "branch_id": p.branch_id,
        "registered_franchise_id": p.registered_franchise_id,
        "organization_id": p.organization_id, "created_at": p.created_at,
        "clinical_history": p.clinical_history, "history_checklist": p.history_checklist,
        "needs_history": p.needs_history,
    }


@router.get("/")
def get_patients(db: Session = Depends(get_db), scope: Scope = Depends(get_scope),
                 include_inactive: bool = False):
    q = apply_scope(db.query(Patient), Patient, scope)
    if not include_inactive:
        # soft-deleted patients are hidden by default
        q = q.filter(Patient.is_active.is_(True))
    return [_serialize(p) for p in q.order_by(Patient.created_at.desc()).limit(500).all()]


@router.post("/")
def create_patient(patient: PatientCreate, request: Request,
                   db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    barcode = patient.barcode or generate_barcode()
    while db.query(Patient).filter(Patient.barcode == barcode).first():
        barcode = generate_barcode()
    db_patient = Patient(
        patient_name=patient.patient_name, age=patient.age, gender=patient.gender,
        doctor_name=patient.doctor_name, sample_type=patient.sample_type, barcode=barcode,
        abha_number=_clean_abha(patient.abha_number),
        phone=patient.phone,
        # tenant always inherited from the registering user (no cross-tenant);
        # branch/franchise use the form value if given, else the user's own scope
        tenant_id=user.tenant_id,
        branch_id=patient.branch_id if patient.branch_id is not None else user.branch_id,
        registered_franchise_id=(patient.registered_franchise_id
                                 if patient.registered_franchise_id is not None
                                 else user.franchise_id),
        organization_id=patient.organization_id,
        clinical_history=patient.clinical_history,
        history_checklist=patient.history_checklist,
        is_active=True,
    )
    db.add(db_patient)
    db.commit()
    db.refresh(db_patient)
    # registration == sample collected
    record_status(db, db_patient, "collected", actor_id=user.id)
    write_audit(db, action="register", user=user, entity="patient", entity_id=db_patient.id,
                after={"barcode": barcode, "status": "collected"},
                ip=request.client.host if request.client else None)
    db.refresh(db_patient)
    return _serialize(db_patient)


@router.put("/{patient_id}")
def update_patient(patient_id: int, payload: PatientUpdate, request: Request,
                   db: Session = Depends(get_db), user: User = Depends(get_current_user),
                   scope: Scope = Depends(get_scope)):
    p = apply_scope(db.query(Patient), Patient, scope).filter(Patient.id == patient_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="Patient not found")

    before = _serialize(p)
    data = payload.model_dump(exclude_unset=True)
    if "abha_number" in data:
        data["abha_number"] = _clean_abha(data["abha_number"])
    for field, value in data.items():
        setattr(p, field, value)
    db.commit()
    db.refresh(p)
    # audit only the changed fields (avoid datetime/JSON serialization noise)
    write_audit(db, action="update", user=user, entity="patient", entity_id=p.id,
                before={k: before.get(k) for k in data}, after=data,
                ip=request.client.host if request.client else None)
    return _serialize(p)


@router.delete("/{patient_id}")
def soft_delete_patient(patient_id: int, request: Request,
                        db: Session = Depends(get_db), user: User = Depends(get_current_user),
                        scope: Scope = Depends(get_scope)):
    """Soft delete: flips is_active to False so the row is kept for audit/history."""
    p = apply_scope(db.query(Patient), Patient, scope).filter(Patient.id == patient_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="Patient not found")
    p.is_active = False
    db.commit()
    write_audit(db, action="delete", user=user, entity="patient", entity_id=p.id,
                after={"is_active": False, "barcode": p.barcode},
                ip=request.client.host if request.client else None)
    return {"id": p.id, "is_active": False, "message": "Patient archived"}


@router.post("/{patient_id}/restore")
def restore_patient(patient_id: int, request: Request,
                    db: Session = Depends(get_db), user: User = Depends(get_current_user),
                    scope: Scope = Depends(get_scope)):
    """Undo a soft delete."""
    p = apply_scope(db.query(Patient), Patient, scope).filter(Patient.id == patient_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="Patient not found")
    p.is_active = True
    db.commit()
    write_audit(db, action="restore", user=user, entity="patient", entity_id=p.id,
                after={"is_active": True}, ip=request.client.host if request.client else None)
    return _serialize(p)


@router.get("/{barcode}")
def get_patient_by_barcode(barcode: str, db: Session = Depends(get_db), scope: Scope = Depends(get_scope)):
    p = apply_scope(db.query(Patient), Patient, scope).filter(Patient.barcode == barcode).first()
    if not p:
        raise HTTPException(status_code=404, detail="Patient not found")
    return _serialize(p)
