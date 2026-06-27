"""
ABDM worker — drains pending outbox jobs and links care contexts (v3, per-tenant).

Each job carries the patient's tenant_id. The worker resolves that tenant's HIP
facility, looks up a stored link token (from scan-and-share) if present, and
calls the v3 link. Safe to run repeatedly: a job is claimed by flipping to
'linking'; the on-link callback flips 'linking' -> 'linked'.

Until ABDM credentials AND a facility mapping exist, the bundle is still built
(works offline) and the job is left 'pending' with a clear note — so the whole
pipeline is visible end-to-end before go-live.
"""
from models.abdm import AbdmOutbox, AbdmLink, AbdmLinkToken
from models.models import Patient, LabResult
from services.abdm import gateway
from services.abdm.facility import hip_for_tenant
from services.abdm.fhir_builder import build_diagnostic_report_bundle


def _latest_parameters(db, barcode: str) -> list:
    rows = (db.query(LabResult)
              .filter(LabResult.barcode == barcode)
              .order_by(LabResult.created_at.desc()).all())
    params = []
    for r in rows:
        if isinstance(r.parsed_data, dict):
            params.extend(r.parsed_data.get("parameters", []) or [])
    return params


def build_bundle_for(db, patient: Patient, hip_name: str | None = None) -> dict:
    params = _latest_parameters(db, patient.barcode)
    return build_diagnostic_report_bundle(
        patient={"id": patient.id, "name": patient.patient_name,
                 "gender": patient.gender, "barcode": patient.barcode,
                 "abha_number": patient.abha_number},
        parameters=params,
        lab={"name": hip_name or "Vorpet Diagnostics", "hfr_id": None},
        practitioner={"name": patient.doctor_name} if patient.doctor_name else None,
        report_title=f"Lab Report — {patient.barcode}",
    )


def _abha_address(patient: Patient, db, hip_id: str) -> str | None:
    """Prefer a stored ABHA address (from scan-and-share); fall back to number."""
    if patient.abha_number:
        tok = (db.query(AbdmLinkToken)
                 .filter(AbdmLinkToken.hip_id == hip_id,
                         AbdmLinkToken.abha_number == patient.abha_number)
                 .first())
        if tok:
            return tok.abha_address
    return getattr(patient, "abha_address", None)


def process_outbox(db, limit: int = 20) -> dict:
    jobs = (db.query(AbdmOutbox)
              .filter(AbdmOutbox.status == "pending")
              .order_by(AbdmOutbox.created_at).limit(limit).all())
    done, skipped, failed = 0, 0, 0

    for job in jobs:
        patient = db.query(Patient).filter(Patient.id == job.patient_id).first()
        if patient is None or not patient.abha_number:
            job.status = "failed"; job.last_error = "no patient / no ABHA"; failed += 1
            db.commit(); continue

        # Resolve THIS tenant's facility. No mapping => tenant not ABDM-enabled.
        fac = hip_for_tenant(db, job.tenant_id)

        job.status = "linking"; job.attempts += 1; db.commit()
        try:
            bundle = build_bundle_for(db, patient, fac.hip_name if fac else None)  # offline ✓

            if not gateway.is_configured() or fac is None:
                why = ("ABDM not configured" if not gateway.is_configured()
                       else f"tenant {job.tenant_id} has no abdm_facilities mapping")
                job.status = "pending"
                job.last_error = f"bundle built OK — awaiting: {why}"
                skipped += 1; db.commit(); continue

            abha_address = _abha_address(patient, db, fac.hip_id)
            care_ctx = [{"referenceNumber": patient.barcode,
                         "display": f"Lab report — {patient.barcode}"}]
            res = gateway.link_care_contexts(
                hip_id=fac.hip_id,
                abha_address=abha_address or patient.abha_number,
                patient_reference=str(patient.id),
                patient_display=patient.patient_name,
                care_contexts=care_ctx,
            )
            ref = (res or {}).get("careContextReference", patient.barcode)

            db.add(AbdmLink(patient_id=patient.id, barcode=patient.barcode,
                            abha_number=patient.abha_number, care_context_ref=ref,
                            tenant_id=job.tenant_id))
            job.status = "linked"; job.care_context_ref = ref; job.last_error = None
            done += 1; db.commit()
        except Exception as e:
            job.status = "failed"; job.last_error = str(e)[:500]; failed += 1
            db.commit()

    return {"linked": done, "awaiting": skipped, "failed": failed}
