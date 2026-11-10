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
from models.org import Role, User, Franchise
from models.b2b import SampleTube, OrgGroup, OrgGroupTest, OrgGroupPackage
from models.clinical import TestCatalog, Package, PackageTest, ReferenceRange, Parameter, Department
from services.parameters import norm as _pnorm, split_aliases, names_of
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


def _key(v) -> str:
    """The form a name is matched in — on both sides of every lookup.

    A lab pasting names out of a browser or Word brings non-breaking spaces and
    the odd double space with them. Matching on the raw text makes those fail
    with an error that prints a name looking identical to the real one, which
    is unanswerable for whoever has to fix the sheet. So every space-like
    character becomes a plain space, runs of them collapse, and case is
    dropped.
    """
    if v is None:
        return ""
    s = str(v)
    for ch in "\u00a0\u2007\u202f\u2009\u200a\u2002\u2003\u3000\t\r\n":
        s = s.replace(ch, " ")
    return re.sub(r" +", " ", s).strip().lower()


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


def _yes_no(v, field, row_no, errors):
    """Cell -> True/False, or None for blank (blank means "leave as it is" on an
    existing row and "active" on a new one). Anything unrecognised is an error:
    guessing would switch a range on or off by accident."""
    if v is None or str(v).strip() == "":
        return None
    k = _key(v)
    if k in ("yes", "y", "true", "1", "active", "on"):
        return True
    if k in ("no", "n", "false", "0", "inactive", "off"):
        return False
    errors.append(f"Row {row_no}: {field} — '{v}' must be Yes or No")
    return None


def _rows(file_bytes, expected, errors, aliases=None):
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

    keys = [_key(h) for h in header]
    # A sheet downloaded before a column was renamed still has the old heading.
    # Accept it, so files already sitting on someone's desktop keep working.
    if aliases:
        for i, k in enumerate(keys):
            if k in aliases and aliases[k] not in keys:
                keys[i] = aliases[k]
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


# --------------------------------------------------------------------------- samples
def _sample(filename, title, columns, rows, *notes):
    """A filled-in template, so a lab can see the shape before touching theirs.

    The rows are examples, not data: every id is blank, so importing the file
    untouched would ADD them. The first note says so in as many words, because
    somebody will try it.
    """
    wb = Workbook()
    ws = _sheet(wb, title, columns)
    for r in rows:
        ws.append(r)
    _notes(wb,
           "These rows are EXAMPLES. Replace them with your own data, or delete them, before importing.",
           "Every id here is blank, which is what marks a row as new. On a sheet exported from your own"
           " catalog the ids are filled in — leave those alone.",
           *notes)
    return _stream(wb, filename)


@router.get("/sample/tests")
def sample_tests():
    return _sample("tests-SAMPLE.xlsx", "Tests", TEST_COLS, [
        [None, "CBC", "Complete Blood Count", "EDTA", None, None,
         300, 250, "See report", "HGB, PLT, WBC", None, None, None],
        [None, "HB",  "Haemoglobin", "EDTA", "g/dL", None,
         100, 100, None, "HGB", None, None, None],
        [None, "NA",  "Sodium (Na+)", "Serum (Plain)", "mmol/L", "ISE direct",
         200, 180, "136 - 145", "Sodium", "Dr AK Dhar", None, None],
        [None, "TSH", "Thyroid Stimulating Hormone", "Serum (Plain)", "uIU/mL", "CLIA",
         450, 400, "0.4 - 4.0", None, "Dr AK Dhar", None, None],
    ],
    "sample tube must already be in your Sample Tubes master — the exact name, nothing new.",
    "assigned doctor — a pathologist already on your account, by name or e-mail. Blank leaves it unassigned.",
    '"parameters" — an analyser sends everything it measures at once. The Erba EC 90 always reports Sodium, Potassium and Chloride, so a test billed as Sodium alone would print all three.',
    'Name here only the values THIS test should print, separated by commas, and the rest are left off the report. Leave it blank to print everything the analyser sent, which is what every test does until the column is filled in.',
    'Write the name the way the analyser reports it. Matching ignores capitals, spaces and punctuation, so Sodium, SODIUM, sodium and Na+ are all the same name.',
    'If nothing in the column matches what the analyser sent, the report prints everything rather than nothing — so a typo here can never produce an empty report, only an over-full one.')


@router.get("/sample/test-groups")
def sample_groups():
    return _sample("test-groups-SAMPLE.xlsx", "Test Groups", GROUP_COLS, [
        [None, "Lipid Profile", "LIPID",
         "Total Cholesterol, HDL Cholesterol, LDL Cholesterol, Triglycerides", 600],
        [None, "Anaemia Profile", "ANAEM", "Complete Blood Count, Haemoglobin", 450],
        [None, "Serum Electrolytes", "ELEC", "Sodium (Na+), Potassium (K+), Chloride (Cl-)", 500],
    ],
    "Separate the tests with commas:  Test A, Test B, Test C",
    "Spaces around a name do not matter, and neither do capitals — they are tidied up on import.",
    "A test whose own name contains a comma still works; it is matched whole.",
    "Each name must be a test that already exists. A test code works too.",
    "The list replaces the group's members — a name you remove here leaves the group.")


