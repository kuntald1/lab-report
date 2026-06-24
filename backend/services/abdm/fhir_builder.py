"""
ABDM step 6 core — build a FHIR R4 'document' bundle for a diagnostic report.

This is the piece that turns a MediCloud lab result (patient + parsed_data) into
the FHIR structure ABDM expects to deliver into a patient's ABHA account. It is
pure (no DB, no network), so it is fully unit-testable offline — you do NOT need
ABDM sandbox credentials to run or verify it.

The bundle mirrors the NRCeS "DiagnosticReportRecord" shape:
    Bundle(document)
      └ Composition          (the wrapper / table of contents)
      └ Patient
      └ Organization         (your lab — HIP)
      └ Practitioner         (optional — the validating pathologist)
      └ DiagnosticReport     (references the Observations + optional PDF)
      └ Observation[]        (one per test parameter)

NOTE: before production, the output must be validated against the India-specific
NRCeS FHIR profiles (proper LOINC/SNOMED coding, mandatory extensions). This
builder gives a correct, complete R4 structure; coding refinement is a follow-up.
"""
from __future__ import annotations
import uuid
from datetime import datetime, timezone
from typing import Optional


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000+05:30")


def _urn() -> str:
    return "urn:uuid:" + str(uuid.uuid4())


# MediCloud flag -> FHIR interpretation coding
_INTERP = {
    "N": ("N", "Normal"),
    "H": ("H", "High"),
    "L": ("L", "Low"),
}


def _observation(param: dict, patient_ref: str, issued: str) -> dict:
    """One test parameter -> a FHIR Observation."""
    name = param.get("name") or param.get("param") or "Result"
    value = param.get("value")
    unit = param.get("unit") or ""
    flag = (param.get("flag") or "N").upper()

    obs = {
        "resourceType": "Observation",
        "id": str(uuid.uuid4()),
        "status": "final",
        "category": [{
            "coding": [{
                "system": "http://terminology.hl7.org/CodeSystem/observation-category",
                "code": "laboratory", "display": "Laboratory",
            }]
        }],
        "code": {"text": name},               # TODO: add LOINC coding for production
        "subject": {"reference": patient_ref},
        "issued": issued,
    }
    if isinstance(value, (int, float)):
        obs["valueQuantity"] = {"value": value, "unit": unit,
                                "system": "http://unitsofmeasure.org", "code": unit}
    else:
        obs["valueString"] = str(value)

    ref_min, ref_max = param.get("ref_min"), param.get("ref_max")
    rng = {}
    try:
        if ref_min not in (None, ""):
            rng["low"] = {"value": float(ref_min), "unit": unit}
        if ref_max not in (None, ""):
            rng["high"] = {"value": float(ref_max), "unit": unit}
    except (TypeError, ValueError):
        pass
    if rng:
        obs["referenceRange"] = [rng]

    if flag in _INTERP:
        code, display = _INTERP[flag]
        obs["interpretation"] = [{
            "coding": [{
                "system": "http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation",
                "code": code, "display": display,
            }]
        }]
    return obs


def build_diagnostic_report_bundle(
    patient: dict,
    parameters: list,
    lab: dict,
    *,
    practitioner: Optional[dict] = None,
    pdf_base64: Optional[str] = None,
    report_title: str = "Diagnostic Report",
) -> dict:
    """
    patient    : {"name","gender","abha_number"(opt),"id","barcode"}
    parameters : list of parsed_data['parameters'] dicts (the test rows)
    lab        : {"name","hfr_id"(opt)}
    practitioner (opt): {"name","hpr_id"(opt)}  -- the validating pathologist
    pdf_base64 (opt)  : base64 of your MediCloud PDF, embedded as presentedForm
    Returns a FHIR R4 document Bundle (dict).
    """
    issued = _now_iso()

    # --- referenced resources, each with a urn:uuid fullUrl ---
    patient_url = _urn()
    org_url = _urn()
    prac_url = _urn() if practitioner else None

    patient_res = {
        "resourceType": "Patient",
        "id": str(patient.get("id") or uuid.uuid4()),
        "name": [{"text": patient.get("name", "Unknown")}],
        "gender": (patient.get("gender") or "unknown").lower(),
    }
    if patient.get("abha_number"):
        patient_res["identifier"] = [{
            "system": "https://healthid.ndhm.gov.in",
            "value": patient["abha_number"],
        }]

    org_res = {
        "resourceType": "Organization",
        "id": str(uuid.uuid4()),
        "name": lab.get("name", "Diagnostic Lab"),
    }
    if lab.get("hfr_id"):
        org_res["identifier"] = [{
            "system": "https://facility.ndhm.gov.in", "value": lab["hfr_id"],
        }]

    prac_res = None
    if practitioner:
        prac_res = {
            "resourceType": "Practitioner",
            "id": str(uuid.uuid4()),
            "name": [{"text": practitioner.get("name", "Pathologist")}],
        }
        if practitioner.get("hpr_id"):
            prac_res["identifier"] = [{
                "system": "https://hpr.ndhm.gov.in", "value": practitioner["hpr_id"],
            }]

    # --- observations ---
    obs_entries, obs_refs = [], []
    for p in parameters:
        o = _observation(p, patient_url, issued)
        url = _urn()
        obs_entries.append({"fullUrl": url, "resource": o})
        obs_refs.append({"reference": url, "display": o["code"]["text"]})

    # --- DiagnosticReport ---
    dr = {
        "resourceType": "DiagnosticReport",
        "id": str(uuid.uuid4()),
        "status": "final",
        "category": [{"coding": [{
            "system": "http://terminology.hl7.org/CodeSystem/v2-0074",
            "code": "LAB", "display": "Laboratory",
        }]}],
        "code": {"text": report_title},
        "subject": {"reference": patient_url},
        "issued": issued,
        "performer": [{"reference": org_url}],
        "result": obs_refs,
    }
    if prac_url:
        dr["resultsInterpreter"] = [{"reference": prac_url}]
    if pdf_base64:
        dr["presentedForm"] = [{
            "contentType": "application/pdf",
            "data": pdf_base64,
            "title": report_title,
        }]
    dr_url = _urn()

    # --- Composition (wrapper) ---
    comp = {
        "resourceType": "Composition",
        "id": str(uuid.uuid4()),
        "status": "final",
        "type": {"coding": [{
            "system": "http://snomed.info/sct",
            "code": "721981007", "display": "Diagnostic studies report",
        }], "text": report_title},
        "subject": {"reference": patient_url},
        "date": issued,
        "author": [{"reference": org_url}],
        "title": report_title,
        "section": [{
            "title": report_title,
            "entry": [{"reference": dr_url}],
        }],
    }
    comp_url = _urn()

    # --- assemble the document bundle (Composition MUST be first) ---
    entries = [
        {"fullUrl": comp_url, "resource": comp},
        {"fullUrl": patient_url, "resource": patient_res},
        {"fullUrl": org_url, "resource": org_res},
    ]
    if prac_res:
        entries.append({"fullUrl": prac_url, "resource": prac_res})
    entries.append({"fullUrl": dr_url, "resource": dr})
    entries.extend(obs_entries)

    return {
        "resourceType": "Bundle",
        "id": str(uuid.uuid4()),
        "type": "document",
        "timestamp": issued,
        "identifier": {"system": "urn:ietf:rfc:3986", "value": _urn()},
        "entry": entries,
    }
