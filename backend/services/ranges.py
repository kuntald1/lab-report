"""Apply the lab's own reference ranges to a result at report time.

The analyser writes whatever range it knows into the result's parsed_data when
the sample is run, and that stays as the record of what the machine said. The
lab's catalog is the authority on what the *report* should show, though: it can
distinguish male from female, adult from child, and it can be corrected without
re-running a sample. So the ranges are looked up again whenever a result is
rendered, which also means a range the lab fixes today applies to reports that
were produced before it.

A flag a person set by hand is never overwritten — see `flag_manual`.
"""
from models.clinical import ReferenceRange
from models.billing import BillItem
from services.parameters import alias_map, canon, names_of, norm as _pnorm, active_parameters


def _norm(p) -> str:
    return (p or "").strip().upper()


def _to_float(v):
    try:
        return float(str(v).strip())
    except (TypeError, ValueError):
        return None


def patient_sex(patient) -> str:
    """'M', 'F', or 'A' when it isn't recorded or isn't one of the two."""
    g = getattr(patient, "gender", None)
    s = (g or "").strip()[:1].upper()
    return s if s in ("M", "F") else "A"


def patient_age_years(patient):
    a = getattr(patient, "age", None)
    return a if isinstance(a, int) else None


def patient_age_months(patient):
    """Age in months, or None when it isn't recorded.

    Patients currently carry whole years only, so this is None for everyone and
    month bands stay dormant. It starts working on its own the day an
    `age_months` column is added to patients — nothing here needs changing.
    """
    m = getattr(patient, "age_months", None)
    return m if isinstance(m, int) else None


def test_ids_for_result(db, result) -> list:
    """Which catalog tests this result's accession was billed for.

    One accession covers one sample tube, which may carry several tests, so
    this can return more than one id — the parameter decides which of them
    actually has a range.
    """
    acc = getattr(result, "accession_number", None)
    if not acc:
        return []
    rows = db.query(BillItem.test_id).filter(BillItem.accession_number == acc).all()
    return [t for (t,) in rows if t]


def _row_matches(row, sex, years, months, device_id) -> bool:
    # A row naming an analyser is only for results that analyser produced.
    if row.device_id is not None and row.device_id != device_id:
        return False

    # 'C' (children) says nothing about sex — the age band on the row is what
    # narrows it, exactly like 'A'.
    if (row.sex or "A").upper() not in ("A", "C", sex):
        return False

    has_months = row.age_min_months is not None or row.age_max_months is not None
    if has_months:
        # A month band can only be judged against an age known in months.
        if months is None:
            return False
        if row.age_min_months is not None and months < row.age_min_months:
            return False
        if row.age_max_months is not None and months > row.age_max_months:
            return False
        return True

    has_years = row.age_min is not None or row.age_max is not None
    if has_years:
        if years is None:
            return False
        if row.age_min is not None and years < row.age_min:
            return False
        if row.age_max is not None and years > row.age_max:
            return False
    return True


def _specificity(row, test_ids, device_id=None) -> tuple:
    """How closely a matching row is aimed at this particular result.

    The row that pins down the most wins. A row naming this analyser leads,
    because a methodology belongs to the machine and nothing else can stand in
    for it. After that comes the age band, then sex, then a row written for
    this one test.
    Among the rest, age leads because handing a child an adult range is a real
    clinical error, while a test-level override losing to an age band is only a
    configuration nuance — the lab can always add the age band to that test too.

    Ties go to the row entered first, so the outcome never depends on the order
    rows come back from the database.
    """
    aged = 1 if any(v is not None for v in
                    (row.age_min, row.age_max, row.age_min_months, row.age_max_months)) else 0
    # Only M/F actually narrow by sex. 'C' is a label for an age-banded row,
    # and it is the age band that earns it its specificity.
    sexed = 1 if (row.sex or "A").upper() in ("M", "F") else 0
    named_test = 1 if (row.test_id is not None and row.test_id in test_ids) else 0
    # A row written for this analyser outranks one written for all of them.
    named_device = 1 if (row.device_id is not None and row.device_id == device_id) else 0
    return (named_device, aged, sexed, named_test, -(row.id or 0))


def matching_rows(db, params, test_ids, patient, device_id=None) -> dict:
    """{PARAM: [ReferenceRange]} — every row that applies to this patient.

    More than one can apply at once, and they are not interchangeable: one row
    may carry the range while another carries only the methodology. Choosing a
    single winner here would silently drop the other, so the callers pick a
    winner per field instead.
    """
    # Names the Parameter list says are one parameter (WBC / TLC / White Blood
    # Cells) are compared as one. An empty list leaves every name as it was.
    amap = alias_map(db)
    wanted = {canon(amap, p) for p in params if _norm(p)}
    if not wanted:
        return {}

    # isnot(False), not is_(True): a row from before the column existed reads
    # NULL until the migration lands, and must keep working.
    q = (db.query(ReferenceRange).filter(ReferenceRange.param.isnot(None))
           .filter(ReferenceRange.is_active.isnot(False)))
    if test_ids:
        q = q.filter((ReferenceRange.test_id.is_(None)) |
                     (ReferenceRange.test_id.in_(test_ids)))
    else:
        q = q.filter(ReferenceRange.test_id.is_(None))

    sex, years, months = patient_sex(patient), patient_age_years(patient), patient_age_months(patient)

    found = {}
    for row in q.all():
        key = canon(amap, row.param)
        if key not in wanted or not _row_matches(row, sex, years, months, device_id):
            continue
        found.setdefault(key, []).append(row)
    return found


