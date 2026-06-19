"""
Analyser-ingestion → TAT hook.

When a real result is saved (by the TCP manager or the parse endpoint), this
records a `resulted` sample_event so TAT fills itself from real lab activity —
no manual posting. It is deliberately defensive: any failure here is swallowed
and never breaks result ingestion.

Matching logic: the analyser only knows the tube barcode, so we look up an
existing order by that barcode to attach the event to the right franchise; if no
order exists, the event is still recorded (it groups under "Direct / Walk-in").
"""
import datetime as dt

from models.clinical import Order, SampleEvent, EventType, OrderStatus


def emit_resulted_event(db, *, barcode, patient=None, device_id=None):
    try:
        if not barcode or barcode == "UNKNOWN":
            return

        order = (db.query(Order)
                   .filter(Order.barcode == barcode)
                   .order_by(Order.id.desc())
                   .first())

        # idempotency: don't emit a second 'resulted' for the same sample
        q = db.query(SampleEvent).filter(SampleEvent.event_type == EventType.RESULTED)
        already = (q.filter(SampleEvent.order_id == order.id).first() if order
                   else q.filter(SampleEvent.barcode == barcode,
                                 SampleEvent.order_id.is_(None)).first())
        if already:
            return

        tenant_id    = getattr(patient, "tenant_id", None) or (order.tenant_id if order else None)
        branch_id    = getattr(patient, "branch_id", None) or (order.branch_id if order else None)
        franchise_id = (order.franchise_id if order else None) or getattr(patient, "registered_franchise_id", None)

        db.add(SampleEvent(
            tenant_id=tenant_id, branch_id=branch_id, franchise_id=franchise_id,
            order_id=order.id if order else None,
            patient_id=getattr(patient, "id", None),
            barcode=barcode, event_type=EventType.RESULTED,
            event_at=dt.datetime.now(dt.timezone.utc),
            note="auto: analyser result received",
        ))
        # nudge the order forward if it's still pre-result
        if order and order.status in (OrderStatus.CREATED, OrderStatus.COLLECTED,
                                      OrderStatus.RECEIVED, OrderStatus.TESTING):
            order.status = OrderStatus.RESULTED
        db.commit()
    except Exception:
        db.rollback()   # ingestion must never fail because of TAT bookkeeping
