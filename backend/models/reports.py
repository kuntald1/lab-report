"""Phase 3 — report workflow: history requests (Need More History trail)."""
from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey, JSON
from sqlalchemy.sql import func
from database import Base


class HistoryRequest(Base):
    __tablename__ = "history_requests"
    __table_args__ = {"extend_existing": True}
    id               = Column(Integer, primary_key=True, index=True)
    tenant_id        = Column(Integer, nullable=True, index=True)
    patient_id       = Column(Integer, ForeignKey("patients.id"), nullable=False, index=True)
    requested_by     = Column(Integer, ForeignKey("users.id"), nullable=True)   # doctor who asked
    doctor_id        = Column(Integer, ForeignKey("users.id"), nullable=True)   # assigned doctor to notify
    checklist        = Column(JSON, nullable=True)
    note             = Column(Text, nullable=True)
    status           = Column(String, default="open", index=True)   # open | answered
    answer           = Column(Text, nullable=True)
    answer_checklist = Column(JSON, nullable=True)
    answered_by      = Column(Integer, ForeignKey("users.id"), nullable=True)
    answered_at      = Column(DateTime(timezone=True), nullable=True)
    created_at       = Column(DateTime(timezone=True), server_default=func.now())
