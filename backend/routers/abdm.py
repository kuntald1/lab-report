"""
ABDM HTTP surface (v3, multi-tenant).

  /abdm/admin/*  : internal — inspect/run the outbox (auth-protected).
  /abdm/hip/*    : PUBLIC callbacks the ABDM gateway calls over HTTPS.

EVERY public callback is tenant-routed: ABDM stamps the target facility on the
X-HIP-ID header, we resolve it to a tenant, and we scope all DB work to that
tenant. A callback whose X-HIP-ID we don't recognise is rejected — never served
cross-tenant data.

v3 note: patient discovery is SYNCHRONOUS — we must return the match in the HTTP
response body, not via a later callback.

TODO before go-live: verify the ABDM gateway JWT on each public callback, and
confirm request/response field names against your subscribed swagger.
"""
from fastapi import APIRouter, Depends, Request, Header, HTTPException
from sqlalchemy.orm import Session
from datetime import datetime

from database import get_db
from auth.deps import get_current_user
from models.org import User
from models.models import Patient
from models.abdm import AbdmOutbox, AbdmLink, AbdmLinkToken, AbdmFacility
from services.abdm import worker, gateway
from services.abdm.facility import tenant_for_hip

router = APIRouter()


# ---------------- internal / admin ----------------
@router.get("/admin/outbox")
def list_outbox(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    rows = db.query(AbdmOutbox).order_by(AbdmOutbox.created_at.desc()).limit(100).all()
    return [{"id": r.id, "barcode": r.barcode, "abha": r.abha_number,
             "status": r.status, "attempts": r.attempts, "error": r.last_error,
             "tenant_id": r.tenant_id, "care_context_ref": r.care_context_ref}
            for r in rows]


@router.post("/admin/run")
def run_outbox(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    result = worker.process_outbox(db)
    return {"configured": gateway.is_configured(), **result}


@router.get("/admin/status")
def status(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    facilities = db.query(AbdmFacility).filter(AbdmFacility.active.is_(True)).count()
    return {"abdm_configured": gateway.is_configured(),
            "base_url": gateway.ABDM_BASE_URL,
            "cm_id": gateway.ABDM_CM_ID,
            "facilities_mapped": facilities}


# ---------------- tenant routing for public callbacks ----------------
def _facility_from_header(db: Session, x_hip_id: str | None) -> AbdmFacility:
    """Resolve the X-HIP-ID header to a known, active facility, or 404."""
    fac = tenant_for_hip(db, x_hip_id)
    if fac is None:
        raise HTTPException(status_code=404,
                            detail=f"unknown or inactive HIP id: {x_hip_id!r}")
    return fac


# ---------------- public HIP callbacks (ABDM -> us) ----------------
@router.post("/hip/patient/care-context/discover")
async def discover(request: Request,
                   x_hip_id: str | None = Header(default=None),
                   db: Session = Depends(get_db)):
    """SYNCHRONOUS discovery — return the matched patient + care contexts inline.

    ABDM sends ABHA + demographics; we match WITHIN this tenant only and answer
    in the HTTP response (no callback). CONFIRM field names against swagger.
    """
    fac = _facility_from_header(db, x_hip_id)
    body = await request.json()
    tx = body.get("transactionId") or body.get("requestId")
    p = body.get("patient", {}) or {}
    abha_number = p.get("abhaNumber") or body.get("abhaNumber")

    q = db.query(Patient).filter(Patient.tenant_id == fac.tenant_id,
                                 Patient.is_active.is_(True))
    patient = q.filter(Patient.abha_number == abha_number).first() if abha_number else None

    if patient is None:
        return {"transactionId": tx, "patient": None,
                "error": {"code": "ABDM-1010", "message": "No patient found"}}

    links = (db.query(AbdmLink)
               .filter(AbdmLink.patient_id == patient.id,
                       AbdmLink.tenant_id == fac.tenant_id).all())
    care_contexts = [{"referenceNumber": l.care_context_ref or l.barcode,
                      "display": f"Lab report — {l.barcode}"} for l in links]

    return {"transactionId": tx,
            "patient": {"referenceNumber": str(patient.id),
                        "display": patient.patient_name,
                        "careContexts": care_contexts,
                        "matchedBy": ["ABHA_NUMBER"]}}


@router.post("/hip/patient/profile/on-share")
async def on_profile_share(request: Request,
                           x_hip_id: str | None = Header(default=None),
                           db: Session = Depends(get_db)):
    """Scan-and-share — capture the linking token + ABHA for later HIP linking."""
    fac = _facility_from_header(db, x_hip_id)
    body = await request.json()
    profile = body.get("profile", body)
    abha_address = profile.get("abhaAddress") or body.get("abhaAddress")
    abha_number = profile.get("abhaNumber") or body.get("abhaNumber")
    link_token = body.get("linkToken") or profile.get("linkToken")

    if abha_address and link_token:
        existing = (db.query(AbdmLinkToken)
                      .filter(AbdmLinkToken.hip_id == fac.hip_id,
                              AbdmLinkToken.abha_address == abha_address).first())
        if existing:
            existing.link_token = link_token
            existing.abha_number = abha_number or existing.abha_number
        else:
            db.add(AbdmLinkToken(tenant_id=fac.tenant_id, hip_id=fac.hip_id,
                                 abha_address=abha_address, abha_number=abha_number,
                                 link_token=link_token))
        db.commit()
    return {"acknowledged": True}


@router.post("/hip/care-context/on-link")
async def on_care_context_linked(request: Request,
                                 x_hip_id: str | None = Header(default=None),
                                 db: Session = Depends(get_db)):
    """ABDM confirms a care context was linked -> flip the job to 'linked'."""
    fac = _facility_from_header(db, x_hip_id)
    body = await request.json()
    ref = (((body.get("careContext") or {}).get("referenceNumber"))
           or body.get("referenceNumber"))
    if ref:
        job = (db.query(AbdmOutbox)
                 .filter(AbdmOutbox.barcode == ref,
                         AbdmOutbox.tenant_id == fac.tenant_id,
                         AbdmOutbox.status == "linking").first())
        if job:
            job.status = "linked"; job.care_context_ref = ref; db.commit()
    return {"acknowledged": True}


@router.post("/hip/health-information/request")
async def on_hi_request(request: Request,
                        x_hip_id: str | None = Header(default=None),
                        db: Session = Depends(get_db)):
    """Consented data request — validate consent, build+encrypt bundle, push.

    TODO (needs Fidelius): validate the consent artefact (scope/expiry/purpose);
    for each linked care context build the FHIR bundle (worker.build_bundle_for);
    encrypt with the requester key material; push to the data-push URL via
    gateway.transfer_health_information(fac.hip_id, ...). Acknowledge here,
    transfer async.
    """
    fac = _facility_from_header(db, x_hip_id)
    return {"acknowledged": True,
            "note": f"HI transfer not yet implemented for hip {fac.hip_id} (needs Fidelius)"}