@router.get("/sample/reference-ranges")
def sample_ranges():
    return _sample("reference-ranges-SAMPLE.xlsx", "Reference Ranges", RANGE_COLS, [
        [None, "HGB", COMMON, "Male",     18, 65, None, None, 13, 17, "g/dL", 7, 21, None, None, None, "Yes"],
        [None, "HGB", COMMON, "Female",   18, 65, None, None, 12, 15, "g/dL", 7, 21, None, None, None, "Yes"],
        [None, "HGB", COMMON, "Children", None, None, 0, 12, 11, 14, "g/dL", None, None, None, None, None, "Yes"],
        [None, "HGB", "Complete Blood Count", "Any", None, None, None, None, 12, 16, "g/dL",
         None, None, None, None, None, "Yes"],
        [None, "WBC", COMMON, "Any", None, None, None, None, 4, 11, "10^3/uL", 2, 30,
         "Flow cytometry (laser scatter)", None, None, "Yes"],
    ],
    f'applies to — "{COMMON}" for a range shared by every test that reports the parameter,'
    " or the exact test name to make it apply to that one test only.",
    "The fourth row shows an override: the same parameter, narrowed to one test.",
    "patient group — Any, Male, Female or Children. Children takes the month columns.",
    "Leave low and high blank and fill method to set only the methodology printed on the report.",
    "active — Yes or No. No keeps the range but stops it being used on any report.")


# --------------------------------------------------------------------------- tests
# The Tests sheet mirrors the Add Test form, column for column.
#
# sample type is stored but read by nothing, and the target TAT is better
# derived from the received -> tested timestamps than typed per test, so
# neither belongs in a sheet a lab has to fill in. They stay in the database: a
# value already there is left alone, this sheet simply does not carry it.
# assigned doctor and department are here because the form has them.
TEST_COLS = ["id", "code", "name", "department", "sample tube", "unit", "method",
             "mrp", "price", "normal value", "parameters",
             "assigned doctor", "disclaimer", "interpretation"]


@router.get("/export/tests")
def export_tests(db: Session = Depends(get_db), scope: Scope = Depends(get_scope)):
    rows = apply_scope(db.query(TestCatalog), TestCatalog, scope).order_by(TestCatalog.name).all()
    tubes = {t.id: t.name for t in db.query(SampleTube).all()}
    docs  = {u.id: (u.full_name or u.email) for u in db.query(User)
             .filter(User.role == Role.PATHOLOGIST).all()}
    depts = {d.id: d.name for d in db.query(Department).all()}

    wb = Workbook()
    ws = _sheet(wb, "Tests", TEST_COLS)
    for t in rows:
        ws.append([t.id, t.code, t.name, depts.get(t.department_id),
                   tubes.get(t.sample_tube_id), t.unit, t.method,
                   t.mrp, t.price, t.normal_value, t.parameters,
                   docs.get(t.assigned_doctor_id), t.disclaimer, t.interpretation])
    _notes(wb,
           "Leave id blank to add a new test. Never change an id by hand.",
           "A row whose id is filled updates that test; nothing is ever deleted by importing.",
           "sample tube must match a name already in your Sample Tubes master.",
           "department must match a name already in your Departments master. Blank leaves the test's department as it is.",
           "assigned doctor — a pathologist already on your account, by name or e-mail."
           " Blank leaves the test unassigned.",
           '"parameters" — an analyser sends everything it measures at once. The Erba EC 90 always reports Sodium, Potassium and Chloride, so a test billed as Sodium alone would print all three.',
           'Name here only the values THIS test should print, separated by commas, and the rest are left off the report. Leave it blank to print everything the analyser sent, which is what every test does until the column is filled in.',
           'Write the name the way the analyser reports it. Matching ignores capitals, spaces and punctuation, so Sodium, SODIUM, sodium and Na+ are all the same name.',
           'If nothing in the column matches what the analyser sent, the report prints everything rather than nothing — so a typo here can never produce an empty report, only an over-full one.')
    return _stream(wb, "tests.xlsx")


