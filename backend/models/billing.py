"""Phase 3 billing models — bills, bill_items, payments.

Pricing is resolved at billing time via services.pricing.resolve_price
(group -> org -> base) and FROZEN onto bill_items, so later catalog/price
changes never alter an issued bill. org_ledger (Phase 1) records the running
B2B outstanding for credit gating.
"""
from sqlalchemy import Column, Integer, String, Float, DateTime, ForeignKey
from sqlalchemy.sql import func
from database import Base


class Bill(Base):
    __tablename__ = "bills"
    id              = Column(Integer, primary_key=True, index=True)
    tenant_id       = Column(Integer, nullable=True, index=True)
    branch_id       = Column(Integer, nullable=True, index=True)
    patient_id      = Column(Integer, ForeignKey("patients.id"), nullable=True, index=True)
    organization_id = Column(Integer, ForeignKey("franchises.id"), nullable=True, index=True)
    bill_no         = Column(String, nullable=True)
    subtotal        = Column(Float, default=0.0)
    discount_type   = Column(String, nullable=True)    # flat | percent
    discount_value  = Column(Float, default=0.0)
    discount_amount = Column(Float, default=0.0)
    total           = Column(Float, default=0.0)
    paid            = Column(Float, default=0.0)
    status          = Column(String, default="unpaid")  # unpaid|partial|paid|credit
    created_by      = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at      = Column(DateTime(timezone=True), server_default=func.now())


class BillItem(Base):
    __tablename__ = "bill_items"
    id           = Column(Integer, primary_key=True, index=True)
    bill_id      = Column(Integer, ForeignKey("bills.id"), nullable=False, index=True)
    test_id      = Column(Integer, ForeignKey("test_catalog.id"), nullable=True)
    test_name    = Column(String, nullable=False)
    mrp          = Column(Float, default=0.0)
    price        = Column(Float, default=0.0)
    price_source = Column(String, nullable=True)   # group|org|base|group_panel
    package_id   = Column(Integer, nullable=True)  # set when this line belongs to a test group
    package_name = Column(String, nullable=True)
    created_at   = Column(DateTime(timezone=True), server_default=func.now())


class Payment(Base):
    __tablename__ = "payments"
    id             = Column(Integer, primary_key=True, index=True)
    tenant_id      = Column(Integer, nullable=True, index=True)
    bill_id        = Column(Integer, ForeignKey("bills.id"), nullable=False, index=True)
    method         = Column(String, nullable=False)   # cash|upi|razorpay|credit
    amount         = Column(Float, nullable=False)
    status         = Column(String, default="success")  # success|pending|failed
    rzp_order_id   = Column(String, nullable=True)
    rzp_payment_id = Column(String, nullable=True)
    note           = Column(String, nullable=True)
    created_by     = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at     = Column(DateTime(timezone=True), server_default=func.now())
