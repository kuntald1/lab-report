"""Referral doctor commission ledger.

A DoctorCommission row is created once per BillItem, at the moment a
pathologist validates the report (status -> 'reported') for a patient who
was registered against a referral doctor. The amount is frozen at that
moment using the item's pre-discount price (BillItem.price) x the doctor's
commission_percent at that time, so later changes to either never alter a
row that has already been earned.

DoctorPayment is the audit record created when the lab admin pays out a
doctor for a date range; it marks the covered DoctorCommission rows paid.
"""
from sqlalchemy import Column, Integer, String, Float, DateTime, ForeignKey, Boolean
from sqlalchemy.sql import func
from database import Base


class DoctorCommission(Base):
    __tablename__ = "doctor_commissions"
    id                  = Column(Integer, primary_key=True, index=True)
    tenant_id           = Column(Integer, nullable=True, index=True)
    referral_doctor_id  = Column(Integer, ForeignKey("referral_doctors.id"), nullable=False, index=True)
    patient_id          = Column(Integer, ForeignKey("patients.id"), nullable=True, index=True)
    patient_name        = Column(String, nullable=True)
    barcode             = Column(String, nullable=True)
    bill_id             = Column(Integer, ForeignKey("bills.id"), nullable=True)
    bill_no             = Column(String, nullable=True)
    test_name           = Column(String, nullable=True)
    package_name        = Column(String, nullable=True)
    base_amount         = Column(Float, default=0.0)     # pre-discount item price the % was applied to
    commission_percent  = Column(Float, default=0.0)     # frozen at the moment of validation
    commission_amount   = Column(Float, default=0.0)
    is_paid             = Column(Boolean, default=False, index=True)
    paid_at             = Column(DateTime(timezone=True), nullable=True)
    payment_id          = Column(Integer, ForeignKey("doctor_payments.id"), nullable=True)
    validated_at        = Column(DateTime(timezone=True), nullable=True)
    created_at          = Column(DateTime(timezone=True), server_default=func.now())


class DoctorPayment(Base):
    """One payout event to a referral doctor, covering a date range."""
    __tablename__ = "doctor_payments"
    id                  = Column(Integer, primary_key=True, index=True)
    referral_doctor_id  = Column(Integer, ForeignKey("referral_doctors.id"), nullable=False, index=True)
    amount              = Column(Float, default=0.0)
    date_from           = Column(DateTime(timezone=True), nullable=True)
    date_to             = Column(DateTime(timezone=True), nullable=True)
    note                = Column(String, nullable=True)
    paid_by             = Column(Integer, nullable=True)   # user.id of the lab admin who paid
    created_at          = Column(DateTime(timezone=True), server_default=func.now())
