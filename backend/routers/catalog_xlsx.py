"""Excel in and out for the three Tests Catalog tabs.

Export writes the sheet the import reads, so a lab can download, edit in Excel
and upload the same file back. Every exported row carries its `id`, which is
what makes the round trip an *edit* rather than a pile of duplicates: a row with
an id updates that record, a row with the id left blank is a new one.

Import never deletes. A record missing from the sheet is left alone, because a
spreadsheet is almost always a partial view of the catalog and silently wiping
whatever was not in it would be the worst possible reading of "import".

Nothing is written unless the whole sheet is valid. Errors are collected per
row and returned together, so a hundred-row file reports all its problems at
once rather than one per upload. `dry_run=true` runs the same validation and
reports what *would* change without touching the database.
"""
import io
import re
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from openpyxl import Workbook, load_workbook
from openpyxl.styles import Font, PatternFill, Alignment
from openpyxl.utils import get_column_letter

from database import get_db
from models.org import Role, User
from models.b2b import SampleTube
from models.clinical import Department, TestCatalog, Package, PackageTest, ReferenceRange
from models.models import Device
from auth.deps import get_current_user, get_scope, require_roles, apply_scope, Scope

router = APIRouter()
WRITE = require_roles(Role.SUPER_ADMIN, Role.LAB_ADMIN)

XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

HEAD_FILL = PatternFill("solid", fgColor="F97316")
HEAD_FONT = Font(bold=True, color="FFFFFF", size=10)
NOTE_FONT = Font(italic=True, color="8892A4", size=9)


# --------------------------------------------------------------------------- helpers
def _sheet(wb, title, columns, note=None):
    """A sheet with a frozen, styled header row and sensible column widths."""
    ws = wb.active if len(wb.sheetnames) == 1 and wb.active.max_row == 1 and wb.active.max_column == 1 else wb.create_sheet()
    ws.title = title
    ws.append(columns)
    for i, col in enumerate(columns, start=1):
        c = ws.cell(row=1, column=i)
        c.fill, c.font = HEAD_FILL, HEAD_FONT
        c.alignment = Alignment(vertical="center")
        ws.column_dimensions[get_column_letter(i)].width = max(12, min(34, len(str(col)) + 6))
    ws.freeze_panes = "A2"
    if note:
        ws.sheet_properties.tabColor = "F97316"
    return ws


def _notes(wb, *lines):
    """Instructions go on a second sheet, never under the data.

    A note written below the last row is still a row: the importer read it back
    as a record with no name and refused the whole file. The importer only ever
    looks at the first sheet, so anything here is safe.
    """
    ws = wb.create_sheet("How to edit")
    ws.column_dimensions["A"].width = 110
    ws.cell(row=1, column=1, value="How to edit this file").font = Font(bold=True, size=11)
    for i, line in enumerate(lines, start=3):
        c = ws.cell(row=i, column=1, value=line)
        c.font = NOTE_FONT
        c.alignment = Alignment(wrap_text=True, vertical="top")
    return ws


