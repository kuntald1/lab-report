"""Flag a numeric result against the best-matching reference range.

Returns one of: 'critical', 'low', 'high', 'normal', or None (no usable range /
non-numeric value). Critical takes precedence and drives the critical-value alert.
"""
from models.clinical import ReferenceRange


def to_float(value):
    try:
        return float(str(value).strip())
    except (TypeError, ValueError):
        return None


def best_range(db, test_id, patient):
    sex = "A"
    age = None
    if patient is not None:
        if patient.gender:
            sex = patient.gender.strip()[:1].upper()
        age = patient.age
    rows = db.query(ReferenceRange).filter(ReferenceRange.test_id == test_id).all()
    for r in rows:
        if r.sex not in ("A", sex):
            continue
        if r.age_min is not None and age is not None and age < r.age_min:
            continue
        if r.age_max is not None and age is not None and age > r.age_max:
            continue
        return r
    return None


def compute_flag(db, test_id, patient, value):
    if test_id is None:
        return None
    v = to_float(value)
    if v is None:
        return None
    r = best_range(db, test_id, patient)
    if not r:
        return None
    if r.critical_low is not None and v < r.critical_low:
        return "critical"
    if r.critical_high is not None and v > r.critical_high:
        return "critical"
    if r.low is not None and v < r.low:
        return "low"
    if r.high is not None and v > r.high:
        return "high"
    return "normal"
