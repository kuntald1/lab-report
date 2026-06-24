"""
B2B models — organization groups, sample tubes, per-context price copies, ledger.

These complement the EXISTING models you already have:
  - test_catalog (TestCatalog)  -> extended with mrp, normal_value, sample_tube_id, assigned_doctor_id
  - packages / package_tests    -> these are your "Test Groups" (no new table needed)
  - franchises (Franchise)      -> extended to act as "organizations"
The columns added to those existing tables are applied via the Phase-1 SQL
migration (create_all never ALTERs). Add the new ORM fields to those classes too
(snippets provided separately) so SQLAlchemy can read them.
"""
from sqlalchemy import Column, Integer, String, Float, Boolean, DateTime, ForeignKey, UniqueConstraint
from sqlalchemy.sql import func
from database import Base


class OrgGroup(Base):
    """B2B / Rural / Golden ... a named group. An organization belongs to one or none."""
    __tablename__ = "org_groups"
    id         = Column(Integer, primary_key=True, index=True)
    tenant_id  = Column(Integer, nullable=True, index=True)
    name       = Column(String, nullable=False)
    is_active  = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class SampleTube(Base):
    """Master of collection tubes with their colour."""
    __tablename__ = "sample_tubes"
    id         = Column(Integer, primary_key=True, index=True)
    tenant_id  = Column(Integer, nullable=True, index=True)
    name       = Column(String, nullable=False)   # EDTA, Sodium Citrate, ...
    color      = Column(String, nullable=True)    # Lavender, Blue, ...
    is_active  = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class OrgGroupTest(Base):
    """A test included in a group, with the group's OWN mrp + price (frozen copy)."""
    __tablename__ = "org_group_tests"
    id           = Column(Integer, primary_key=True, index=True)
    org_group_id = Column(Integer, ForeignKey("org_groups.id"), nullable=False, index=True)
    test_id      = Column(Integer, ForeignKey("test_catalog.id"), nullable=False, index=True)
    mrp          = Column(Float, default=0.0)
    price        = Column(Float, default=0.0)
    created_at   = Column(DateTime(timezone=True), server_default=func.now())
    __table_args__ = (UniqueConstraint("org_group_id", "test_id", name="uq_group_test"),)


class OrgTest(Base):
    """A test included for a standalone organization, with its OWN mrp + price."""
    __tablename__ = "org_tests"
    id              = Column(Integer, primary_key=True, index=True)
    organization_id = Column(Integer, ForeignKey("franchises.id"), nullable=False, index=True)
    test_id         = Column(Integer, ForeignKey("test_catalog.id"), nullable=False, index=True)
    mrp             = Column(Float, default=0.0)
    price           = Column(Float, default=0.0)
    created_at      = Column(DateTime(timezone=True), server_default=func.now())
    __table_args__ = (UniqueConstraint("organization_id", "test_id", name="uq_org_test"),)


class OrgLedger(Base):
    """Running statement per organization: bills add, payments subtract."""
    __tablename__ = "org_ledger"
    id              = Column(Integer, primary_key=True, index=True)
    organization_id = Column(Integer, ForeignKey("franchises.id"), nullable=False, index=True)
    entry_type      = Column(String, nullable=False)   # bill | payment | adjustment
    amount          = Column(Float, nullable=False)
    balance_after   = Column(Float, nullable=True)
    ref             = Column(String, nullable=True)
    created_at      = Column(DateTime(timezone=True), server_default=func.now())