def _stream(wb, filename):
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return StreamingResponse(
        buf, media_type=XLSX_MIME,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


def _txt(v) -> Optional[str]:
    """Cell -> trimmed string, or None for blank. Excel hands back numbers for
    anything that looks numeric, so a code like 00123 arrives as 123."""
    if v is None:
        return None
    s = str(v).strip()
    if isinstance(v, float) and v.is_integer():
        s = str(int(v))
    return s or None


def _num(v, field, row_no, errors, integer=False):
    """Cell -> number, or None for blank. A bad value is an error, not a zero:
    writing 0 where the lab typed 'N/A' would quietly change a report."""
    if v is None or str(v).strip() == "":
        return None
    s = str(v).strip().replace(",", "")
    try:
        n = float(s)
    except ValueError:
        errors.append(f"Row {row_no}: {field} — '{v}' is not a number")
        return None
    if integer:
        if n != int(n):
            errors.append(f"Row {row_no}: {field} — '{v}' must be a whole number")
            return None
        return int(n)
    return n


def _rows(file_bytes, expected, errors):
    """Yield (row_no, {lowercased header: value}) for every non-empty row."""
    try:
        wb = load_workbook(io.BytesIO(file_bytes), data_only=True, read_only=True)
    except Exception as e:
        raise HTTPException(400, f"That file could not be read as an Excel workbook ({e})")
    ws = wb[wb.sheetnames[0]]
    rows = ws.iter_rows(values_only=True)
    try:
        header = next(rows)
    except StopIteration:
        raise HTTPException(400, "The sheet is empty")

    keys = [re.sub(r"\s+", " ", str(h or "").strip().lower()) for h in header]
    missing = [c for c in expected if c not in keys]
    if missing:
        raise HTTPException(
            400, "The sheet is missing these columns: " + ", ".join(missing)
            + ". Export the current data first and edit that file.")

    out = []
    for i, r in enumerate(rows, start=2):
        if all(c is None or str(c).strip() == "" for c in r):
            continue
        out.append((i, {keys[j]: r[j] for j in range(min(len(keys), len(r)))}))
    return out


def _result(created, updated, errors, dry_run):
    if errors:
        raise HTTPException(400, {"message": "Nothing was imported — fix these and try again",
                                  "errors": errors[:200], "error_count": len(errors)})
    return {"created": created, "updated": updated, "dry_run": dry_run,
            "message": ("Would add %d and update %d" if dry_run else "Added %d, updated %d") % (created, updated)}


# --------------------------------------------------------------------------- tests
TEST_COLS = ["id", "code", "name", "department", "sample type", "sample tube", "unit",
             "method", "mrp", "price", "normal value", "parameters",
             "tat target minutes", "disclaimer", "interpretation"]


@router.get("/export/tests")
def export_tests(db: Session = Depends(get_db), scope: Scope = Depends(get_scope)):
    rows = apply_scope(db.query(TestCatalog), TestCatalog, scope).order_by(TestCatalog.name).all()
    depts = {d.id: d.name for d in db.query(Department).all()}
    tubes = {t.id: t.name for t in db.query(SampleTube).all()}

    wb = Workbook()
    ws = _sheet(wb, "Tests", TEST_COLS)
    for t in rows:
        ws.append([t.id, t.code, t.name, depts.get(t.department_id), t.sample_type,
                   tubes.get(t.sample_tube_id), t.unit, t.method, t.mrp, t.price,
                   t.normal_value, t.parameters, t.tat_target_minutes,
                   t.disclaimer, t.interpretation])
    _notes(wb,
           "Leave id blank to add a new test. Never change an id by hand.",
           "A row whose id is filled updates that test; nothing is ever deleted by importing.",
           "department and sample tube must match a name that already exists.",
           'parameters — which of the analyser\'s parameters this test prints, comma separated.'
           " Blank prints whatever the analyser sent.")
    return _stream(wb, "tests.xlsx")


@router.post("/import/tests", dependencies=[Depends(WRITE)])
async def import_tests(file: UploadFile = File(...), dry_run: bool = Query(False),
                       db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    errors = []
    data = _rows(await file.read(), ["name"], errors)
    tenant = user.tenant_id

    depts = {(d.name or "").strip().lower(): d.id for d in db.query(Department).all()}
    tubes = {(t.name or "").strip().lower(): t.id for t in db.query(SampleTube).all()}
    by_id = {t.id: t for t in db.query(TestCatalog).all()}
    by_code = {(t.code or "").strip().lower(): t for t in db.query(TestCatalog).all() if t.code}
    by_name = {(t.name or "").strip().lower(): t for t in db.query(TestCatalog).all()}

    created = updated = 0
    pending = []
    for n, r in data:
        name = _txt(r.get("name"))
        if not name:
            errors.append(f"Row {n}: name is required")
            continue

        rid = _num(r.get("id"), "id", n, errors, integer=True)
        code = _txt(r.get("code"))
        # id first, then code, then name — the sheet's own identity order.
        row = by_id.get(rid) if rid else None
        if rid and not row:
            errors.append(f"Row {n}: id {rid} is not a test in this catalog. Leave id blank to add a new test.")
            continue
        if row is None and code:
            row = by_code.get(code.lower())
        if row is None:
            row = by_name.get(name.lower())

        dept_id = tube_id = None
        dname = _txt(r.get("department"))
        if dname:
            dept_id = depts.get(dname.lower())
            if dept_id is None:
                errors.append(f"Row {n}: department '{dname}' does not exist")
        tname = _txt(r.get("sample tube"))
        if tname:
            tube_id = tubes.get(tname.lower())
            if tube_id is None:
                errors.append(f"Row {n}: sample tube '{tname}' does not exist")

        vals = dict(
            code=code, name=name, department_id=dept_id,
            sample_type=_txt(r.get("sample type")), sample_tube_id=tube_id,
            unit=_txt(r.get("unit")), method=_txt(r.get("method")),
            mrp=_num(r.get("mrp"), "mrp", n, errors) or 0.0,
            price=_num(r.get("price"), "price", n, errors) or 0.0,
            normal_value=_txt(r.get("normal value")),
            parameters=_txt(r.get("parameters")),
            tat_target_minutes=_num(r.get("tat target minutes"), "tat target minutes", n, errors, integer=True),
            disclaimer=_txt(r.get("disclaimer")),
            interpretation=_txt(r.get("interpretation")),
        )
        pending.append((row, vals))
        if row:
            updated += 1
        else:
            created += 1

    if errors or dry_run:
        return _result(created, updated, errors, dry_run)

    for row, vals in pending:
        if row is None:
            row = TestCatalog(tenant_id=tenant)
            db.add(row)
        for k, v in vals.items():
            setattr(row, k, v)
    db.commit()
    return _result(created, updated, errors, False)


# --------------------------------------------------------------------------- test groups
GROUP_COLS = ["id", "code", "name", "price", "tests"]


@router.get("/export/test-groups")
def export_groups(db: Session = Depends(get_db), scope: Scope = Depends(get_scope)):
    pkgs = apply_scope(db.query(Package), Package, scope).order_by(Package.name).all()
    names = {t.id: t.name for t in db.query(TestCatalog).all()}
    links = {}
    for pt in db.query(PackageTest).all():
        links.setdefault(pt.package_id, []).append(names.get(pt.test_id))

    wb = Workbook()
    ws = _sheet(wb, "Test Groups", GROUP_COLS)
    for p in pkgs:
        members = [m for m in links.get(p.id, []) if m]
        ws.append([p.id, p.code, p.name, p.price, " | ".join(sorted(members))])
    _notes(wb,
           'Separate the tests in the "tests" column with a vertical bar:  Test A | Test B',
           "Each name must match a test in the Tests sheet exactly.",
           "The list in the sheet replaces the group's members — a name you delete here leaves the group.",
           "Leave id blank to add a new group. Never change an id by hand.")
    return _stream(wb, "test-groups.xlsx")


@router.post("/import/test-groups", dependencies=[Depends(WRITE)])
async def import_groups(file: UploadFile = File(...), dry_run: bool = Query(False),
                        db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    errors = []
    data = _rows(await file.read(), ["name", "tests"], errors)
    tenant = user.tenant_id

    tests_by_name = {(t.name or "").strip().lower(): t.id for t in db.query(TestCatalog).all()}
    tests_by_code = {(t.code or "").strip().lower(): t.id for t in db.query(TestCatalog).all() if t.code}
    by_id = {p.id: p for p in db.query(Package).all()}
    by_name = {(p.name or "").strip().lower(): p for p in db.query(Package).all()}

    created = updated = 0
    pending = []
    for n, r in data:
        name = _txt(r.get("name"))
        if not name:
            errors.append(f"Row {n}: name is required")
            continue
        rid = _num(r.get("id"), "id", n, errors, integer=True)
        row = by_id.get(rid) if rid else None
        if rid and not row:
            errors.append(f"Row {n}: id {rid} is not a test group. Leave id blank to add a new one.")
            continue
        if row is None:
            row = by_name.get(name.lower())

        # '|' first; a comma would split test names that contain one.
        raw = _txt(r.get("tests")) or ""
        parts = [p.strip() for p in (raw.split("|") if "|" in raw else raw.split(",")) if p.strip()]
        ids = []
        for p in parts:
            tid = tests_by_name.get(p.lower()) or tests_by_code.get(p.lower())
            if tid is None:
                errors.append(f"Row {n}: '{p}' is not a test in the catalog")
            else:
                ids.append(tid)
        if not ids:
            errors.append(f"Row {n}: a group needs at least one test")

        pending.append((row, dict(code=_txt(r.get("code")), name=name,
                                  price=_num(r.get("price"), "price", n, errors) or 0.0), ids))
        if row:
            updated += 1
        else:
            created += 1

    if errors or dry_run:
        return _result(created, updated, errors, dry_run)

    for row, vals, ids in pending:
        if row is None:
            row = Package(tenant_id=tenant)
            db.add(row)
        for k, v in vals.items():
            setattr(row, k, v)
        db.flush()
        # the sheet's test list replaces the group's membership, which is the
        # only way to remove a test from a group through Excel
        db.query(PackageTest).filter(PackageTest.package_id == row.id).delete()
        for tid in dict.fromkeys(ids):
            db.add(PackageTest(package_id=row.id, test_id=tid))
    db.commit()
    return _result(created, updated, errors, False)


# --------------------------------------------------------------------------- reference ranges
RANGE_COLS = ["id", "parameter", "applies to", "patient group", "age from (years)", "age to (years)",
              "age from (months)", "age to (months)", "low", "high",
              "critical low", "critical high", "unit", "text range", "method", "analyser"]

GROUP_IN  = {"any": "A", "male": "M", "female": "F", "children": "C",
             "a": "A", "m": "M", "f": "F", "c": "C"}
GROUP_OUT = {"A": "Any", "M": "Male", "F": "Female", "C": "Children"}
COMMON    = "Common (all tests)"


@router.get("/export/reference-ranges")
def export_ranges(db: Session = Depends(get_db)):
    rows = db.query(ReferenceRange).order_by(ReferenceRange.param, ReferenceRange.id).all()
    tests = {t.id: t.name for t in db.query(TestCatalog).all()}
    try:
        devs = {d.id: d.name for d in db.query(Device).all()}
    except Exception:
        devs = {}

    wb = Workbook()
    ws = _sheet(wb, "Reference Ranges", RANGE_COLS)
    for r in rows:
        ws.append([r.id, r.param,
                   COMMON if r.test_id is None else tests.get(r.test_id, f"#{r.test_id}"),
                   GROUP_OUT.get((r.sex or "A").upper(), "Any"),
                   r.age_min, r.age_max, r.age_min_months, r.age_max_months,
                   r.low, r.high, r.critical_low, r.critical_high,
                   r.unit, r.text, r.method, devs.get(r.device_id)])
    _notes(wb,
           'applies to — write "{COMMON}" for a range shared by every test that reports the parameter,'
           " or the exact test name to make it apply to that one test only.",
           "patient group — Any, Male, Female or Children.",
           "Leave low and high blank and fill method to set only the methodology.",
           "Leave id blank to add a new range. Never change an id by hand.")
    return _stream(wb, "reference-ranges.xlsx")


@router.post("/import/reference-ranges", dependencies=[Depends(WRITE)])
async def import_ranges(file: UploadFile = File(...), dry_run: bool = Query(False),
                        db: Session = Depends(get_db)):
    errors = []
    data = _rows(await file.read(), ["parameter", "applies to"], errors)

    tests_by_name = {(t.name or "").strip().lower(): t.id for t in db.query(TestCatalog).all()}
    try:
        devs_by_name = {(d.name or "").strip().lower(): d.id for d in db.query(Device).all()}
    except Exception:
        devs_by_name = {}
    by_id = {r.id: r for r in db.query(ReferenceRange).all()}

    created = updated = 0
    pending = []
    for n, r in data:
        param = _txt(r.get("parameter"))
        if not param:
            errors.append(f"Row {n}: parameter is required")
            continue

        rid = _num(r.get("id"), "id", n, errors, integer=True)
        row = by_id.get(rid) if rid else None
        if rid and not row:
            errors.append(f"Row {n}: id {rid} is not a reference range. Leave id blank to add a new one.")
            continue

        applies = _txt(r.get("applies to"))
        if not applies:
            errors.append(f"Row {n}: applies to is required — "
                          f'"{COMMON}" or an exact test name')
            continue
        if applies.strip().lower() in (COMMON.lower(), "common", "all tests", "all"):
            test_id = None
        else:
            test_id = tests_by_name.get(applies.lower())
            if test_id is None:
                errors.append(f"Row {n}: applies to — '{applies}' is not a test in the catalog")

        grp_raw = _txt(r.get("patient group")) or "Any"
        sex = GROUP_IN.get(grp_raw.lower())
        if sex is None:
            errors.append(f"Row {n}: patient group — '{grp_raw}' must be Any, Male, Female or Children")
            sex = "A"

        dev_id = None
        dname = _txt(r.get("analyser"))
        if dname:
            dev_id = devs_by_name.get(dname.lower())
            if dev_id is None:
                errors.append(f"Row {n}: analyser '{dname}' does not exist")

        lo = _num(r.get("low"), "low", n, errors)
        hi = _num(r.get("high"), "high", n, errors)
        if lo is not None and hi is not None and lo > hi:
            errors.append(f"Row {n}: low ({lo}) is greater than high ({hi})")

        vals = dict(
            param=param, test_id=test_id, sex=sex,
            age_min=_num(r.get("age from (years)"), "age from (years)", n, errors, integer=True),
            age_max=_num(r.get("age to (years)"), "age to (years)", n, errors, integer=True),
            age_min_months=_num(r.get("age from (months)"), "age from (months)", n, errors, integer=True),
            age_max_months=_num(r.get("age to (months)"), "age to (months)", n, errors, integer=True),
            low=lo, high=hi,
            critical_low=_num(r.get("critical low"), "critical low", n, errors),
            critical_high=_num(r.get("critical high"), "critical high", n, errors),
            unit=_txt(r.get("unit")), text=_txt(r.get("text range")),
            method=_txt(r.get("method")), device_id=dev_id,
        )
        pending.append((row, vals))
        if row:
            updated += 1
        else:
            created += 1

    if errors or dry_run:
        return _result(created, updated, errors, dry_run)

    for row, vals in pending:
        if row is None:
            row = ReferenceRange()
            db.add(row)
        for k, v in vals.items():
            setattr(row, k, v)
    db.commit()
    return _result(created, updated, errors, False)
