"""Phase 3 — payment transactions ledger + messaging settings."""
from sqlalchemy import Column, Integer, String, Float, Boolean, DateTime, ForeignKey
from sqlalchemy.sql import func
from database import Base


class PaymentTransaction(Base):
    """Gateway interaction audit: razorpay checkout + payment links + failures."""
    __tablename__ = "payment_transactions"
    id                  = Column(Integer, primary_key=True, index=True)
    tenant_id           = Column(Integer, nullable=True, index=True)
    bill_id             = Column(Integer, ForeignKey("bills.id"), nullable=True, index=True)
    bill_no             = Column(String, nullable=True, index=True)
    kind                = Column(String, nullable=False)    # checkout | payment_link
    amount              = Column(Float, nullable=False)
    currency            = Column(String, default="INR")
    method              = Column(String, nullable=True)
    status              = Column(String, nullable=False)    # created|success|failed|timeout|cancelled
    razorpay_order_id   = Column(String, nullable=True)
    razorpay_payment_id = Column(String, nullable=True)
    razorpay_link_id    = Column(String, nullable=True)
    razorpay_signature  = Column(String, nullable=True)
    error_code          = Column(String, nullable=True)
    error_description   = Column(String, nullable=True)
    created_by          = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at          = Column(DateTime(timezone=True), server_default=func.now())
    updated_at          = Column(DateTime(timezone=True), server_default=func.now())


class MessagingSettings(Base):
    __tablename__ = "messaging_settings"
    id               = Column(Integer, primary_key=True, index=True)
    tenant_id        = Column(Integer, unique=True, nullable=True, index=True)
    provider         = Column(String, default="twilio")
    account_sid      = Column(String, nullable=True)
    auth_token       = Column(String, nullable=True)
    from_number      = Column(String, nullable=True)
    whatsapp_enabled = Column(Boolean, default=True)
    template_bill    = Column(String, nullable=True)
    created_at       = Column(DateTime(timezone=True), server_default=func.now())
    updated_at       = Column(DateTime(timezone=True), server_default=func.now())
