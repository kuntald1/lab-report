"""Turnaround-time reporting.

Computes the per-stage breakdown from sample_events, grouped by franchise, with
median / p90 / average per stage and the pre-/analytical/post-analytical rollup.
All queries are scope-filtered, so a franchise sees only its own TAT and a
lab_admin sees the whole tenant.
"""
import datetime as dt
from collections import defaultdict
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import Optional

from database import get_db
from models.org import Franchise
from models.clinical import Order, SampleEvent
from auth.deps import get_scope, apply_scope, Scope
from services import tat as tatsvc

router = APIRouter()


def _events_by_order(db: Session, order_ids: list) -> dict:
    """{order_id: {event_type: earliest datetime}} for the given orders."""
    out = defaultdict(dict)
    if not order_ids:
        return out
    rows = db.query(SampleEvent).filter(SampleEvent.order_id.in_(order_ids)).all()
    for e in rows:
        cur = out[e.order_id].get(e.event_type)
        if cur is None or e.event_at < cur:
            out[e.order_id][e.event_type] = e.event_at   # earliest wins per type
    return out


@router.get("/by-franchise")
def tat_by_franchise(db: Session = Depends(get_db), scope: Scope = Depends(get_scope),
                     date_from: Optional[str] = None, date_to: Optional[str] = None,
                     priority: Optional[str] = None):
    """Per-franchise TAT breakdown over a date window (defaults to last 60 days)."""
    q = apply_scope(db.query(Order), Order, scope)
    if priority:
        q = q.filter(Order.priority == priority)
    start = _parse(date_from) or (dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=60))
    end = _parse(date_to) or dt.datetime.now(dt.timezone.utc)
    q = q.filter(Order.created_at >= start, Order.created_at <= end)
    orders = q.all()

    ev = _events_by_order(db, [o.id for o in orders])

    # group orders by franchise
    by_fr = defaultdict(list)
    for o in orders:
        by_fr[o.franchise_id].append(tatsvc.stage_minutes(ev.get(o.id, {})))

    # resolve franchise names
    names = {f.id: f.name for f in db.query(Franchise).all()}

    result = []
    for fr_id, stages_list in by_fr.items():
        agg = tatsvc.aggregate(stages_list)
        agg["franchise_id"] = fr_id
        agg["franchise_name"] = names.get(fr_id, "Direct / Walk-in") if fr_id else "Direct / Walk-in"
        result.append(agg)
    result.sort(key=lambda r: (r["total"]["median"] if r.get("total") else 0), reverse=True)
    return {
        "window": {"from": start.isoformat(), "to": end.isoformat()},
        "stage_order": tatsvc.STAGE_NAMES,
        "franchises": result,
    }


@router.get("/order/{order_id}")
def tat_for_order(order_id: int, db: Session = Depends(get_db), scope: Scope = Depends(get_scope)):
    o = apply_scope(db.query(Order), Order, scope).filter(Order.id == order_id).first()
    if not o:
        raise HTTPException(status_code=404, detail="Order not found")
    ev = _events_by_order(db, [o.id]).get(o.id, {})
    return {
        "order_id": o.id, "barcode": o.barcode, "franchise_id": o.franchise_id,
        "priority": o.priority, "status": o.status,
        "events": {k: v.isoformat() for k, v in sorted(ev.items(), key=lambda kv: kv[1])},
        "stage_minutes": tatsvc.stage_minutes(ev),
    }


def _parse(s: Optional[str]) -> Optional[dt.datetime]:
    if not s:
        return None
    try:
        d = dt.datetime.fromisoformat(s)
        return d if d.tzinfo else d.replace(tzinfo=dt.timezone.utc)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Invalid date: {s} (use ISO format)")
