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
from models.models import Patient
from models.clinical import (Order, OrderItem, SampleEvent, ResultAmendment,
                             OrderStatus, Priority, EventType, EVENT_SEQUENCE)
from auth.deps import get_current_user, get_scope, apply_scope, Scope
from auth.audit import write_audit
from services.flagging import compute_flag

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


# --------------------------------------------------------------------------- result flow
def _append_event(db, order, event_type, actor_id):
    """Append a lifecycle event (idempotent per type) and advance order status."""
    exists = (db.query(SampleEvent)
                .filter(SampleEvent.order_id == order.id, SampleEvent.event_type == event_type)
                .first())
    if not exists:
        db.add(SampleEvent(
            tenant_id=order.tenant_id, branch_id=order.branch_id, franchise_id=order.franchise_id,
            order_id=order.id, patient_id=order.patient_id, barcode=order.barcode,
            event_type=event_type, event_at=dt.datetime.now(dt.timezone.utc), actor_id=actor_id,
        ))


def _load_order(db, scope, order_id):
    o = apply_scope(db.query(Order), Order, scope).filter(Order.id == order_id).first()
    if not o:
        raise HTTPException(status_code=404, detail="Order not found")
    return o


class ResultIn(BaseModel):
    result_value: str
    result_unit: Optional[str] = None


@router.put("/{order_id}/items/{item_id}/result")
def enter_result(order_id: int, item_id: int, p: ResultIn, request: Request,
                 db: Session = Depends(get_db), user: User = Depends(get_current_user),
                 scope: Scope = Depends(get_scope)):
    if user.role not in (Role.TECHNICIAN, Role.LAB_ADMIN, Role.PATHOLOGIST, Role.SUPER_ADMIN):
        raise HTTPException(status_code=403, detail="not permitted to enter results")
    o = _load_order(db, scope, order_id)
    item = db.query(OrderItem).filter(OrderItem.id == item_id, OrderItem.order_id == o.id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Order item not found")

    patient = db.query(Patient).filter(Patient.id == o.patient_id).first() if o.patient_id else None
    flag = compute_flag(db, item.test_id, patient, p.result_value)
    item.result_value, item.result_unit, item.flag, item.status = p.result_value, p.result_unit, flag, "resulted"
    _append_event(db, o, EventType.RESULTED, user.id)
    if o.status in (OrderStatus.CREATED, OrderStatus.COLLECTED, OrderStatus.RECEIVED, OrderStatus.TESTING):
        o.status = OrderStatus.RESULTED
    db.commit()

    critical = flag == "critical"
    if critical:
        write_audit(db, action="critical_value", user=user, entity="order_item", entity_id=item.id,
                    after={"test": item.test_name, "value": p.result_value}, ip=_ip2(request),
                    detail="CRITICAL value entered")
    return {"id": item.id, "result_value": item.result_value, "flag": flag, "critical": critical,
            "order_status": o.status}


@router.post("/{order_id}/validate")
def validate_order(order_id: int, request: Request, db: Session = Depends(get_db),
                   user: User = Depends(get_current_user), scope: Scope = Depends(get_scope)):
    if user.role not in (Role.PATHOLOGIST, Role.LAB_ADMIN, Role.SUPER_ADMIN):
        raise HTTPException(status_code=403, detail="only a pathologist can validate")
    o = _load_order(db, scope, order_id)
    items = db.query(OrderItem).filter(OrderItem.order_id == o.id).all()
    resulted = [it for it in items if it.status in ("resulted", "validated")]
    if not resulted:
        raise HTTPException(status_code=400, detail="no results to validate")
    now = dt.datetime.now(dt.timezone.utc)
    for it in resulted:
        it.status, it.validated_by, it.validated_at = "validated", user.id, now
    _append_event(db, o, EventType.VALIDATED, user.id)
    o.status = OrderStatus.VALIDATED
    db.commit()
    write_audit(db, action="validate", user=user, entity="order", entity_id=o.id,
                after={"items": len(resulted)}, ip=_ip2(request))
    return {"order_id": o.id, "status": o.status, "validated_items": len(resulted)}


@router.post("/{order_id}/release")
def release_order(order_id: int, request: Request, db: Session = Depends(get_db),
                  user: User = Depends(get_current_user), scope: Scope = Depends(get_scope)):
    if user.role not in (Role.PATHOLOGIST, Role.LAB_ADMIN, Role.RECEPTIONIST, Role.SUPER_ADMIN):
        raise HTTPException(status_code=403, detail="not permitted to release")
    o = _load_order(db, scope, order_id)
    if o.status not in (OrderStatus.VALIDATED, OrderStatus.REPORTED):
        raise HTTPException(status_code=400, detail="order must be validated before release")
    _append_event(db, o, EventType.REPORTED, user.id)
    o.status = OrderStatus.REPORTED
    db.commit()
    write_audit(db, action="release", user=user, entity="order", entity_id=o.id, ip=_ip2(request))
    return {"order_id": o.id, "status": o.status}


class AmendIn(BaseModel):
    result_value: str
    reason: str


@router.post("/{order_id}/items/{item_id}/amend")
def amend_result(order_id: int, item_id: int, p: AmendIn, request: Request,
                 db: Session = Depends(get_db), user: User = Depends(get_current_user),
                 scope: Scope = Depends(get_scope)):
    if user.role not in (Role.PATHOLOGIST, Role.LAB_ADMIN, Role.SUPER_ADMIN):
        raise HTTPException(status_code=403, detail="only a pathologist can amend")
    if not p.reason or not p.reason.strip():
        raise HTTPException(status_code=400, detail="an amendment reason is required")
    o = _load_order(db, scope, order_id)
    item = db.query(OrderItem).filter(OrderItem.id == item_id, OrderItem.order_id == o.id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Order item not found")

    patient = db.query(Patient).filter(Patient.id == o.patient_id).first() if o.patient_id else None
    new_flag = compute_flag(db, item.test_id, patient, p.result_value)
    amendment = ResultAmendment(
        tenant_id=o.tenant_id, order_id=o.id, order_item_id=item.id,
        old_value=item.result_value, new_value=p.result_value,
        old_flag=item.flag, new_flag=new_flag, reason=p.reason, amended_by=user.id,
    )
    db.add(amendment)
    item.result_value, item.flag = p.result_value, new_flag
    db.commit(); db.refresh(amendment)
    write_audit(db, action="amend", user=user, entity="order_item", entity_id=item.id,
                before={"value": amendment.old_value, "flag": amendment.old_flag},
                after={"value": p.result_value, "flag": new_flag}, detail=p.reason, ip=_ip2(request))
    return {"id": item.id, "result_value": item.result_value, "flag": new_flag,
            "amendment_id": amendment.id}


@router.get("/{order_id}/items/{item_id}/amendments")
def list_amendments(order_id: int, item_id: int, db: Session = Depends(get_db),
                    scope: Scope = Depends(get_scope)):
    _load_order(db, scope, order_id)
    rows = (db.query(ResultAmendment)
              .filter(ResultAmendment.order_item_id == item_id)
              .order_by(ResultAmendment.id.desc()).all())
    return [{"id": r.id, "old_value": r.old_value, "new_value": r.new_value,
             "old_flag": r.old_flag, "new_flag": r.new_flag, "reason": r.reason,
             "amended_by": r.amended_by, "created_at": r.created_at} for r in rows]


def _ip2(request: Request) -> Optional[str]:
    return request.client.host if request.client else None