def _best(rows, test_ids, device_id=None):
    """The most specific of a set of rows, or None when the set is empty."""
    return max(rows, key=lambda r: _specificity(r, test_ids, device_id)) if rows else None


def _has_range(row) -> bool:
    return row.low is not None or row.high is not None or bool(row.text)


def best_rows(db, params, test_ids, patient, device_id=None) -> dict:
    """{PARAM: ReferenceRange} — the row whose range applies to each parameter."""
    return {k: _best([r for r in v if _has_range(r)], test_ids, device_id)
            for k, v in matching_rows(db, params, test_ids, patient, device_id).items()
            if any(_has_range(r) for r in v)}


def apply_catalog_ranges(db, parameters, test_ids, patient, device_id=None) -> list:
    """Return the parameters with the lab's ranges applied, as a new list.

    A parameter the catalog says nothing about is passed through untouched, so
    a lab that has configured nothing sees exactly what it sees today.
    """
    if not parameters:
        return parameters or []

    matches = matching_rows(db, [p.get("param") or p.get("name") for p in parameters],
                            test_ids, patient, device_id)
    if not matches:
        return parameters

    amap = alias_map(db)
    out = []
    for p in parameters:
        rows = matches.get(canon(amap, p.get("param") or p.get("name")))
        if not rows:
            out.append(p)
            continue

        q = dict(p)

        # The methodology and the range are resolved separately, because a lab
        # records the methodology once per parameter while the range is split by
        # sex and age. Were they resolved together, the sex-specific row would
        # win and the methodology row would be thrown away with it.
        m = _best([r for r in rows if r.method], test_ids, device_id)
        if m is not None:
            q["method"] = m.method

        row = _best([r for r in rows if _has_range(r)], test_ids, device_id)
        if row is None:
            # Methodology only: the analyser's own range and flag stand.
            out.append(q)
            continue

        q["ref_min"] = "" if row.low is None else row.low
        q["ref_max"] = "" if row.high is None else row.high
        if row.unit:
            q["unit"] = row.unit
        if row.text:
            q["ref_text"] = row.text          # qualitative, e.g. "Negative"

        # The printed range and the marker beside the value have to agree, or
        # the report contradicts itself. The one exception is a flag somebody
        # set deliberately: a doctor who marks a value abnormal has seen
        # something the numbers don't carry, and that judgement stands.
        if not p.get("flag_manual"):
            v = _to_float(p.get("value"))
            if v is None:
                q["flag"] = p.get("flag") or "N"
            elif row.low is not None and v < row.low:
                q["flag"] = "L"
            elif row.high is not None and v > row.high:
                q["flag"] = "H"
            else:
                q["flag"] = "N"
            q["status"] = {"H": "High", "L": "Low"}.get(q["flag"], "Normal")
        out.append(q)
    return out


def apply_to_result(db, result, patient) -> list:
    """apply_catalog_ranges for one LabResult, resolving its tests first."""
    parsed = result.parsed_data or {}
    return apply_catalog_ranges(db, parsed.get("parameters") or [],
                                test_ids_for_result(db, result), patient,
                                getattr(result, "device_id", None))


# ── which parameters a test actually reports ─────────────────────────────────

def _match_key(name) -> str:
    """Comparable form of a parameter name: letters and digits only, upper-case.

    So "Sodium", "SODIUM" and "sodium " are one name, and a catalog entry
    written "Na+" still matches an analyser reporting "NA".
    """
    return "".join(ch for ch in (name or "").upper() if ch.isalnum())


def declared_parameters(db, test_ids) -> set:
    """The parameter names the given catalog tests say they report.

    Empty set = no test declared a list, which means "print everything" — the
    behaviour of every test until someone fills the field in.
    """
    if not test_ids:
        return set()
    from models.clinical import TestCatalog
    rows = (db.query(TestCatalog.parameters)
              .filter(TestCatalog.id.in_(list(test_ids))).all())
    # A declared name that the Parameter list knows brings all its other names
    # with it, so a test listing "WBC" still prints a result the analyser sent
    # as "White Blood Cells".
    siblings = {}
    for prm in active_parameters(db):
        group = {_match_key(n) for n in names_of(prm) if _match_key(n)}
        for n in names_of(prm):
            siblings.setdefault(_pnorm(n), group)
    wanted = set()
    for (raw,) in rows:
        for piece in (raw or "").replace(";", ",").split(","):
            key = _match_key(piece)
            if key:
                wanted.add(key)
                wanted |= siblings.get(_pnorm(piece), set())
    return wanted


def filter_parameters_for_tests(db, parameters, test_ids) -> list:
    """Keep only the parameters the billed tests report.

    An analyser sends everything it measures at once — the Erba EC 90 always
    returns Sodium, Potassium and Chloride — so a patient billed for sodium
    alone would otherwise see all three on their report.

    Conservative on purpose: if no test declares a list, or nothing in the
    result matches the declared names (a renamed parameter, a typo), the
    parameters are returned untouched. Dropping every line would turn a
    configuration slip into an empty report, which is far worse than printing
    one extra row.
    """
    if not parameters:
        return parameters
    wanted = declared_parameters(db, test_ids)
    if not wanted:
        return parameters
    # Match on either spelling. A parameter carries both the analyser's short
    # code ("HGB", what reference ranges are keyed on) and the printed name
    # ("Hemoglobin"), so the lab can type whichever it thinks in.
    kept = [p for p in parameters
            if _match_key(p.get("param")) in wanted or _match_key(p.get("name")) in wanted]
    return kept or parameters
