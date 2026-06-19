"""
Turnaround-time reporting.

Reads sample_events directly (decoupled from orders): events are grouped per
sample, stage durations computed, then aggregated per franchise with
median / p90 / average and the pre-/analytical/post-analytical rollup.
Scope-filtered, so a franchise sees only its own TAT and a lab_admin the tenant.
"""
import datetime as dt
from collections import defaultdict
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import Optional

from database import get_db
from models.org import Franchise
from models.clinical import SampleEvent
from models.clinical import EventType
from auth.deps import get_scope, apply_scope, Scope
from services import tat as tatsvc

router = APIRouter()


def _sample_key(e: SampleEvent):
    return ("o", e.order_id) if e.order_id else ("p", e.patient_id)


@router.get("/by-franchise")
def tat_by_franchise(db: Session = Depends(get_db), scope: Scope = Depends(get_scope),
                     date_from: Optional[str] = None, date_to: Optional[str] = None):
    """Per-franchise TAT breakdown over a window (defaults to last 60 days)."""
    start = _parse(date_from) or (dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=60))
    end = _parse(date_to) or dt.datetime.now(dt.timezone.utc)

    events = apply_scope(db.query(SampleEvent), SampleEvent, scope).all()

    # group events per sample -> {event_type: earliest dt}, remember franchise
    samples = defaultdict(lambda: {"events": {}, "franchise_id": None})
    for e in events:
        key = _sample_key(e)
        slot = samples[key]
        cur = slot["events"].get(e.event_type)
        if cur is None or (e.event_at and e.event_at < cur):
            slot["events"][e.event_type] = e.event_at
        if slot["franchise_id"] is None:
            slot["franchise_id"] = e.franchise_id

    # group samples per franchise, applying the date window on the collected time
    by_fr = defaultdict(list)
    for slot in samples.values():
        ev = slot["events"]
        collected = ev.get(EventType.COLLECTED)
        if collected is not None and not (start <= collected <= end):
            continue
        by_fr[slot["franchise_id"]].append(tatsvc.stage_minutes(ev))

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


def _parse(s: Optional[str]) -> Optional[dt.datetime]:
    if not s:
        return None
    try:
        d = dt.datetime.fromisoformat(s)
        return d if d.tzinfo else d.replace(tzinfo=dt.timezone.utc)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Invalid date: {s} (use ISO format)")
