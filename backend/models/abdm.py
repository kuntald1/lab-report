from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey
from sqlalchemy.sql import func
from database import Base


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