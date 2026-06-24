"""
One-off importer: load the exported test master (export.xlsx, 469 rows) into
MediCloud's test_catalog, creating departments and sample tubes as it goes.

Usage (run inside the backend container, with the file copied in):
    docker compose cp export.xlsx backend:/app/export.xlsx
    docker compose exec backend python scripts/import_tests.py /app/export.xlsx [TENANT_ID]

Safe to re-run: tests are matched by (tenant_id, name) and updated, not duplicated.
Requires openpyxl in the backend image (add to requirements.txt if missing).
"""
import sys
import re
import openpyxl
from database import SessionLocal
from models.clinical import TestCatalog, Department
from models.b2b import SampleTube

# normalize near-duplicate department names from the export
DEPT_CANON = {
    "haematology": "Hematology",
    "hematology": "Hematology",
    "immunology": "Immunology & Serology",
    "immunology & serology": "Immunology & Serology",
    "serology": "Immunology & Serology",
    "biochemistry": "Clinical Biochemistry",
    "clinical biochemistry": "Clinical Biochemistry",
    "clinical microbiology": "Microbiology",
    "molecular biology": "Molecular Pathology",
    "molecular pathology": "Molecular Pathology",
}

# map a sample type -> (tube name, colour) where it's well known
TUBE_FOR_SAMPLE = {
    "edta plain": ("EDTA", "Lavender"),
    "whole blood edta": ("EDTA", "Lavender"),
    "sodium citrate": ("Sodium Citrate", "Blue"),
    "citrated plasma": ("Sodium Citrate", "Blue"),
    "fluoride plasma": ("Fluoride", "Grey"),
    "glucose fluoride(3 vials)": ("Fluoride", "Grey"),
    "whole blood sodium heparine": ("Sodium Heparin", "Green"),
    "serum": ("Serum (Plain)", "Red"),
}


def parse_tat_minutes(s):
    """'3 Days 0 hr 0 min' / '4 hr 0 min' -> total minutes (int) or None."""
    if not s or s == "-":
        return None
    days = hrs = mins = 0
    m = re.search(r"(\d+)\s*Day", s, re.I);  days = int(m.group(1)) if m else 0
    m = re.search(r"(\d+)\s*hr", s, re.I);    hrs  = int(m.group(1)) if m else 0
    m = re.search(r"(\d+)\s*min", s, re.I);   mins = int(m.group(1)) if m else 0
    total = days * 24 * 60 + hrs * 60 + mins
    return total or None


def canon_dept(name):
    if not name or name == "-":
        return None
    return DEPT_CANON.get(name.strip().lower(), name.strip())


def get_or_create_department(db, name, tenant_id):
    if not name:
        return None
    d = db.query(Department).filter(Department.tenant_id == tenant_id, Department.name == name).first()
    if not d:
        d = Department(tenant_id=tenant_id, name=name)
        db.add(d); db.flush()
    return d


def get_or_create_tube(db, sample_type, tenant_id, cache):
    if not sample_type or sample_type == "-":
        return None
    key = sample_type.strip().lower()
    if key in cache:
        return cache[key]
    tube_name, color = TUBE_FOR_SAMPLE.get(key, (sample_type.strip(), None))
    t = db.query(SampleTube).filter(SampleTube.tenant_id == tenant_id, SampleTube.name == tube_name).first()
    if not t:
        t = SampleTube(tenant_id=tenant_id, name=tube_name, color=color)
        db.add(t); db.flush()
    cache[key] = t
    return t


def run(path, tenant_id=None):
    wb = openpyxl.load_workbook(path, data_only=True)
    ws = wb.active
    rows = list(ws.iter_rows(values_only=True))
    header = [str(h).strip() if h else "" for h in rows[0]]
    col = {name: i for i, name in enumerate(header)}

    db = SessionLocal()
    tube_cache = {}
    created = updated = 0
    try:
        for r in rows[1:]:
            name = (r[col["Test Name"]] or "").strip()
            if not name:
                continue
            dept = get_or_create_department(db, canon_dept(r[col["Department"]]), tenant_id)
            tube = get_or_create_tube(db, r[col["Sample"]], tenant_id, tube_cache)
            price = float(r[col["Test Price (₹)"]] or 0)
            mrp   = float(r[col["MRP (₹)"]] or 0)
            tat   = parse_tat_minutes(r[col["Average TAT"]])
            sample_type = (r[col["Sample"]] or "").strip() or None

            existing = (db.query(TestCatalog)
                          .filter(TestCatalog.tenant_id == tenant_id, TestCatalog.name == name)
                          .first())
            if existing:
                existing.price = price; existing.mrp = mrp
                existing.sample_type = sample_type
                existing.tat_target_minutes = tat
                if dept: existing.department_id = dept.id
                if tube: existing.sample_tube_id = tube.id
                updated += 1
            else:
                db.add(TestCatalog(
                    tenant_id=tenant_id, name=name, price=price, mrp=mrp,
                    sample_type=sample_type, tat_target_minutes=tat,
                    department_id=dept.id if dept else None,
                    sample_tube_id=tube.id if tube else None,
                ))
                created += 1
        db.commit()
        print(f"Done. created={created} updated={updated} "
              f"departments={db.query(Department).count()} tubes={db.query(SampleTube).count()}")
    except Exception as e:
        db.rollback(); print("ERROR:", e); raise
    finally:
        db.close()


if __name__ == "__main__":
    path = sys.argv[1] if len(sys.argv) > 1 else "export.xlsx"
    tid = int(sys.argv[2]) if len(sys.argv) > 2 else None
    run(path, tid)