@router.post("/import/tests", dependencies=[Depends(WRITE)])
async def import_tests(file: UploadFile = File(...), dry_run: bool = Query(False),
                       db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    errors = []
    data = _rows(await file.read(), ["name"], errors)
    tenant = user.tenant_id

    tubes = {_key(t.name): t.id for t in db.query(SampleTube).all()}
    dq = db.query(Department).filter(Department.is_active.is_(True))
    if tenant is not None:
        dq = dq.filter(Department.tenant_id == tenant)
    depts = {_key(d.name): d.id for d in dq.all()}
    docs  = {}
    for u in db.query(User).filter(User.role == Role.PATHOLOGIST).all():
        for label in (u.full_name, u.email):     # either is accepted in the cell
            if label:
                docs.setdefault(_key(label), u.id)
    by_id = {t.id: t for t in db.query(TestCatalog).all()}
    by_code = {_key(t.code): t for t in db.query(TestCatalog).all() if t.code}
    by_name = {_key(t.name): t for t in db.query(TestCatalog).all()}

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
            row = by_code.get(_key(code))
        if row is None:
            row = by_name.get(_key(name))

        tube_id = doc_id = None
        tname = _txt(r.get("sample tube"))
        if tname:
            tube_id = tubes.get(_key(tname))
            if tube_id is None:
                errors.append(f"Row {n}: sample tube '{tname}' does not exist")
        dept_id = None
        pname = _txt(r.get("department"))
        if pname:
            dept_id = depts.get(_key(pname))
            if dept_id is None:
                errors.append(f"Row {n}: department '{pname}' does not exist in Departments")
        dname = _txt(r.get("assigned doctor"))
        if dname:
            doc_id = docs.get(_key(dname))
            if doc_id is None:
                errors.append(f"Row {n}: assigned doctor '{dname}' is not a pathologist on this account")

        # Only the columns the sheet carries. department_id, sample_type and
        # tat_target_minutes are deliberately absent, so whatever is already in
        # the database for them survives an import untouched.
        vals = dict(
            code=code, name=name, sample_tube_id=tube_id,
            unit=_txt(r.get("unit")), method=_txt(r.get("method")),
            mrp=_num(r.get("mrp"), "mrp", n, errors) or 0.0,
            price=_num(r.get("price"), "price", n, errors) or 0.0,
            normal_value=_txt(r.get("normal value")),
            parameters=_txt(r.get("parameters")),
            assigned_doctor_id=doc_id,
            disclaimer=_txt(r.get("disclaimer")),
            interpretation=_txt(r.get("interpretation")),
        )
        if dept_id is not None:          # blank leaves the department already on the test
            vals["department_id"] = dept_id
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
def _split_tests(raw, resolve):
    """Split the cell into test names.

    Commas, because that is what people type. The catch is that a test name can
    contain one of its own — "Serum Electrolytes (Na, K, Cl)" is a real entry in
    this catalog — so a plain split would tear it into three names that match
    nothing. Instead the pieces are split and then greedily re-joined: the
    longest run of consecutive pieces that names a real test wins before any
    shorter one.

    A vertical bar still separates if the cell has one, because it is
    unambiguous and earlier exports used it.
    """
    if "|" in raw:
        return [p.strip() for p in raw.split("|") if p.strip()]
    pieces = [p.strip() for p in raw.split(",")]
    out, i = [], 0
    while i < len(pieces):
        if not pieces[i]:
            i += 1
            continue
        taken = None
        for j in range(len(pieces), i, -1):          # longest candidate first
            cand = ", ".join(pieces[i:j]).strip()
            if cand and resolve(cand) is not None:
                taken = (cand, j)
                break
        if taken:
            out.append(taken[0])
            i = taken[1]
        else:
            out.append(pieces[i])                     # unknown: reported below
            i += 1
    return out


# Headings match the New Test Group form, label for label.
GROUP_COLS = ["id", "group name", "code", "tests in this group", "group price"]
GROUP_ALIASES = {"name": "group name", "price": "group price", "tests": "tests in this group"}


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
        ws.append([p.id, p.name, p.code, ", ".join(sorted(members)), p.price])
    _notes(wb,
           'Separate the tests with commas:  Test A, Test B, Test C',
           "Spaces around a name do not matter, and neither do capitals — they are tidied up on import.",
           "A test whose own name contains a comma still works; it is matched whole.",
           "Each name must be a test that already exists. A test code works too.",
           "The list in the sheet replaces the group's members — a name you delete here leaves the group.",
           "Leave id blank to add a new group. Never change an id by hand.")
    return _stream(wb, "test-groups.xlsx")


@router.post("/import/test-groups", dependencies=[Depends(WRITE)])
async def import_groups(file: UploadFile = File(...), dry_run: bool = Query(False),
                        db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    errors = []
    data = _rows(await file.read(), ["group name", "tests in this group"], errors,
                 aliases=GROUP_ALIASES)
    tenant = user.tenant_id

    tests_by_name = {_key(t.name): t.id for t in db.query(TestCatalog).all()}
    tests_by_code = {_key(t.code): t.id for t in db.query(TestCatalog).all() if t.code}
    by_id = {p.id: p for p in db.query(Package).all()}
    by_name = {_key(p.name): p for p in db.query(Package).all()}

    created = updated = 0
    pending = []
    resolve = lambda nm: tests_by_name.get(_key(nm)) or tests_by_code.get(_key(nm))

    for n, r in data:
        name = _txt(r.get("group name"))
        if not name:
            errors.append(f"Row {n}: group name is required")
            continue
        rid = _num(r.get("id"), "id", n, errors, integer=True)
        row = by_id.get(rid) if rid else None
        if rid and not row:
            errors.append(f"Row {n}: id {rid} is not a test group. Leave id blank to add a new one.")
            continue
        if row is None:
            row = by_name.get(_key(name))

        ids = []
        for p in _split_tests(_txt(r.get("tests in this group")) or "", resolve):
            tid = resolve(p)
            if tid is None:
                errors.append(f"Row {n}: '{p}' is not a test in the catalog")
            else:
                ids.append(tid)
        if not ids:
            errors.append(f"Row {n}: a group needs at least one test")

        pending.append((row, dict(code=_txt(r.get("code")), name=name,
                                  price=_num(r.get("group price"), "group price", n, errors) or 0.0), ids))
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
# Headings and their order follow the Add reference range form, field for
# field. "(optional)" is left off "method": it is guidance in the form, not
# part of the field's name, and the other sheets drop it from "code" too.
RANGE_COLS = ["id", "parameter", "applies to", "patient group",
              "age from (years)", "age to (years)", "age from (months)", "age to (months)",
              "low", "high", "unit", "critical low", "critical high",
              "method", "analyser", "text range", "active"]

GROUP_IN  = {"any": "A", "male": "M", "female": "F", "children": "C",
             "a": "A", "m": "M", "f": "F", "c": "C"}
GROUP_OUT = {"A": "Any", "M": "Male", "F": "Female", "C": "Children"}
COMMON    = "Common (all tests)"


def _range_key(param, test_id, sex, age_min, age_max, age_min_months, age_max_months, device_id):
    """What makes two ranges the same range — see import_ranges."""
    return (_key(param), test_id, (sex or "A").upper(), age_min, age_max,
            age_min_months, age_max_months, device_id)


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
                   r.low, r.high, r.unit, r.critical_low, r.critical_high,
                   r.method, devs.get(r.device_id), r.text,
                   "No" if r.is_active is False else "Yes"])
    _notes(wb,
           'applies to — write "{COMMON}" for a range shared by every test that reports the parameter,'
           " or the exact test name to make it apply to that one test only.",
           "patient group — Any, Male, Female or Children.",
           "Leave low and high blank and fill method to set only the methodology.",
           "active — Yes or No. No keeps the range but stops it being used on any report. Blank leaves it as it is.",
           "Leave id blank to add a new range. A row with a blank id that matches an existing range "
           "(same parameter, applies to, patient group, ages and analyser) updates that range "
           "instead of adding a second copy. Never change an id by hand.")
    return _stream(wb, "reference-ranges.xlsx")


