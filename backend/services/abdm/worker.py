"""
ABDM worker — processes pending outbox jobs (step 3, the linking).

Run it on a schedule (cron / APScheduler / a loop). It is safe to run repeatedly:
jobs are claimed by flipping status to 'linking', and the gateway link is async-
confirmed via the callback router, which flips 'linking' -> 'linked'.

Until ABDM credentials are configured, process_outbox() builds the FHIR bundle
(fully working) and then stops at the gateway call with a clear 'not configured'
note recorded on the job — so you can see the pipeline working end-to-end offline.
"""
from models.abdm import AbdmOutbox, AbdmLink
from models.models import Patient, LabResult
from services.abdm import gateway
from services.abdm.fhir_builder import build_diagnostic_report_bundle

# your lab identity for the FHIR Organization (move to env/config later)
LAB_ORG = {"name": "Vorpet Diagnostics", "hfr_id": gateway.ABDM_HIP_ID or None}


def _latest_parameters(db, barcode: str) -> list:
    """Flatten parsed_data['parameters'] from this barcode's results."""
    rows = (db.query(LabResult)
              .filter(LabResult.barcode == barcode)
              .order_by(LabResult.created_at.desc()).all())
    params = []
    for r in rows:
        if isinstance(r.parsed_data, dict):
            params.extend(r.parsed_data.get("parameters", []) or [])
    return params


def build_bundle_for(db, patient: Patient) -> dict:
    """Pure-ish: assemble the FHIR document bundle for a patient's results."""
    params = _latest_parameters(db, patient.barcode)
    return build_diagnostic_report_bundle(
        patient={"id": patient.id, "name": patient.patient_name,
                 "gender": patient.gender, "barcode": patient.barcode,
                 "abha_number": patient.abha_number},
        parameters=params,
        lab=LAB_ORG,
        practitioner={"name": patient.doctor_name} if patient.doctor_name else None,
        report_title=f"Lab Report — {patient.barcode}",
    )


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

        job.status = "linking"; job.attempts += 1; db.commit()
        try:
            bundle = build_bundle_for(db, patient)  # works offline ✓
            if not gateway.is_configured():
                job.status = "pending"      # leave it queued for when creds arrive
                job.last_error = "ABDM not configured — bundle built OK, awaiting credentials"
                skipped += 1; db.commit(); continue

            care_ctx = {"referenceNumber": patient.barcode,
                        "display": f"Lab report — {patient.barcode}"}
            res = gateway.link_care_context(patient.abha_number, care_ctx)
            ref = (res or {}).get("careContextReference", patient.barcode)

            db.add(AbdmLink(patient_id=patient.id, barcode=patient.barcode,
                            abha_number=patient.abha_number, care_context_ref=ref,
                            tenant_id=job.tenant_id))
            job.status = "linked"; job.care_context_ref = ref; job.last_error = None
            done += 1; db.commit()
        except Exception as e:
            job.status = "failed"; job.last_error = str(e)[:500]; failed += 1
            db.commit()

    return {"linked": done, "awaiting_credentials": skipped, "failed": failed}
