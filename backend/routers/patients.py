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

def generate_barcode():
    return "MC" + ''.join(random.choices(string.digits, k=8))

def _serialize(p: Patient) -> dict:
    return {
        "id": p.id, "barcode": p.barcode, "patient_name": p.patient_name,
        "age": p.age, "gender": p.gender, "doctor_name": p.doctor_name,
        "sample_type": p.sample_type, "status": p.status,
        "tenant_id": p.tenant_id, "branch_id": p.branch_id,
        "registered_franchise_id": p.registered_franchise_id, "created_at": p.created_at,
    }

@router.get("/")
def get_patients(db: Session = Depends(get_db), scope: Scope = Depends(get_scope)):
    q = apply_scope(db.query(Patient), Patient, scope)
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
        # scope inherited from the registering user
        tenant_id=user.tenant_id, branch_id=user.branch_id,
        registered_franchise_id=user.franchise_id,
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

@router.get("/{barcode}")
def get_patient_by_barcode(barcode: str, db: Session = Depends(get_db), scope: Scope = Depends(get_scope)):
    p = apply_scope(db.query(Patient), Patient, scope).filter(Patient.barcode == barcode).first()
    if not p:
        raise HTTPException(status_code=404, detail="Patient not found")
    return _serialize(p)