@router.post("/import/reference-ranges", dependencies=[Depends(WRITE)])
async def import_ranges(file: UploadFile = File(...), dry_run: bool = Query(False),
                        db: Session = Depends(get_db)):
    errors = []
    data = _rows(await file.read(), ["parameter", "applies to"], errors)

    tests_by_name = {_key(t.name): t.id for t in db.query(TestCatalog).all()}
    try:
        devs_by_name = {_key(d.name): d.id for d in db.query(Device).all()}
    except Exception:
        devs_by_name = {}
    existing = db.query(ReferenceRange).order_by(ReferenceRange.id).all()
    by_id = {r.id: r for r in existing}
    # A range is "the same range" when it is for the same parameter, test, patient
    # group, age bands and analyser. Without this a blank id always meant "add",
    # so importing one file twice doubled every range. Where the database
    # already holds duplicates, the oldest row is the one a sheet row matches.
    by_natural = {}
    for r0 in existing:
        by_natural.setdefault(_range_key(r0.param, r0.test_id, r0.sex, r0.age_min, r0.age_max,
                                         r0.age_min_months, r0.age_max_months, r0.device_id), r0)

    pending = []          # (row_no, existing row or None, values, natural key)
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
        if _key(applies) in (_key(COMMON), "common", "all tests", "all"):
            test_id = None
        else:
            test_id = tests_by_name.get(_key(applies))
            if test_id is None:
                errors.append(f"Row {n}: applies to — '{applies}' is not a test in the catalog")

        grp_raw = _txt(r.get("patient group")) or "Any"
        sex = GROUP_IN.get(_key(grp_raw))
        if sex is None:
            errors.append(f"Row {n}: patient group — '{grp_raw}' must be Any, Male, Female or Children")
            sex = "A"

        dev_id = None
        dname = _txt(r.get("analyser"))
        if dname:
            dev_id = devs_by_name.get(_key(dname))
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
        act = _yes_no(r.get("active"), "active", n, errors)
        if act is not None:
            vals["is_active"] = act     # blank: new rows default to active, old rows stay as they are
        pending.append((n, row, vals, _range_key(
            param, test_id, sex, vals["age_min"], vals["age_max"],
            vals["age_min_months"], vals["age_max_months"], dev_id)))

    # Settle which blank-id rows are really edits of a range that already exists.
    claimed = {id(row) for _, row, _, _ in pending if row is not None}
    id_keys = {key: n for n, row, _, key in pending if row is not None}
    seen_blank = {}
    resolved = []
    for n, row, vals, key in pending:
        if row is None:
            if key in id_keys:
                errors.append(f"Row {n}: repeats row {id_keys[key]} (same parameter, applies to, "
                              "patient group, ages and analyser). Edit that row instead.")
            elif key in seen_blank:
                errors.append(f"Row {n}: repeats row {seen_blank[key]} (same parameter, applies to, "
                              "patient group, ages and analyser).")
            else:
                seen_blank[key] = n
                match = by_natural.get(key)
                if match is not None and id(match) not in claimed:
                    row = match
                    claimed.add(id(match))
        resolved.append((row, vals))

    created = sum(1 for row, _ in resolved if row is None)
    updated = len(resolved) - created

    if errors or dry_run:
        return _result(created, updated, errors, dry_run)

    for row, vals in resolved:
        if row is None:
            row = ReferenceRange()
            db.add(row)
        for k, v in vals.items():
            setattr(row, k, v)
    db.commit()
    return _result(created, updated, errors, False)


# --------------------------------------------------------------------------- parameter list
# Mirrors the Add parameter form, field for field.
PARAM_COLS = ["id", "parameter", "section", "order", "aliases", "active"]


@router.get("/sample/parameters")
def sample_parameters():
    return _sample("parameters-SAMPLE.xlsx", "Parameters", PARAM_COLS, [
        [None, "WBC",        "WBC",         1, "TLC, White Blood Cells, Total Leucocyte Count", "Yes"],
        [None, "Neutrophils %", "WBC",      2, "NEUT%, NEU%, Neutrophils", "Yes"],
        [None, "Hemoglobin", "RBC",         1, "HGB, Hb, Haemoglobin", "Yes"],
        [None, "MCV",        "RBC INDICES", 1, None, "Yes"],
    ],
    "aliases — other names for the same parameter, separated by commas. A result that arrives under "
    "any of these names is treated as this parameter, so its reference range and its place on the report match.",
    "section — the heading the parameter prints under. Leave blank for none.",
    "order — position within the report (1, 2, 3 ...). Blank goes last.",
    "A name or alias can belong to one parameter only.")


