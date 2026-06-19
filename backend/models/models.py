from sqlalchemy import Column, Integer, String, Float, DateTime, ForeignKey, JSON, Boolean, Text
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from database import Base

class Device(Base):
    __tablename__ = "devices"
    id            = Column(Integer, primary_key=True, index=True)
    name          = Column(String, nullable=False)
    device_type   = Column(String, nullable=False)
    ip_address    = Column(String)
    port          = Column(Integer)
    parser        = Column(String)
    protocol      = Column(String, default="ASTM")
    bidirectional = Column(Boolean, default=True)
    is_client     = Column(Boolean, default=False)   # false = MediCloud connects TO machine (this lab)
    is_online     = Column(Boolean, default=False)   # live connection status
    # --- Phase 1: multi-tenant scoping (nullable; ingestion path untouched) ---
    tenant_id     = Column(Integer, ForeignKey("tenants.id"),  nullable=True, index=True)
    branch_id     = Column(Integer, ForeignKey("branches.id"), nullable=True, index=True)
    created_at    = Column(DateTime(timezone=True), server_default=func.now())
    results       = relationship("LabResult", back_populates="device")

class Patient(Base):
    __tablename__ = "patients"
    id           = Column(Integer, primary_key=True, index=True)
    barcode      = Column(String, unique=True, index=True, nullable=False)
    patient_name = Column(String, nullable=False)
    age          = Column(Integer)
    gender       = Column(String)
    doctor_name  = Column(String)
    sample_type  = Column(String, default="Blood")
    # --- Phase 1: multi-tenant scoping (nullable; ingestion path untouched) ---
    tenant_id              = Column(Integer, ForeignKey("tenants.id"),    nullable=True, index=True)
    branch_id              = Column(Integer, ForeignKey("branches.id"),   nullable=True, index=True)
    registered_franchise_id = Column(Integer, ForeignKey("franchises.id"), nullable=True, index=True)
    status                 = Column(String, nullable=True, index=True)  # collected→…→reported
    created_at   = Column(DateTime(timezone=True), server_default=func.now())
    results      = relationship("LabResult", back_populates="patient")

class LabResult(Base):
    __tablename__ = "lab_results"
    id          = Column(Integer, primary_key=True, index=True)
    patient_id  = Column(Integer, ForeignKey("patients.id"))
    device_id   = Column(Integer, ForeignKey("devices.id"))
    barcode     = Column(String, index=True)
    test_name   = Column(String)
    raw_data    = Column(Text)
    parsed_data = Column(JSON)
    status      = Column(String, default="pending")
    # --- Phase 1: multi-tenant scoping (nullable; ingestion path untouched) ---
    tenant_id   = Column(Integer, ForeignKey("tenants.id"),  nullable=True, index=True)
    branch_id   = Column(Integer, ForeignKey("branches.id"), nullable=True, index=True)
    created_at  = Column(DateTime(timezone=True), server_default=func.now())
    patient     = relationship("Patient", back_populates="results")
    device      = relationship("Device",  back_populates="results")
