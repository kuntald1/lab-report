"""
ABDM gateway client — the single place that talks to the NHA gateway.

STATUS: SCAFFOLD. The structure, auth flow, and call sequence are real, but the
exact endpoint paths/payloads and the Fidelius encryption are marked TODO because
they require your ABDM **sandbox credentials** and the NHA spec version you onboard
against. Nothing here runs against ABDM until you fill in:

    ABDM_BASE_URL        e.g. https://dev.abdm.gov.in   (sandbox) — from NHA
    ABDM_CLIENT_ID       OAuth2 client id               — from NHA onboarding
    ABDM_CLIENT_SECRET   OAuth2 client secret           — keep in env, never in git
    ABDM_HIP_ID          your HIP id / HFR facility id

Keep the secret in the server environment only. (M1 WASA audit checks for this.)
"""
import os
import time
import requests

ABDM_BASE_URL      = os.getenv("ABDM_BASE_URL", "https://dev.abdm.gov.in")
ABDM_CLIENT_ID     = os.getenv("ABDM_CLIENT_ID", "")
ABDM_CLIENT_SECRET = os.getenv("ABDM_CLIENT_SECRET", "")
ABDM_HIP_ID        = os.getenv("ABDM_HIP_ID", "")

_token_cache = {"value": None, "exp": 0}


class AbdmNotConfigured(RuntimeError):
    pass


def _require_config():
    if not (ABDM_CLIENT_ID and ABDM_CLIENT_SECRET):
        raise AbdmNotConfigured(
            "ABDM credentials not set. Add ABDM_CLIENT_ID / ABDM_CLIENT_SECRET to the "
            "server environment once you have sandbox onboarding from NHA.")


def get_session_token() -> str:
    """OAuth2 client-credentials session token, cached until ~1 min before expiry."""
    _require_config()
    if _token_cache["value"] and time.time() < _token_cache["exp"] - 60:
        return _token_cache["value"]
    # TODO: confirm the exact session endpoint for your onboarded spec version.
    resp = requests.post(
        f"{ABDM_BASE_URL}/gateway/v0.5/sessions",
        json={"clientId": ABDM_CLIENT_ID, "clientSecret": ABDM_CLIENT_SECRET},
        headers={"Content-Type": "application/json"}, timeout=20)
    resp.raise_for_status()
    data = resp.json()
    _token_cache["value"] = data["accessToken"]
    _token_cache["exp"] = time.time() + int(data.get("expiresIn", 1200))
    return _token_cache["value"]


def _auth_headers() -> dict:
    return {"Authorization": f"Bearer {get_session_token()}",
            "Content-Type": "application/json",
            "X-CM-ID": os.getenv("ABDM_CM_ID", "sbx")}


def link_care_context(abha_number: str, care_context: dict) -> dict:
    """
    STEP 3 — announce to ABDM that a new diagnostic record exists for this ABHA.
    Sends only a pointer (care-context reference + display), never the report data.

    care_context = {"referenceNumber": "<barcode>", "display": "Blood report — 24 Jun"}

    TODO: wire to the M2 care-context link/notify endpoint for your spec version.
    This is async on ABDM's side (it calls your callback to confirm), so the worker
    records the job as 'linking' and flips to 'linked' on the confirmation callback.
    """
    _require_config()
    payload = {
        "abhaNumber": abha_number,
        "hip": {"id": ABDM_HIP_ID},
        "careContexts": [care_context],
        "hiTypes": ["DiagnosticReport"],
    }
    # resp = requests.post(f"{ABDM_BASE_URL}/<link-endpoint>", json=payload,
    #                      headers=_auth_headers(), timeout=20)
    # resp.raise_for_status(); return resp.json()
    raise NotImplementedError(
        "link_care_context: fill the M2 endpoint path/payload from your NHA spec. "
        f"Prepared payload: {payload}")


def transfer_health_information(data_push_url: str, fhir_bundle: dict,
                                requester_public_key: str, nonce: str) -> None:
    """
    STEP 6 — on a consented request, encrypt the FHIR bundle and push it.

    ABDM uses Fidelius (ECDH / X25519) end-to-end encryption: generate a key pair,
    derive a shared secret from the requester's public key + your private key + nonces,
    AES-GCM encrypt the bundle, and POST the ciphertext to data_push_url.

    TODO: implement with a Fidelius binding (the NHA crypto lib) — DO NOT hand-roll
    the crypto. Getting any parameter wrong fails the transfer silently.
    """
    raise NotImplementedError(
        "transfer_health_information: integrate Fidelius (ECDH) encryption + push. "
        "Bundle is ready; only the encrypt+POST remains.")


def is_configured() -> bool:
    return bool(ABDM_CLIENT_ID and ABDM_CLIENT_SECRET)
