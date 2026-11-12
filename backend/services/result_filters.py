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
