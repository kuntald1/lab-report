"""
Change Report Status — search samples PER TEST (by accession number) and
advance status (single or batch).

A patient can have several bill items (tests), each with its own accession
number and its own status — e.g. CBC already 'tested' while a Lipid Profile
drawn later is still 'collected'. Status therefore lives on BillItem, not on
Patient, so it can move independently per test/tube.

Search and advance are both scope-filtered (via the item's bill), so a
franchise can only see/change its own samples and a lab_admin the whole tenant.
"""
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session
from sqlalchemy import or_
from pydantic import BaseModel
from typing import Optional, List

from database import get_db
from models.org import User, Franchise
from models.models import Patient, LabResult
from models.billing import Bill, BillItem
from auth.deps import get_current_user, get_scope, apply_scope, Scope
from auth.audit import write_audit
from services.lifecycle import STATUS_ORDER
from services.whatsapp import send_whatsapp

router = APIRouter()

REJECTION_VALID = STATUS_ORDER + ["sample_rejected"]


@router.get("/search")
def search_samples(db: Session = Depends(get_db), scope: Scope = Depends(get_scope),
                   patient_id: Optional[str] = None, barcode: Optional[str] = None,
                   accession_number: Optional[str] = None,
                   branch_id: Optional[int] = None, franchise_id: Optional[int] = None,
                   status: Optional[str] = None, limit: int = 200):
    q = (db.query(BillItem, Bill, Patient)
           .join(Bill, Bill.id == BillItem.bill_id)
           .join(Patient, Patient.id == Bill.patient_id)
           .filter(BillItem.accession_number.isnot(None)))   # only test lines that actually have a sample label

    if scope.tenant_id is not None:
        q = q.filter(Bill.tenant_id == scope.tenant_id)
    if scope.role == "franchise" and scope.franchise_id is not None:
        q = q.filter(Bill.organization_id == scope.franchise_id)

    if patient_id:
        pid = patient_id.strip()
        if pid.isdigit():
            q = q.filter(Patient.id == int(pid))
        else:
            q = q.filter(or_(Patient.barcode.ilike(f"%{pid}%"),
                             Patient.patient_name.ilike(f"%{pid}%")))
    if barcode:
        q = q.filter(Patient.barcode.ilike(f"%{barcode}%"))
    if accession_number:
        q = q.filter(BillItem.accession_number.ilike(f"%{accession_number}%"))
    if branch_id is not None:
        q = q.filter(Patient.branch_id == branch_id)
    if franchise_id is not None:
        q = q.filter(Patient.registered_franchise_id == franchise_id)
    if status:
        q = q.filter(BillItem.status == status)

    rows = q.order_by(BillItem.id.desc()).limit(min(limit, 500)).all()

    # which accession numbers already have an analyser result
    accs = [it.accession_number for it, b, p in rows if it.accession_number]
    have = set()
    if accs:
        for (a,) in db.query(LabResult.accession_number).filter(LabResult.accession_number.in_(accs)).all():
            if a:
                have.add(a)

    return [{
        "id": it.id,                          # bill_item id — what advance/select operates on
        "bill_id": b.id, "bill_no": b.bill_no,
        "patient_id": p.id, "patient_name": p.patient_name, "barcode": p.barcode,
        "test_name": it.package_name or it.test_name,
        "accession_number": it.accession_number,
        "status": it.status or "collected",
        "branch_id": p.branch_id, "franchise_id": p.registered_franchise_id,
        "has_result": it.accession_number in have,
        "created_at": it.created_at,
    } for it, b, p in rows]


class AdvanceIn(BaseModel):
    item_ids: List[int]
    status: str   # received | tested | validated | reported | sample_rejected


