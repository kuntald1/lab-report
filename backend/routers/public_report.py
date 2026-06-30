"""Public (no-login) report access reached by scanning the QR on a PDF.

Flow:
  1) QR -> https://medicloud.mooo.com/?rid=<id>&k=<token>
  2) The public page asks for a password = patient's phone OR barcode.
  3) POST /api/public/report/<id>/view  {token, password}
       -> token + password verified -> returns the report values.
     GET  /api/public/report/<id>/pdf?token=..&password=..
       -> same checks -> streams the PDF.
No JWT here on purpose; access is gated by the signed token + the password.
"""
import io
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from pydantic import BaseModel

from database import get_db
from models.models import LabResult, Patient
from services.report_link import check_token, check_patient_token, report_token
from routers.pdf import generate_pdf

router = APIRouter()


def _digits(s: str) -> str:
    return "".join(c for c in (s or "") if c.isdigit())


def _norm(s: str) -> str:
    return "".join(c for c in (s or "") if c.isalnum()).lower()


def _verify(db: Session, result_id: int, token: str, password: str):
    if not check_token(result_id, token):
        raise HTTPException(403, "invalid or expired link")
    result = db.query(LabResult).filter(LabResult.id == result_id).first()
    if not result:
        raise HTTPException(404, "report not found")
    patient = db.query(Patient).filter(Patient.id == result.patient_id).first()

    # accepted passwords: patient phone (full or last-10 digits), patient barcode,
    # or the result's barcode — compared loosely (case/space/symbol-insensitive).
    accepted = set()
    if patient:
        accepted.add(_norm(patient.phone))
        ph = _digits(patient.phone)
        if len(ph) >= 10:
            accepted.add(ph[-10:])
        accepted.add(_norm(patient.barcode))
    accepted.add(_norm(result.barcode))
    accepted.discard("")

    given = {_norm(password)}
    pd = _digits(password)
    if len(pd) >= 10:
        given.add(pd[-10:])

    if accepted.isdisjoint(given):
        raise HTTPException(401, "incorrect phone number or barcode")
    return result, patient


class VerifyIn(BaseModel):
    token: str
    password: str


@router.post("/report/{result_id}/view")
def public_view(result_id: int, payload: VerifyIn, db: Session = Depends(get_db)):
    result, patient = _verify(db, result_id, payload.token, payload.password)
    pd = result.parsed_data or {}
    return {
        "id": result.id,
        "barcode": result.barcode,
        "patient_name": patient.patient_name if patient else "Unknown",
        "age": patient.age if patient else None,
        "gender": patient.gender if patient else None,
        "doctor": (patient.doctor_name if patient else None),
        "status": result.status,
        "created_at": result.created_at,
        "test_name": result.test_name,
        "protocol": pd.get("protocol"),
        "parameters": pd.get("parameters", []),
        "gh900_info": pd.get("gh900_info"),
    }


@router.get("/report/{result_id}/pdf")
def public_pdf(result_id: int, token: str = Query(...), password: str = Query(...),
               db: Session = Depends(get_db)):
    result, _ = _verify(db, result_id, token, password)
    try:
        pdf_bytes = generate_pdf(result)
    except Exception as e:
        raise HTTPException(500, f"PDF generation failed: {e}")
    return StreamingResponse(
        io.BytesIO(pdf_bytes), media_type="application/pdf",
        headers={"Content-Disposition": f"inline; filename=MediCloud_Report_{result_id}.pdf"},
    )


# ----------------------------------------------------------------------------
# Patient-level access (the QR on a Direct/Walk-in money receipt). A receipt
# can cover several tests, so this lists every reported LabResult for that
# patient at once. Each entry carries its own report_token so the existing
# single-result PDF endpoint above can be reused unchanged for the download.

def _verify_patient(db: Session, patient_id: int, token: str, password: str) -> Patient:
    if not check_patient_token(patient_id, token):
        raise HTTPException(403, "invalid or expired link")
    patient = db.query(Patient).filter(Patient.id == patient_id).first()
    if not patient:
        raise HTTPException(404, "patient not found")

    accepted = set()
    accepted.add(_norm(patient.phone))
    ph = _digits(patient.phone)
    if len(ph) >= 10:
        accepted.add(ph[-10:])
    accepted.add(_norm(patient.barcode))
    accepted.discard("")

    given = {_norm(password)}
    pd = _digits(password)
    if len(pd) >= 10:
        given.add(pd[-10:])

    if accepted.isdisjoint(given):
        raise HTTPException(401, "incorrect phone number or barcode")
    return patient


@router.post("/patient/{patient_id}/view")
def public_patient_view(patient_id: int, payload: VerifyIn, db: Session = Depends(get_db)):
    patient = _verify_patient(db, patient_id, payload.token, payload.password)

    base = {
        "patient_id": patient.id, "patient_name": patient.patient_name,
        "barcode": patient.barcode, "age": patient.age, "gender": patient.gender,
        "doctor": patient.doctor_name,
    }
    if patient.status != "reported":
        # link + password are correct, the report just isn't finalised yet —
        # this is a normal state, not an error.
        return {**base, "ready": False}

    results = db.query(LabResult).filter(LabResult.patient_id == patient.id).order_by(LabResult.created_at.asc()).all()
    return {
        **base, "ready": True,
        "tests": [{"result_id": r.id, "test_name": r.test_name,
                   "created_at": r.created_at, "result_token": report_token(r.id)}
                  for r in results],
    }
