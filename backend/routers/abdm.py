"""
ABDM HTTP surface.

Two kinds of endpoints:
  - /abdm/admin/*   : internal — inspect and manually run the outbox (auth-protected).
  - /abdm/hip/*     : PUBLIC callbacks the ABDM gateway calls. These must be reachable
                      over HTTPS from the internet. SCAFFOLD — confirm/expand against
                      your onboarded NHA spec; each must verify the request's
                      authenticity (gateway JWT) before acting.
"""
from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session
from database import get_db
from auth.deps import get_current_user
from models.org import User
from models.abdm import AbdmOutbox, AbdmLink
from services.abdm import worker, gateway

router = APIRouter()


# ---------------- internal / admin ----------------
@router.get("/admin/outbox")
def list_outbox(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    rows = db.query(AbdmOutbox).order_by(AbdmOutbox.created_at.desc()).limit(100).all()
    return [{"id": r.id, "barcode": r.barcode, "abha": r.abha_number,
             "status": r.status, "attempts": r.attempts, "error": r.last_error,
             "care_context_ref": r.care_context_ref} for r in rows]


@router.post("/admin/run")
def run_outbox(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Manually drain the outbox (useful before you wire a scheduler)."""
    result = worker.process_outbox(db)
    return {"configured": gateway.is_configured(), **result}


@router.get("/admin/status")
def status(user: User = Depends(get_current_user)):
    return {"abdm_configured": gateway.is_configured(),
            "base_url": gateway.ABDM_BASE_URL,
            "hip_id_set": bool(gateway.ABDM_HIP_ID)}


# ---------------- public HIP callbacks (ABDM -> us) ----------------
@router.post("/hip/care-context/on-link")
async def on_care_context_linked(request: Request, db: Session = Depends(get_db)):
    """ABDM confirms a care context was linked → flip the job to 'linked'.
    TODO: verify gateway JWT; map payload fields to your spec."""
    body = await request.json()
    ref = (((body.get("careContext") or {}).get("referenceNumber"))
           or body.get("referenceNumber"))
    if ref:
        job = (db.query(AbdmOutbox)
                 .filter(AbdmOutbox.barcode == ref,
                         AbdmOutbox.status == "linking").first())
        if job:
            job.status = "linked"; job.care_context_ref = ref; db.commit()
    return {"acknowledged": True}


@router.post("/hip/health-information/request")
async def on_hi_request(request: Request, db: Session = Depends(get_db)):
    """
    STEP 6 callback — ABDM asks us to deliver records for a granted consent.
    TODO (needs Fidelius + spec): validate the consent artefact (scope, expiry,
    purpose); for each linked care context build the FHIR bundle (worker.build_bundle_for);
    encrypt with the requester's public key; push to the data-push URL via
    gateway.transfer_health_information(). Acknowledge here, transfer async.
    """
    body = await request.json()
    # consent = body.get("hiRequest", {}).get("consent", {})  # validate before serving
    return {"acknowledged": True, "note": "HI transfer not yet implemented (needs ABDM creds + Fidelius)"}
