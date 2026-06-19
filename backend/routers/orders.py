"""Orders and the sample-event lifecycle.

Scope rules: a franchise user's orders are pinned to their own franchise; a
lab_admin can place orders for any branch/franchise in the tenant. Sample events
are append-only and inherit scope from their parent order.
"""
import datetime as dt
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional, List

from database import get_db
from models.org import Role, User
from models.clinical import Order, OrderItem, SampleEvent, OrderStatus, Priority, EventType, EVENT_SEQUENCE
from auth.deps import get_current_user, get_scope, apply_scope, Scope
from auth.audit import write_audit

router = APIRouter()

# event_type -> the order status it implies (for convenience auto-advance)
EVENT_TO_STATUS = {
    EventType.COLLECTED:    OrderStatus.COLLECTED,
    EventType.RECEIVED:     OrderStatus.RECEIVED,
    EventType.TEST_STARTED: OrderStatus.TESTING,
    EventType.RESULTED:     OrderStatus.RESULTED,
    EventType.VALIDATED:    OrderStatus.VALIDATED,
    EventType.REPORTED:     OrderStatus.REPORTED,
}


class OrderItemIn(BaseModel):
    test_id: Optional[int] = None
    test_name: str
    price: float = 0.0


class OrderIn(BaseModel):
    patient_id: Optional[int] = None
    barcode: Optional[str] = None
    order_no: Optional[str] = None
    referring_doctor: Optional[str] = None
    priority: str = Priority.ROUTINE
    franchise_id: Optional[int] = None   # lab_admin may set; franchise pinned to own
    branch_id: Optional[int] = None
    items: List[OrderItemIn] = []


@router.post("")
def create_order(p: OrderIn, request: Request,
                 db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    if user.role == Role.PATIENT:
        raise HTTPException(status_code=403, detail="patients cannot place orders here")

    franchise_id = user.franchise_id if user.role == Role.FRANCHISE else p.franchise_id
    branch_id = user.branch_id if user.branch_id is not None else p.branch_id

    order = Order(
        tenant_id=user.tenant_id, branch_id=branch_id, franchise_id=franchise_id,
        patient_id=p.patient_id, barcode=p.barcode, order_no=p.order_no,
        referring_doctor=p.referring_doctor, priority=p.priority,
        status=OrderStatus.CREATED,
        total_amount=sum(i.price for i in p.items),
    )
    db.add(order); db.commit(); db.refresh(order)
    for i in p.items:
        db.add(OrderItem(order_id=order.id, test_id=i.test_id, test_name=i.test_name, price=i.price))
    db.commit()
    write_audit(db, action="create", user=user, entity="order", entity_id=order.id,
                after={"patient_id": p.patient_id, "franchise_id": franchise_id, "items": len(p.items)},
                ip=request.client.host if request.client else None)
    return _order_dict(db, order)


@router.get("")
def list_orders(db: Session = Depends(get_db), scope: Scope = Depends(get_scope),
                status: Optional[str] = None, limit: int = 100):
    q = apply_scope(db.query(Order), Order, scope)
    if status:
        q = q.filter(Order.status == status)
    orders = q.order_by(Order.id.desc()).limit(min(limit, 500)).all()
    return [_order_dict(db, o) for o in orders]


@router.get("/{order_id}")
def get_order(order_id: int, db: Session = Depends(get_db), scope: Scope = Depends(get_scope)):
    o = apply_scope(db.query(Order), Order, scope).filter(Order.id == order_id).first()
    if not o:
        raise HTTPException(status_code=404, detail="Order not found")
    return _order_dict(db, o, with_events=True)


class EventIn(BaseModel):
    event_type: str
    event_at: Optional[dt.datetime] = None   # defaults to now
    note: Optional[str] = None


@router.post("/{order_id}/events")
def record_event(order_id: int, p: EventIn, request: Request,
                 db: Session = Depends(get_db), user: User = Depends(get_current_user),
                 scope: Scope = Depends(get_scope)):
    if user.role == Role.PATIENT:
        raise HTTPException(status_code=403, detail="patients cannot record sample events")
    if p.event_type not in EVENT_SEQUENCE:
        raise HTTPException(status_code=400, detail=f"event_type must be one of {EVENT_SEQUENCE}")

    o = apply_scope(db.query(Order), Order, scope).filter(Order.id == order_id).first()
    if not o:
        raise HTTPException(status_code=404, detail="Order not found")

    ev = SampleEvent(
        tenant_id=o.tenant_id, branch_id=o.branch_id, franchise_id=o.franchise_id,
        order_id=o.id, patient_id=o.patient_id, barcode=o.barcode,
        event_type=p.event_type, event_at=p.event_at or dt.datetime.now(dt.timezone.utc),
        actor_id=user.id, note=p.note,
    )
    db.add(ev)
    # convenience: advance the order status to match the latest event
    if p.event_type in EVENT_TO_STATUS:
        o.status = EVENT_TO_STATUS[p.event_type]
    db.commit(); db.refresh(ev)
    write_audit(db, action="event", user=user, entity="sample_event", entity_id=ev.id,
                after={"order_id": o.id, "event_type": p.event_type},
                ip=request.client.host if request.client else None)
    return {"id": ev.id, "order_id": o.id, "event_type": ev.event_type,
            "event_at": ev.event_at, "order_status": o.status}


# --------------------------------------------------------------------------- helpers
def _order_dict(db: Session, o: Order, with_events: bool = False) -> dict:
    d = {
        "id": o.id, "order_no": o.order_no, "barcode": o.barcode,
        "patient_id": o.patient_id, "franchise_id": o.franchise_id, "branch_id": o.branch_id,
        "priority": o.priority, "status": o.status, "total_amount": o.total_amount,
        "referring_doctor": o.referring_doctor, "created_at": o.created_at,
        "items": [{"id": it.id, "test_id": it.test_id, "test_name": it.test_name,
                   "price": it.price, "status": it.status, "result_value": it.result_value}
                  for it in db.query(OrderItem).filter(OrderItem.order_id == o.id).all()],
    }
    if with_events:
        evs = db.query(SampleEvent).filter(SampleEvent.order_id == o.id).order_by(SampleEvent.event_at).all()
        d["events"] = [{"event_type": e.event_type, "event_at": e.event_at, "note": e.note} for e in evs]
    return d
