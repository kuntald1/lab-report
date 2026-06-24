"""
Step 2 -> 3 trigger. When a report is validated, drop a job in the outbox.

Kept tiny and side-effect-safe: a failure here must NEVER block the validation
itself, so the caller wraps it in try/except. The heavy ABDM work happens later
in the worker, not inline.
"""
from models.abdm import AbdmOutbox


def enqueue_abdm_link(db, patient, trigger: str = "validated") -> AbdmOutbox | None:
    """Queue a 'link this validated report to the patient's ABHA' job.

    Skips silently if the patient has no ABHA number (nothing to link to) or if a
    pending/linked job already exists for this barcode (idempotent)."""
    if patient is None or not getattr(patient, "abha_number", None):
        return None

    existing = (db.query(AbdmOutbox)
                  .filter(AbdmOutbox.barcode == patient.barcode,
                          AbdmOutbox.status.in_(("pending", "linking", "linked")))
                  .first())
    if existing:
        return existing

    job = AbdmOutbox(
        patient_id=patient.id, barcode=patient.barcode,
        abha_number=patient.abha_number, trigger=trigger,
        status="pending", tenant_id=getattr(patient, "tenant_id", None),
    )
    db.add(job)
    db.commit()
    db.refresh(job)
    return job