@router.get("/export/parameters")
def export_parameters(db: Session = Depends(get_db)):
    rows = db.query(Parameter).order_by(Parameter.section, Parameter.sort_order, Parameter.name).all()
    wb = Workbook()
    ws = _sheet(wb, "Parameters", PARAM_COLS)
    for r in rows:
        ws.append([r.id, r.name, r.section, r.sort_order, r.aliases,
                   "No" if r.is_active is False else "Yes"])
    _notes(wb,
           "aliases — other names for the same parameter, separated by commas "
           "(WBC, TLC, White Blood Cells). A name or alias can belong to one parameter only.",
           "section — the heading it prints under. order — its position within the report.",
           "active — Yes or No. No keeps the parameter but stops it being used. Blank leaves it as it is.",
           "Leave id blank to add a new parameter; a blank id with a name that already exists updates that "
           "parameter. Never change an id by hand.")
    return _stream(wb, "parameters.xlsx")


@router.post("/import/parameters", dependencies=[Depends(WRITE)])
async def import_parameters(file: UploadFile = File(...), dry_run: bool = Query(False),
                            db: Session = Depends(get_db)):
    errors = []
    data = _rows(await file.read(), ["parameter"], errors)

    existing = db.query(Parameter).order_by(Parameter.id).all()
    by_id = {p.id: p for p in existing}
    by_name = {}
    for p in existing:
        by_name.setdefault(_key(p.name), p)

    resolved, claimed, seen_names = [], set(), {}
    for n, r in data:
        name = _txt(r.get("parameter"))
        if not name:
            errors.append(f"Row {n}: parameter is required")
            continue
        rid = _num(r.get("id"), "id", n, errors, integer=True)
        row = by_id.get(rid) if rid else None
        if rid and not row:
            errors.append(f"Row {n}: id {rid} is not a parameter. Leave id blank to add a new one.")
            continue
        if row is None:
            match = by_name.get(_key(name))
            if match is not None and match.id not in claimed:
                row = match
        if row is not None:
            claimed.add(row.id)
        if _key(name) in seen_names:
            errors.append(f"Row {n}: '{name}' repeats row {seen_names[_key(name)]}")
            continue
        seen_names[_key(name)] = n

        aliases = ", ".join(split_aliases(_txt(r.get("aliases")))) or None
        vals = dict(name=name, section=_txt(r.get("section")), aliases=aliases,
                    sort_order=_num(r.get("order"), "order", n, errors, integer=True))
        act = _yes_no(r.get("active"), "active", n, errors)
        if act is not None:
            vals["is_active"] = act
        resolved.append((n, row, vals))

    # A name or alias may belong to one parameter only — judged on the list as it
    # would stand after this import, so swapping two names in one sheet is fine.
    final = {p.id: (p.name, p.aliases) for p in existing}
    for n, row, vals in resolved:
        if row is not None:
            final[row.id] = (vals["name"], vals["aliases"])
    owners = {}
    def claim(who, label, nm, row_no=None):
        k = _pnorm(nm)
        if k in owners and owners[k][0] != who:
            where = f"Row {row_no}: " if row_no else ""
            errors.append(f"{where}'{nm}' is already used by '{owners[k][1]}'")
        else:
            owners.setdefault(k, (who, label))
    row_of = {row.id: n for n, row, _ in resolved if row is not None}
    for pid, (nm, al) in final.items():
        for x in [nm] + split_aliases(al):
            claim(("db", pid), nm, x, row_of.get(pid))
    for n, row, vals in resolved:
        if row is None:
            for x in [vals["name"]] + split_aliases(vals["aliases"]):
                claim(("new", n), vals["name"], x, n)

    created = sum(1 for _, row, _ in resolved if row is None)
    updated = len(resolved) - created
    if errors or dry_run:
        return _result(created, updated, errors, dry_run)

    for _, row, vals in resolved:
        if row is None:
            row = Parameter()
            db.add(row)
        for k, v in vals.items():
            setattr(row, k, v)
    db.commit()
    return _result(created, updated, errors, False)



# --------------------------------------------------------------------------- organizations
# One column per field on the Add/Edit Organization form, in the form's order.
ORG_COLS = ["id", "organization code", "organization name", "group", "contact person",
            "phone", "email", "credit limit", "pan", "aadhaar", "gstin", "address"]


def _org_scope(q, scope):
    if scope.tenant_id is not None:
        q = q.filter(Franchise.tenant_id == scope.tenant_id)
    return q


@router.get("/sample/organizations")
def sample_organizations():
    return _sample("organizations-SAMPLE.xlsx", "Organizations", ORG_COLS, [
        [None, "HCN41", "CHANDRANATH CHAKRABARTY", "B2B", None, "9876543210", "name@example.com",
         None, None, None, None, "Dankuni, Hooghly, West Bengal"],
        [None, None, "SUNRISE MEDICAL", None, None, None, None, None, None, None, None, None],
    ],
    "organization name is the only required column. organization code is optional; when it is filled the "
    "organization shows as 'CODE - NAME' (unless the name already begins with the code).",
    "group — the name of an Organization Group that already exists. Blank = standalone.",
    "credit limit — a whole number. Blank on a new row means 0; blank on an existing row leaves it as it is.",
    "A blank cell on an existing row leaves that field as it is. Nothing is ever deleted.")


