"""Filters shared by the Results list and the "Download Zip" of report PDFs, so
both always pick exactly the same results for the same filter bar."""
from sqlalchemy import or_

from models.models import LabResult, Patient
from models.billing import BillItem

# the stages the filter bar offers (same list as Sample / Test Details)
STAGES = ("dispatched", "received", "tested", "validated", "reported")


def stage_accessions(db, stage: str):
    """Accession numbers that have a test at this stage."""
    return [a for (a,) in db.query(BillItem.accession_number)
                           .filter(BillItem.status == stage,
                                   BillItem.accession_number.isnot(None)).distinct().all()]


def test_scope(db, test_id=None, package_id=None):
    """Which bills, patients and accessions carry this test (or this group).

    A group (package) is matched by package_id, which every line of the group
    carries, so "THYROID PROFILE" finds the three member lines rather than the
    one package line. Returns (bill_ids, patient_ids, accessions); all three are
    empty lists when nothing is asked for, and the caller skips filtering then.
    """
    if not test_id and not package_id:
        return [], [], []
    from models.billing import Bill
    q = db.query(BillItem.bill_id, BillItem.accession_number)
    if test_id:
        q = q.filter(BillItem.test_id == test_id)
    if package_id:
        q = q.filter(BillItem.package_id == package_id)
    rows = q.all()
    bill_ids = sorted({b for (b, _a) in rows if b})
    accs = sorted({a for (_b, a) in rows if a})
    pids = [p for (p,) in db.query(Bill.patient_id)
                            .filter(Bill.id.in_(bill_ids or [-1])).distinct().all() if p]
    return bill_ids, pids, accs


def filter_results_by_test(q, db, test_id=None, package_id=None):
    """Results belonging to that test. Matched by accession number — the tube
    the test was drawn into — so a patient billed for CBC and LFT shows only the
    one result when filtering by CBC. A result that carries no accession at all
    can only be placed by its patient, so it is matched that way."""
    if not test_id and not package_id:
        return q
    _bills, pids, accs = test_scope(db, test_id, package_id)
    return q.filter(or_(LabResult.accession_number.in_(accs or ["\x00"]),
                        (LabResult.accession_number.is_(None)
                         & LabResult.patient_id.in_(pids or [-1]))))


def filter_results(q, db, organization_id=None, branch_id=None,
                   date_from=None, date_to=None, stage=None):
    """Narrow a LabResult query.

    stage: a result matches when its own test (by accession number) is at that
    stage, or when the patient's overall status is — the patient status alone
    can lag behind (e.g. a result that arrived by accession number), and
    'dispatched' only exists at patient level."""
    if organization_id:
        pids = [p for (p,) in db.query(Patient.id).filter(
            or_(Patient.organization_id == organization_id,
                Patient.registered_franchise_id == organization_id)).all()]
        q = q.filter(LabResult.patient_id.in_(pids or [-1]))
    if branch_id:
        pids = [p for (p,) in db.query(Patient.id).filter(Patient.branch_id == branch_id).all()]
        q = q.filter(or_(LabResult.branch_id == branch_id, LabResult.patient_id.in_(pids or [-1])))
    if date_from:
        q = q.filter(LabResult.created_at >= date_from)
    if date_to:
        q = q.filter(LabResult.created_at <= date_to + " 23:59:59")
    if stage:
        pids = [p for (p,) in db.query(Patient.id).filter(Patient.status == stage).all()]
        accs = stage_accessions(db, stage)
        q = q.filter(or_(LabResult.patient_id.in_(pids or [-1]),
                         LabResult.accession_number.in_(accs or ["\x00"])))
    return q


def filter_patients(pq, organization_id=None, branch_id=None, date_from=None, date_to=None, stage=None):
    """The same filters for the bare-patient ("Manual Report") rows."""
    if organization_id:
        pq = pq.filter(or_(Patient.organization_id == organization_id,
                           Patient.registered_franchise_id == organization_id))
    if branch_id:
        pq = pq.filter(Patient.branch_id == branch_id)
    if date_from:
        pq = pq.filter(Patient.created_at >= date_from)
    if date_to:
        pq = pq.filter(Patient.created_at <= date_to + " 23:59:59")
    if stage:
        pq = pq.filter(Patient.status == stage)
    return pq