@router.post("/advance")
def advance_status(p: AdvanceIn, request: Request,
                   db: Session = Depends(get_db), user: User = Depends(get_current_user),
                   scope: Scope = Depends(get_scope)):
    if user.role == "patient":
        raise HTTPException(status_code=403, detail="patients cannot change status")
    if p.status not in REJECTION_VALID:
        raise HTTPException(status_code=400, detail=f"status must be one of {REJECTION_VALID}")
    if not p.item_ids:
        raise HTTPException(status_code=400, detail="no samples selected")

    q = (db.query(BillItem, Bill, Patient)
           .join(Bill, Bill.id == BillItem.bill_id)
           .join(Patient, Patient.id == Bill.patient_id)
           .filter(BillItem.id.in_(p.item_ids)))
    if scope.tenant_id is not None:
        q = q.filter(Bill.tenant_id == scope.tenant_id)
    if scope.role == "franchise" and scope.franchise_id is not None:
        q = q.filter(Bill.organization_id == scope.franchise_id)
    rows = q.all()
    if not rows:
        raise HTTPException(status_code=404, detail="no matching samples in your scope")

    for it, b, patient in rows:
        it.status = p.status
    db.commit()

    # When a sample is rejected -> WhatsApp the franchise (if patient belongs to one)
    if p.status == "sample_rejected":
        notified = set()
        for it, b, patient in rows:
            if patient.registered_franchise_id and patient.registered_franchise_id not in notified:
                franchise = db.query(Franchise).filter(Franchise.id == patient.registered_franchise_id).first()
                if franchise and franchise.phone:
                    msg = (f"⚠ Sample Rejected — {patient.patient_name} "
                           f"(Accession: {it.accession_number}). "
                           f"Please collect a fresh sample and resubmit. Contact the lab for details.")
                    try:
                        send_whatsapp(franchise.phone, msg)
                        notified.add(patient.registered_franchise_id)
                    except Exception:
                        pass   # don't fail the status change if WhatsApp errors

    write_audit(db, action="status_change", user=user, entity="bill_item",
                entity_id=",".join(str(it.id) for it, b, p in rows),
                after={"status": p.status, "count": len(rows)},
                ip=request.client.host if request.client else None)
    return {"updated": len(rows), "status": p.status, "ids": [it.id for it, b, p in rows]}


class ScanIn(BaseModel):
    code: str   # whatever the scanner fired — either a specific accession number, or the patient's plain barcode


@router.post("/scan")
def scan_receive(p: ScanIn, request: Request,
                 db: Session = Depends(get_db), user: User = Depends(get_current_user),
                 scope: Scope = Depends(get_scope)):
    """Scan-mode receiving: scanning a code moves it collected -> received, and
    ONLY collected -> received — any other current status is left untouched
    (reported back, not silently changed). Matches a specific accession number
    first; if nothing matches, falls back to the patient's plain barcode and
    receives every 'collected' test on that patient in one scan."""
    if user.role == "patient":
        raise HTTPException(status_code=403, detail="patients cannot change status")
    code = (p.code or "").strip()
    if not code:
        raise HTTPException(status_code=400, detail="no code scanned")

    base_q = (db.query(BillItem, Bill, Patient)
                .join(Bill, Bill.id == BillItem.bill_id)
                .join(Patient, Patient.id == Bill.patient_id))
    if scope.tenant_id is not None:
        base_q = base_q.filter(Bill.tenant_id == scope.tenant_id)
    if scope.role == "franchise" and scope.franchise_id is not None:
        base_q = base_q.filter(Bill.organization_id == scope.franchise_id)

    matched_by = None
    rows = base_q.filter(BillItem.accession_number == code).all()
    if rows:
        matched_by = "accession"
    else:
        rows = base_q.filter(Patient.barcode == code, BillItem.accession_number.isnot(None)).all()
        if rows:
            matched_by = "barcode"

    if not rows:
        raise HTTPException(status_code=404, detail=f"No sample found for '{code}'")

    updated, skipped = [], []
    for it, b, patient in rows:
        cur = it.status or "collected"
        line = {"id": it.id, "accession_number": it.accession_number,
                "test_name": it.package_name or it.test_name, "patient_name": patient.patient_name}
        if cur == "collected":
            it.status = "received"
            updated.append({**line, "prev_status": cur, "new_status": "received"})
        else:
            skipped.append({**line, "status": cur})
    db.commit()

    if updated:
        write_audit(db, action="status_change", user=user, entity="bill_item",
                    entity_id=",".join(str(u["id"]) for u in updated),
                    after={"status": "received", "count": len(updated), "via": "scan"},
                    ip=request.client.host if request.client else None)

    return {"matched_by": matched_by, "code": code, "updated": updated, "skipped": skipped}
