"""
Sample lifecycle — drives status changes off the patient/sample (no separate
order needed). Setting a status records the matching sample_event(s) so TAT
keeps working, and stamps the patient's current `status`.

User-facing statuses (6):  collected → dispatched → received → tested → validated → reported
The `tested` step records only `test_started`. The matching `resulted` event is
recorded separately, at the real moment a result arrives (analyser / parse hook
in services.sample_event_hook), so the Testing stage measures actual time
instead of collapsing to zero.
"""
import datetime as dt

from models.clinical import SampleEvent, EventType

# user-facing status -> the sample_event type(s) it records
STATUS_EVENTS = {
    "collected":  [EventType.COLLECTED],
    "dispatched": [EventType.DISPATCHED],
    "received":   [EventType.RECEIVED],
    "tested":     [EventType.TEST_STARTED],   # resulted comes from the real result, not this click
    "validated":  [EventType.VALIDATED],
    "reported":   [EventType.REPORTED],
}

STATUS_ORDER = ["collected", "dispatched", "received", "tested", "validated", "reported"]


def record_status(db, patient, status, actor_id=None, commit=True):
    """Record the event(s) for `status` against this patient/sample (idempotent),
    and set patient.status. Returns the list of event types newly written."""
    if status not in STATUS_EVENTS:
        raise ValueError(f"unknown status '{status}'")
    now = dt.datetime.now(dt.timezone.utc)
    written = []
    for et in STATUS_EVENTS[status]:
        exists = (db.query(SampleEvent)
                    .filter(SampleEvent.patient_id == patient.id,
                            SampleEvent.event_type == et)
                    .first())
        if exists:
            continue
        db.add(SampleEvent(
            tenant_id=patient.tenant_id, branch_id=patient.branch_id,
            franchise_id=patient.registered_franchise_id,
            patient_id=patient.id, barcode=patient.barcode,
            event_type=et, event_at=now, actor_id=actor_id,
        ))
        written.append(et)
    patient.status = status
    if commit:
        db.commit()
    return written
