"""
ABDM gateway client — the single place that talks to the NHA gateway.

v3 + multi-tenant. The platform holds ONE client id / bridge; per-call we pass
the tenant's hip_id (resolved via services.abdm.facility) and stamp it on the
X-HIP-ID header so ABDM knows which facility the message is for.

Configured from server env (never commit secrets):
    ABDM_BASE_URL        https://dev.abdm.gov.in (sbx) / https://apis.abdm.gov.in (prod)
    ABDM_CLIENT_ID       bridge / client id
    ABDM_CLIENT_SECRET   client secret
    ABDM_CM_ID           'sbx' sandbox / 'abdm' production

NOTE: the v3 linking endpoint PATHS below vary slightly across ABDM's own docs
(/api/hiecm/v3/... vs /hiecm/api/v3/...). They are centralised here as constants
so you confirm them ONCE against your subscribed Swagger after access is granted,
and never hunt through call sites.
"""
import os
import time
import uuid
from datetime import datetime, timezone

import requests

ABDM_BASE_URL      = os.getenv("ABDM_BASE_URL", "https://dev.abdm.gov.in")
ABDM_CLIENT_ID     = os.getenv("ABDM_CLIENT_ID", "")
ABDM_CLIENT_SECRET = os.getenv("ABDM_CLIENT_SECRET", "")
ABDM_CM_ID         = os.getenv("ABDM_CM_ID", "sbx")   # 'sbx' / 'abdm'

# ---- v3 endpoints (CONFIRM against your subscribed swagger after access) ----
EP_SESSIONS            = "/api/hiecm/gateway/v3/sessions"          # confirmed working
EP_GENERATE_LINK_TOKEN = "/api/hiecm/v3/token/generate-token"      # CONFIRM
EP_LINK_CARECONTEXT    = "/api/hiecm/hip/v3/link/carecontext"      # CONFIRM
EP_LINK_SMS_NOTIFY     = "/api/hiecm/hip/v3/link/patient/links/sms/notify2"  # CONFIRM (optional)

_token_cache = {"value": None, "exp": 0}


class AbdmNotConfigured(RuntimeError):
    pass


def _require_config():
    if not (ABDM_CLIENT_ID and ABDM_CLIENT_SECRET):
        raise AbdmNotConfigured(
            "ABDM credentials not set (ABDM_CLIENT_ID / ABDM_CLIENT_SECRET).")


def _gw_headers(token: str | None = None, hip_id: str | None = None) -> dict:
    """Standard ABDM v3 headers.

    TIMESTAMP must be ISO-8601 UTC with milliseconds + 'Z' (a plain isoformat or
    a +05:30 offset is rejected). Keep the host NTP-synced. X-HIP-ID identifies
    the tenant's facility on HIP-initiated calls.
    """
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"
    h = {"Content-Type": "application/json",
         "REQUEST-ID": str(uuid.uuid4()),
         "TIMESTAMP": ts,
         "X-CM-ID": ABDM_CM_ID}
    if token:
        h["Authorization"] = f"Bearer {token}"
    if hip_id:
        h["X-HIP-ID"] = hip_id
    return h


def get_session_token() -> str:
    """OAuth2 client-credentials token, cached until ~1 min before expiry."""
    _require_config()
    if _token_cache["value"] and time.time() < _token_cache["exp"] - 60:
        return _token_cache["value"]
    resp = requests.post(
        f"{ABDM_BASE_URL}{EP_SESSIONS}",
        json={"clientId": ABDM_CLIENT_ID,
              "clientSecret": ABDM_CLIENT_SECRET,
              "grantType": "client_credentials"},
        headers=_gw_headers(), timeout=20)
    resp.raise_for_status()
    data = resp.json()
    _token_cache["value"] = data["accessToken"]
    _token_cache["exp"] = time.time() + int(data.get("expiresIn", 1200))
    return _token_cache["value"]


# ---------------------------------------------------------------------------
# M2 — HIP-initiated care-context linking (v3)
# ---------------------------------------------------------------------------
def generate_link_token(hip_id: str, abha_address: str,
                        patient_reference: str) -> str | None:
    """STEP A — get a link token for a patient under this facility.

    Use when you don't already hold a scan-and-share token for the patient.
    Returns the linkToken (often delivered via callback in async variants —
    confirm sync/async behaviour for your spec). CONFIRM endpoint + payload.
    """
    _require_config()
    payload = {"requestId": str(uuid.uuid4()),
               "abhaAddress": abha_address,
               "patientReference": patient_reference,
               "hipId": hip_id}
    resp = requests.post(f"{ABDM_BASE_URL}{EP_GENERATE_LINK_TOKEN}",
                         json=payload,
                         headers=_gw_headers(get_session_token(), hip_id),
                         timeout=20)
    resp.raise_for_status()
    return (resp.json() or {}).get("linkToken")


def link_care_contexts(hip_id: str, abha_address: str, patient_reference: str,
                       patient_display: str, care_contexts: list[dict],
                       hi_type: str = "DiagnosticReport") -> dict:
    """STEP B — link one or more care contexts for a patient to their ABHA.

    care_contexts: [{"referenceNumber": "<barcode>", "display": "Lab report — ..."}]
    In v3 the hiType lives inside each care context. CONFIRM endpoint + payload
    shape against your swagger; this matches the documented v3 structure.
    """
    _require_config()
    payload = {
        "requestId": str(uuid.uuid4()),
        "requesterId": hip_id,
        "abhaAddress": abha_address,
        "patient": [{
            "referenceNumber": patient_reference,
            "display": patient_display,
            "careContexts": [
                {**cc, "hiType": hi_type} for cc in care_contexts
            ],
            "count": len(care_contexts),
        }],
    }
    resp = requests.post(f"{ABDM_BASE_URL}{EP_LINK_CARECONTEXT}",
                         json=payload,
                         headers=_gw_headers(get_session_token(), hip_id),
                         timeout=20)
    resp.raise_for_status()
    return resp.json() if resp.content else {"acknowledged": True}


# ---------------------------------------------------------------------------
# M2/M3 — consented health-information transfer (encrypted)
# ---------------------------------------------------------------------------
def transfer_health_information(hip_id: str, data_push_url: str, fhir_bundle: dict,
                                requester_key_material: dict) -> None:
    """On a granted consent, encrypt the FHIR bundle and push it.

    v3 uses ECDH (Curve25519) end-to-end encryption (Fidelius). Generate a key
    pair, derive the shared secret from the requester's public key + nonce,
    AES-GCM encrypt, POST ciphertext to data_push_url.

    DO NOT hand-roll the crypto — integrate a Fidelius binding. The bundle is
    already built (worker.build_bundle_for); only encrypt + POST remains.
    """
    raise NotImplementedError(
        "transfer_health_information: integrate Fidelius (ECDH/Curve25519) "
        "encryption + push. Bundle ready; encrypt+POST pending.")


def is_configured() -> bool:
    return bool(ABDM_CLIENT_ID and ABDM_CLIENT_SECRET)