@router.get("/export/organizations")
def export_organizations(db: Session = Depends(get_db), scope: Scope = Depends(get_scope)):
    from sqlalchemy import or_
    q = db.query(Franchise).filter(or_(Franchise.is_active.is_(True), Franchise.is_active.is_(None)))
    groups = {g.id: g.name for g in db.query(OrgGroup).all()}
    wb = Workbook()
    ws = _sheet(wb, "Organizations", ORG_COLS)
    for o in _org_scope(q, scope).order_by(Franchise.name).all():
        ws.append([o.id, o.code, o.name, groups.get(o.org_group_id), o.contact_person, o.phone,
                   o.email, o.credit_limit, o.pan, o.aadhaar, o.gstin, o.address])
    _notes(wb,
           "organization name is required. group must be the name of an existing Organization Group.",
           "Leave id blank to add a new organization; a blank id with a name that already exists updates "
           "that organization. A blank cell on an existing row leaves the field as it is. Nothing is deleted.")
    return _stream(wb, "organizations.xlsx")


@router.post("/import/organizations", dependencies=[Depends(WRITE)])
async def import_organizations(file: UploadFile = File(...), dry_run: bool = Query(False),
                               db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    errors = []
    data = _rows(await file.read(), ["organization name"], errors)
    tenant = user.tenant_id

    existing = _org_scope(db.query(Franchise), Scope(role=user.role, tenant_id=tenant)).all()
    by_id = {o.id: o for o in existing}
    # Two organizations can share a name and differ in code (HCN04 and HCN09 are
    # both AMIRUL SHEKH), so an organization is recognised by code + name.
    by_pair, by_bare = {}, {}
    for o in existing:
        by_pair.setdefault((_key(o.code), _key(o.name)), o)
        if not o.code:
            by_bare.setdefault(_key(o.name), o)
    groups = {_key(g.name): g.id for g in db.query(OrgGroup).all()}

    resolved, claimed, seen = [], set(), {}
    for n, r in data:
        name = _txt(r.get("organization name"))
        if not name:
            errors.append(f"Row {n}: organization name is required")
            continue
        rid = _num(r.get("id"), "id", n, errors, integer=True)
        row = by_id.get(rid) if rid else None
        if rid and not row:
            errors.append(f"Row {n}: id {rid} is not an organization. Leave id blank to add a new one.")
            continue
        code_cell = _txt(r.get("organization code"))
        pair = (_key(code_cell), _key(name))
        if row is None:
            m = by_pair.get(pair)
            if m is None and code_cell:
                m = by_bare.get(_key(name))      # an existing one that has no code yet
            if m is not None and m.id not in claimed:
                row = m
        if row is not None:
            claimed.add(row.id)
        if pair in seen:
            errors.append(f"Row {n}: '{name}' with this code repeats row {seen[pair]}")
            continue
        seen[pair] = n

        vals = dict(name=name)
        for col, field in (("organization code", "code"), ("contact person", "contact_person"),
                           ("phone", "phone"), ("email", "email"), ("pan", "pan"),
                           ("aadhaar", "aadhaar"), ("gstin", "gstin"), ("address", "address")):
            v = _txt(r.get(col))
            if v is not None:
                vals[field] = v
        g = _txt(r.get("group"))
        if g is not None:
            gid = groups.get(_key(g))
            if gid is None:
                errors.append(f"Row {n}: group '{g}' is not an Organization Group. Create it first, "
                              "or leave the cell blank.")
            else:
                vals["org_group_id"] = gid
        cl = _num(r.get("credit limit"), "credit limit", n, errors, integer=True)
        if cl is not None:
            vals["credit_limit"] = cl
        resolved.append((n, row, vals))

    created = sum(1 for _, row, _ in resolved if row is None)
    updated = len(resolved) - created
    if errors or dry_run:
        return _result(created, updated, errors, dry_run)

    for _, row, vals in resolved:
        if row is None:
            row = Franchise(tenant_id=tenant, is_active=True)
            db.add(row)
        for k, v in vals.items():
            setattr(row, k, v)
    db.commit()
    return _result(created, updated, errors, False)



# --------------------------------------------------------------------------- group pricing
# What each Organization Group charges: one row per group per test (or test group).
# Mirrors the Group / Org Pricing screen — pick a group, tick a test, set its own MRP and price.
GP_COLS = ["group", "test", "mrp", "price"]


def _gp_scope(q, tenant):
    return q.filter(OrgGroup.tenant_id == tenant) if tenant is not None else q


@router.get("/sample/group-pricing")
def sample_group_pricing():
    return _sample("group-pricing-SAMPLE.xlsx", "Group Pricing", GP_COLS, [
        ["HCN31", "CHIKUNGUNYA (IGG)", 1200, 300],
        ["HCN31", "ANA PROFILE", 7500, 1600],
        ["B2B",   "ANA PROFILE", 7500, 1600],
    ],
    "group — the Organization Group's name. A group that does not exist yet is created.",
    "test — the name of a test, or of a test group (package), exactly as it is in your catalog.",
    "mrp — optional; blank uses the catalog test's MRP. price — what this group is charged.",
    "A group's price here replaces nothing else: tests not in the sheet keep the price they have. "
    "Which organizations belong to the group is set on the Organizations page.")


@router.get("/export/group-pricing")
def export_group_pricing(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    groups = {g.id: g.name for g in _gp_scope(db.query(OrgGroup).filter(OrgGroup.is_active.isnot(False)),
                                                user.tenant_id).all()}
    tests = {t.id: t.name for t in db.query(TestCatalog).all()}
    pkgs = {p.id: p.name for p in db.query(Package).all()}
    wb = Workbook()
    ws = _sheet(wb, "Group Pricing", GP_COLS)
    for gid, gname in sorted(groups.items(), key=lambda kv: kv[1].lower()):
        for r in db.query(OrgGroupTest).filter(OrgGroupTest.org_group_id == gid).all():
            ws.append([gname, tests.get(r.test_id), r.mrp, r.price])
        for r in db.query(OrgGroupPackage).filter(OrgGroupPackage.org_group_id == gid).all():
            ws.append([gname, pkgs.get(r.package_id), r.mrp, r.price])
    _notes(wb,
           "group — created if it does not exist. test — a test or test group, by name.",
           "mrp blank = the catalog's MRP. Nothing is deleted: a test left out of the sheet keeps its price.")
    return _stream(wb, "group-pricing.xlsx")


@router.post("/import/group-pricing", dependencies=[Depends(WRITE)])
async def import_group_pricing(file: UploadFile = File(...), dry_run: bool = Query(False),
                               db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    errors = []
    data = _rows(await file.read(), GP_COLS, errors)
    tenant = user.tenant_id

    groups = {_key(g.name): g for g in _gp_scope(db.query(OrgGroup).filter(OrgGroup.is_active.isnot(False)),
                                                  tenant).all()}
    tests, dup_tests = {}, set()
    for t in db.query(TestCatalog).all():
        k = _key(t.name)
        if k in tests:
            dup_tests.add(k)
        tests.setdefault(k, t)
    pkgs = {_key(p.name): p for p in db.query(Package).all()}

    seen, resolved, new_groups = {}, [], {}
    for n, r in data:
        gname, item = _txt(r.get("group")), _txt(r.get("test"))
        if not gname:
            errors.append(f"Row {n}: group is required"); continue
        if not item:
            errors.append(f"Row {n}: test is required"); continue
        price = _num(r.get("price"), "price", n, errors)
        mrp = _num(r.get("mrp"), "mrp", n, errors)
        if price is None:
            errors.append(f"Row {n}: price is required") if r.get("price") in (None, "") else None
            continue
        if price < 0 or (mrp is not None and mrp < 0):
            errors.append(f"Row {n}: mrp and price cannot be negative"); continue
        kind = obj = None
        if _key(item) in tests:
            if _key(item) in dup_tests:
                errors.append(f"Row {n}: '{item}' is the name of more than one test in your catalog")
                continue
            kind, obj = "test", tests[_key(item)]
        elif _key(item) in pkgs:
            kind, obj = "package", pkgs[_key(item)]
        else:
            errors.append(f"Row {n}: '{item}' is not a test or a test group in your catalog")
            continue
        pair = (_key(gname), kind, obj.id)
        if pair in seen:
            errors.append(f"Row {n}: '{item}' repeats row {seen[pair]} for group '{gname}'"); continue
        seen[pair] = n
        if _key(gname) not in groups:
            new_groups.setdefault(_key(gname), gname)
        resolved.append((n, _key(gname), kind, obj, mrp if mrp is not None else (obj.mrp or 0.0), price))

    # what already exists, to tell added from updated
    existing_t = {(r.org_group_id, r.test_id): r for r in db.query(OrgGroupTest).all()}
    existing_p = {(r.org_group_id, r.package_id): r for r in db.query(OrgGroupPackage).all()}
    created = updated = 0
    for _, gk, kind, obj, mrp, price in resolved:
        g = groups.get(gk)
        have = None
        if g is not None:
            have = (existing_t if kind == "test" else existing_p).get((g.id, obj.id))
        if have is None: created += 1
        else: updated += 1
    if errors or dry_run:
        res = _result(created, updated, errors, dry_run)
        res["new_groups"] = len(new_groups)
        if dry_run and new_groups:
            res["message"] += " and create %d new group(s): %s" % (len(new_groups), ", ".join(new_groups.values()))
        return res

    for gk, gname in new_groups.items():
        g = OrgGroup(tenant_id=tenant, name=gname, is_active=True)
        db.add(g); db.flush(); groups[gk] = g
    for _, gk, kind, obj, mrp, price in resolved:
        g = groups[gk]
        if kind == "test":
            row = existing_t.get((g.id, obj.id))
            if row is None:
                row = OrgGroupTest(org_group_id=g.id, test_id=obj.id); db.add(row)
        else:
            row = existing_p.get((g.id, obj.id))
            if row is None:
                row = OrgGroupPackage(org_group_id=g.id, package_id=obj.id); db.add(row)
        row.mrp, row.price = mrp, price
    db.commit()
    res = _result(created, updated, errors, False)
    res["new_groups"] = len(new_groups)
    return res



# --------------------------------------------------------------------------- organization groups
OG_COLS = ["id", "group name"]


@router.get("/sample/org-groups")
def sample_org_groups():
    return _sample("org-groups-SAMPLE.xlsx", "Org Groups", OG_COLS,
                   [[None, "HCN31"], [None, "B2B"]],
                   "group name — the Organization Group's name. Groups that already exist are left as they are.")


@router.get("/export/org-groups")
def export_org_groups(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    wb = Workbook()
    ws = _sheet(wb, "Org Groups", OG_COLS)
    q = _gp_scope(db.query(OrgGroup).filter(OrgGroup.is_active.isnot(False)), user.tenant_id)
    for g in q.order_by(OrgGroup.name).all():
        ws.append([g.id, g.name])
    _notes(wb, "Leave id blank to add a new group; a blank id with a name that already exists is left as it is. "
               "Nothing is deleted.")
    return _stream(wb, "org-groups.xlsx")


@router.post("/import/org-groups", dependencies=[Depends(WRITE)])
async def import_org_groups(file: UploadFile = File(...), dry_run: bool = Query(False),
                            db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    errors = []
    data = _rows(await file.read(), ["group name"], errors)
    existing = _gp_scope(db.query(OrgGroup), user.tenant_id).all()
    by_id = {g.id: g for g in existing}
    by_name = {}
    for g in existing:
        by_name.setdefault(_key(g.name), g)
    resolved, seen = [], {}
    for n, r in data:
        name = _txt(r.get("group name"))
        if not name:
            errors.append(f"Row {n}: group name is required"); continue
        rid = _num(r.get("id"), "id", n, errors, integer=True)
        row = by_id.get(rid) if rid else None
        if rid and not row:
            errors.append(f"Row {n}: id {rid} is not an organization group. Leave id blank to add a new one.")
            continue
        renames = row is not None            # matched by id: the sheet may be renaming it
        if row is None:
            row = by_name.get(_key(name))
        if _key(name) in seen:
            errors.append(f"Row {n}: '{name}' repeats row {seen[_key(name)]}"); continue
        seen[_key(name)] = n
        resolved.append((row, name, renames))
    created = sum(1 for row, _, _ in resolved if row is None)
    updated = len(resolved) - created
    if errors or dry_run:
        return _result(created, updated, errors, dry_run)
    for row, name, renames in resolved:
        if row is None:
            db.add(OrgGroup(tenant_id=user.tenant_id, name=name, is_active=True))
        else:
            if renames:
                row.name = name
            row.is_active = True     # a group named in the sheet is wanted
    db.commit()
    return _result(created, updated, errors, False)


# --------------------------------------------------------------------------- who is in each group
GM_COLS = ["group", "organization code", "organization name"]


@router.get("/sample/group-members")
def sample_group_members():
    return _sample("group-members-SAMPLE.xlsx", "Assign Organizations", GM_COLS, [
        ["HCN31", "HCN1002", "DEBASISH BOWMICK"],
        ["HCN31", "HCN04", "AMIRUL SHEKH"],
    ],
    "Each row puts one organization into a group. The group and the organization must already exist.",
    "An organization is found by its code and name, as shown on the Organizations page. "
    "An organization can be in one group only: a row moves it there from wherever it was.")


@router.get("/export/group-members")
def export_group_members(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    groups = {g.id: g.name for g in db.query(OrgGroup).all()}
    wb = Workbook()
    ws = _sheet(wb, "Assign Organizations", GM_COLS)
    q = _org_scope(db.query(Franchise).filter(Franchise.org_group_id.isnot(None),
                                              Franchise.is_active.isnot(False)),
                   Scope(role=user.role, tenant_id=user.tenant_id))
    for o in sorted(q.all(), key=lambda o: (groups.get(o.org_group_id, "").lower(), (o.name or "").lower())):
        ws.append([groups.get(o.org_group_id), o.code, o.name])
    _notes(wb, "Nothing is removed from a group by leaving a row out. To take an organization out of a group, "
               "edit it on the Organizations page.")
    return _stream(wb, "group-members.xlsx")


@router.post("/import/group-members", dependencies=[Depends(WRITE)])
async def import_group_members(file: UploadFile = File(...), dry_run: bool = Query(False),
                               db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    errors = []
    data = _rows(await file.read(), ["group", "organization name"], errors)
    groups = {_key(g.name): g for g in _gp_scope(db.query(OrgGroup).filter(OrgGroup.is_active.isnot(False)),
                                                  user.tenant_id).all()}
    orgs = _org_scope(db.query(Franchise).filter(Franchise.is_active.isnot(False)),
                      Scope(role=user.role, tenant_id=user.tenant_id)).all()
    by_pair, by_name = {}, collections_default_list()
    for o in orgs:
        by_pair.setdefault((_key(o.code), _key(o.name)), o)
        by_name[_key(o.name)].append(o)
    resolved, seen = [], {}
    for n, r in data:
        gname, name, code = _txt(r.get("group")), _txt(r.get("organization name")), _txt(r.get("organization code"))
        if not gname or not name:
            errors.append(f"Row {n}: group and organization name are required"); continue
        g = groups.get(_key(gname))
        if g is None:
            errors.append(f"Row {n}: '{gname}' is not an Organization Group. Create it first."); continue
        o = by_pair.get((_key(code), _key(name)))
        if o is None and not code and len(by_name[_key(name)]) == 1:
            o = by_name[_key(name)][0]
        if o is None:
            errors.append(f"Row {n}: no organization '{(code + ' - ') if code else ''}{name}'. "
                          "Add it on the Organizations page first.")
            continue
        if o.id in seen:
            errors.append(f"Row {n}: '{name}' is already placed by row {seen[o.id]}"); continue
        seen[o.id] = n
        resolved.append((o, g))
    moved = sum(1 for o, g in resolved if o.org_group_id not in (None, g.id))
    added = sum(1 for o, g in resolved if o.org_group_id is None)
    already = len(resolved) - added - moved
    if errors or dry_run:
        res = _result(added, moved + already, errors, dry_run)
        if not errors and dry_run:
            res["message"] = "Would place %d (%d already in that group, %d moved from another group)" % (
                len(resolved), already, moved)
        return res
    for o, g in resolved:
        o.org_group_id = g.id
    db.commit()
    return _result(added, moved + already, errors, False)


def collections_default_list():
    import collections
    return collections.defaultdict(list)
