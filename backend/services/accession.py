"""
Analyser-ingestion -> accession number resolver.

Historically the ASTM/HL7 O-record "Sample ID" field was read as the plain
patient barcode (Patient.barcode). Now that billing prints a per-item
accession number (patient barcode + suffix, e.g. HC21889B) on the tube label,
staff may scan *either* value into the analyser. This resolves both cases and
tells the caller which accession_number (if any) to stamp onto the LabResult
row, so results.lab_results.accession_number gets populated automatically
during real ingestion.

Deliberately defensive: any failure here should never break result ingestion,
so callers should catch exceptions around this.
"""
from models.models import Patient
from models.billing import Bill, BillItem


def resolve_patient_and_accession(db, scanned_code: str, test_name: str = None):
    """Returns (patient_or_None, accession_number_or_None) for a scanned code."""
    if not scanned_code or scanned_code == "UNKNOWN":
        return None, None

    # Case 1: the plain patient barcode was scanned (existing/legacy behaviour).
    patient = db.query(Patient).filter(Patient.barcode == scanned_code).first()
    if patient:
        accession = _best_match_accession(db, patient.id, test_name)
        return patient, accession

    # Case 2: a specific accession number (patient barcode + suffix) was scanned.
    item = (db.query(BillItem)
              .filter(BillItem.accession_number == scanned_code)
              .order_by(BillItem.id.desc()).first())
    if item:
        bill = db.query(Bill).filter(Bill.id == item.bill_id).first()
        if bill and bill.patient_id:
            patient = db.query(Patient).filter(Patient.id == bill.patient_id).first()
            return patient, scanned_code

    return None, None


def _best_match_accession(db, patient_id: int, test_name: str = None):
    """Best-effort: pick the accession number of the patient's most recent
    bill item whose test_name is contained in (or contains) the result's
    test_name. Falls back to the most recent item with any accession number.
    Returns None if the patient has no billed items with an accession number yet."""
    items = (db.query(BillItem)
               .join(Bill, Bill.id == BillItem.bill_id)
               .filter(Bill.patient_id == patient_id, BillItem.accession_number.isnot(None))
               .order_by(BillItem.id.desc()).all())
    if not items:
        return None
    if test_name:
        tn = test_name.lower()
        for it in items:
            if it.test_name and (it.test_name.lower() in tn or tn in it.test_name.lower()):
                return it.accession_number
    return items[0].accession_number   # fallback: most recent billed item
