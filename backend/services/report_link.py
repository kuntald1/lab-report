"""Signed token + public URL for the QR code printed on a lab report.

The QR encodes a public URL like:
    https://medicloud.mooo.com/?rid=<result_id>&k=<token>
where <token> = first 16 hex chars of HMAC-SHA256(JWT_SECRET, "report:<id>").
That makes result ids non-enumerable; the public page still requires the
patient's phone or barcode as a password before showing anything.
"""
import os
import hmac
import hashlib

_SECRET  = os.getenv("JWT_SECRET", "change-me-in-production-please")
APP_URL  = os.getenv("APP_PUBLIC_URL", "https://medicloud.mooo.com").rstrip("/")


def report_token(result_id) -> str:
    msg = f"report:{result_id}".encode()
    return hmac.new(_SECRET.encode(), msg, hashlib.sha256).hexdigest()[:16]


def report_view_url(result_id) -> str:
    return f"{APP_URL}/?rid={result_id}&k={report_token(result_id)}"


def check_token(result_id, token: str) -> bool:
    return hmac.compare_digest(token or "", report_token(result_id))


# ---- patient-level (covers every reported test for that patient at once) ----
# Kept in a separate HMAC namespace ("patient:" vs "report:") so a patient-level
# token can never be reused against the single-result endpoints or vice versa.

def patient_token(patient_id) -> str:
    msg = f"patient:{patient_id}".encode()
    return hmac.new(_SECRET.encode(), msg, hashlib.sha256).hexdigest()[:16]


def patient_view_url(patient_id) -> str:
    return f"{APP_URL}/?pid={patient_id}&k={patient_token(patient_id)}"


def check_patient_token(patient_id, token: str) -> bool:
    return hmac.compare_digest(token or "", patient_token(patient_id))
