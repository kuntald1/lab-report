"""
Turnaround-time engine.

Pure functions (no DB) so they're portable and unit-testable. The router feeds
them sample-event rows; they return the per-stage breakdown and per-group
aggregates (median / p90 / average).

Stages are the gaps between consecutive lifecycle events:

    collected ─┬─ wait_for_pickup ──> dispatched
               ├─ transit ───────────> received
               ├─ receipt_accessioning > test_started
               ├─ testing ───────────> resulted
               ├─ validation ────────> validated
               └─ reporting ─────────> reported   (= total: collected -> reported)
"""
from datetime import datetime
from typing import Optional

from models.clinical import EventType

# (stage_name, from_event, to_event)
STAGES = [
    ("wait_for_pickup",       EventType.COLLECTED,    EventType.DISPATCHED),
    ("transit",               EventType.DISPATCHED,   EventType.RECEIVED),
    ("receipt_accessioning",  EventType.RECEIVED,     EventType.TEST_STARTED),
    ("testing",               EventType.TEST_STARTED, EventType.RESULTED),
    ("validation",            EventType.RESULTED,     EventType.VALIDATED),
    ("reporting",             EventType.VALIDATED,    EventType.REPORTED),
]

# which of the three classic phases each stage belongs to
PHASE_OF_STAGE = {
    "wait_for_pickup":      "pre_analytical",
    "transit":              "pre_analytical",
    "receipt_accessioning": "pre_analytical",
    "testing":              "analytical",
    "validation":           "post_analytical",
    "reporting":            "post_analytical",
}

STAGE_NAMES = [s[0] for s in STAGES]


def stage_minutes(events: dict) -> dict:
    """events: {event_type: datetime}. Returns {stage: minutes|None, 'total': minutes|None}."""
    out = {}
    for name, a, b in STAGES:
        ta, tb = events.get(a), events.get(b)
        out[name] = _minutes(ta, tb)
    out["total"] = _minutes(events.get(EventType.COLLECTED), events.get(EventType.REPORTED))
    return out


def _minutes(a: Optional[datetime], b: Optional[datetime]) -> Optional[float]:
    if a is None or b is None:
        return None
    delta = (b - a).total_seconds() / 60.0
    return round(delta, 1) if delta >= 0 else None


def percentile(sorted_vals, q: float) -> float:
    """Linear-interpolation percentile (like Postgres percentile_cont). q in [0,1]."""
    if not sorted_vals:
        return None
    if len(sorted_vals) == 1:
        return sorted_vals[0]
    idx = q * (len(sorted_vals) - 1)
    lo = int(idx)
    hi = min(lo + 1, len(sorted_vals) - 1)
    frac = idx - lo
    return round(sorted_vals[lo] + (sorted_vals[hi] - sorted_vals[lo]) * frac, 1)


def _summarise(values) -> Optional[dict]:
    vals = sorted(v for v in values if v is not None)
    if not vals:
        return None
    return {
        "median": percentile(vals, 0.5),
        "p90":    percentile(vals, 0.9),
        "avg":    round(sum(vals) / len(vals), 1),
        "n":      len(vals),
    }


def aggregate(orders_stages: list) -> dict:
    """orders_stages: list of stage_minutes() dicts (one per order in a group).

    Returns per-stage summaries, a total summary, and a phase rollup built from
    the stage medians.
    """
    stages = {}
    for name in STAGE_NAMES:
        stages[name] = _summarise([o.get(name) for o in orders_stages])
    total = _summarise([o.get("total") for o in orders_stages])

    phases = {"pre_analytical": 0.0, "analytical": 0.0, "post_analytical": 0.0}
    for name in STAGE_NAMES:
        s = stages.get(name)
        if s and s["median"] is not None:
            phases[PHASE_OF_STAGE[name]] += s["median"]
    phases = {k: round(v, 1) for k, v in phases.items()}

    return {"order_count": len(orders_stages), "stages": stages, "total": total, "phases": phases}
