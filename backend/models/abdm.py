from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey, Boolean
from sqlalchemy.sql import func
from database import Base


class AbdmFacility(Base):
    """Maps one tenant (a lab business) to its ABDM HIP/facility identity.

    This is the multi-tenant pivot for the whole integration: the platform has
    ONE ABDM client id / bridge, and each tenant is told apart by its hip_id.
      - Outbound: resolve hip_id from the patient's tenant_id before any call.
      - Inbound:  resolve tenant from the X-HIP-ID header on every callback.
    """
    __tablename__ = "abdm_facilities"
    id          = Column(Integer, primary_key=True, index=True)
    tenant_id   = Column(Integer, ForeignKey("tenants.id"), nullable=False, unique=True, index=True)
    hip_id      = Column(String, nullable=False, unique=True, index=True)
    hip_name    = Column(String, nullable=False)
    cm_id       = Column(String, nullable=False, default="sbx")  # 'sbx' / 'abdm'
    active      = Column(Boolean, nullable=False, default=True)
    created_at  = Column(DateTime(timezone=True), server_default=func.now())
    updated_at  = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class AbdmLinkToken(Base):
    """v3 linking token captured at scan-and-share, keyed per (hip_id, abha)."""
    __tablename__ = "abdm_link_tokens"
    id           = Column(Integer, primary_key=True, index=True)
    tenant_id    = Column(Integer, ForeignKey("tenants.id"), nullable=True, index=True)
    hip_id       = Column(String, nullable=False, index=True)
    abha_address = Column(String, nullable=False, index=True)   # patient@sbx
    abha_number  = Column(String, nullable=True)
    link_token   = Column(Text, nullable=False)
    expires_at   = Column(DateTime(timezone=True), nullable=True)
    created_at   = Column(DateTime(timezone=True), server_default=func.now())


class AbdmOutbox(Base):
    """A job: 'a validated report needs to be linked to this patient's ABHA'."""
    __tablename__ = "abdm_outbox"
    id               = Column(Integer, primary_key=True, index=True)
    patient_id       = Column(Integer, ForeignKey("patients.id"))
    barcode          = Column(String, index=True)
    abha_number      = Column(String)
    trigger          = Column(String, default="validated")
    status           = Column(String, nullable=False, default="pending", index=True)
    attempts         = Column(Integer, nullable=False, default=0)
    last_error       = Column(Text)
    care_context_ref = Column(String)
    tenant_id        = Column(Integer, nullable=True)
    created_at       = Column(DateTime(timezone=True), server_default=func.now())
    updated_at       = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class AbdmLink(Base):
    """A care context that has been linked to an ABHA (so we can serve it on consent)."""
    __tablename__ = "abdm_links"
    id               = Column(Integer, primary_key=True, index=True)
    patient_id       = Column(Integer, ForeignKey("patients.id"))
    barcode          = Column(String, index=True)
    abha_number      = Column(String, index=True)
    care_context_ref = Column(String)
    hi_type          = Column(String, default="DiagnosticReport")
    linked_at        = Column(DateTime(timezone=True), server_default=func.now())
    tenant_id        = Column(Integer, nullable=True)
