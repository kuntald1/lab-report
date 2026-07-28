"""
Phase 2 — clinical workflow models.

Adds the order/sample lifecycle on top of the Phase 1 foundation. The
analyser-ingestion core (patients / devices / lab_results) is untouched; these
tables sit alongside it and reuse the same tenant/branch/franchise scoping.

The centrepiece for TAT is `sample_events`: an append-only log of one row per
state transition of a sample. Stage durations are the gaps between consecutive
events, so the entire turnaround-time breakdown is derived, never stored.
"""
from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey, Float, Text
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from database import Base


# --------------------------------------------------------------------------- enums
class OrderStatus:
    CREATED   = "created"
    COLLECTED = "collected"
    RECEIVED  = "received"
    TESTING   = "testing"
    RESULTED  = "resulted"
    VALIDATED = "validated"
    REPORTED  = "reported"
    CANCELLED = "cancelled"


class Priority:
    ROUTINE = "routine"
    STAT    = "stat"


class EventType:
    """The timestamps that define the sample lifecycle."""
    COLLECTED    = "collected"      # sample drawn (clock start)
    DISPATCHED   = "dispatched"     # handed to transport (kept for legacy data)
    RECEIVED     = "received"       # scanned in at the lab
    REJECTED     = "sample_rejected"  # sample rejected / unusable
    TEST_STARTED = "test_started"   # loaded on analyser / run begins
    RESULTED     = "resulted"       # analyser produced the result
    VALIDATED    = "validated"      # pathologist signed off
    REPORTED     = "reported"       # report released
    OUTSOURCED   = "outsourced"     # sent to an external/reference lab instead of tested in-house


EVENT_SEQUENCE = [
    EventType.COLLECTED, EventType.DISPATCHED, EventType.RECEIVED,
    EventType.TEST_STARTED, EventType.RESULTED, EventType.VALIDATED, EventType.REPORTED,
]


# --------------------------------------------------------------------------- catalog
class Department(Base):
    __tablename__ = "departments"
    id         = Column(Integer, primary_key=True, index=True)
    tenant_id  = Column(Integer, ForeignKey("tenants.id"), nullable=True, index=True)
    name       = Column(String, nullable=False)        # Biochemistry, Haematology, ...
    code       = Column(String, nullable=True)
    is_active  = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class TestCatalog(Base):
    __tablename__ = "test_catalog"
    id            = Column(Integer, primary_key=True, index=True)
    tenant_id     = Column(Integer, ForeignKey("tenants.id"),     nullable=True, index=True)
    department_id = Column(Integer, ForeignKey("departments.id"), nullable=True, index=True)
    code          = Column(String, nullable=True, index=True)
    name          = Column(String, nullable=False)
    unit          = Column(String, nullable=True)
    method        = Column(String, nullable=True)
    sample_type   = Column(String, nullable=True)      # Blood, Serum, Urine, ...
    price         = Column(Float, default=0.0)
    # --- B2B: rich catalog fields ---
    mrp                = Column(Float, default=0.0)
    normal_value       = Column(String, nullable=True)   # free-text reference / normal value
    sample_tube_id     = Column(Integer, ForeignKey("sample_tubes.id"), nullable=True)
    assigned_doctor_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    # target analytical time in minutes — used for TAT SLA comparison
    tat_target_minutes = Column(Integer, nullable=True)
    disclaimer     = Column(Text, nullable=True)   # printed below this test's results on the report
    interpretation = Column(Text, nullable=True)   # printed below this test's results on the report
    is_active     = Column(Boolean, default=True)
    created_at    = Column(DateTime(timezone=True), server_default=func.now())


class Package(Base):
    """A profile / panel: a named bundle of tests at a bundled price."""
    __tablename__ = "packages"
    id         = Column(Integer, primary_key=True, index=True)
    tenant_id  = Column(Integer, ForeignKey("tenants.id"), nullable=True, index=True)
    name       = Column(String, nullable=False)
    code       = Column(String, nullable=True)
    price      = Column(Float, default=0.0)
    is_active  = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    items = relationship("PackageTest", back_populates="package")


class PackageTest(Base):
    __tablename__ = "package_tests"
    id         = Column(Integer, primary_key=True, index=True)
    package_id = Column(Integer, ForeignKey("packages.id"),     nullable=False, index=True)
    test_id    = Column(Integer, ForeignKey("test_catalog.id"), nullable=False, index=True)

    package = relationship("Package", back_populates="items")


class ReferenceRange(Base):
    __tablename__ = "reference_ranges"
    id        = Column(Integer, primary_key=True, index=True)
    test_id   = Column(Integer, ForeignKey("test_catalog.id"), nullable=False, index=True)
    sex       = Column(String, default="A")    # 'M', 'F', 'A' (any)
    age_min   = Column(Integer, nullable=True)  # years
    age_max   = Column(Integer, nullable=True)
    low       = Column(Float, nullable=True)
    high      = Column(Float, nullable=True)
    critical_low  = Column(Float, nullable=True)   # below this = critical alert
    critical_high = Column(Float, nullable=True)   # above this = critical alert
    unit      = Column(String, nullable=True)
    text      = Column(String, nullable=True)   # qualitative ranges ("Negative")


# --------------------------------------------------------------------------- orders
class Order(Base):
    """A requisition for a patient: one sample (barcode) carrying ordered tests."""
    __tablename__ = "orders"
    id            = Column(Integer, primary_key=True, index=True)
    tenant_id     = Column(Integer, ForeignKey("tenants.id"),    nullable=True, index=True)
    branch_id     = Column(Integer, ForeignKey("branches.id"),   nullable=True, index=True)
    franchise_id  = Column(Integer, ForeignKey("franchises.id"), nullable=True, index=True)
    patient_id    = Column(Integer, ForeignKey("patients.id"),   nullable=True, index=True)
    order_no      = Column(String, nullable=True, index=True)
    barcode       = Column(String, nullable=True, index=True)   # ties to the sample / lab_results
    referring_doctor = Column(String, nullable=True)
    priority      = Column(String, default=Priority.ROUTINE)
    status        = Column(String, default=OrderStatus.CREATED, index=True)
    total_amount  = Column(Float, default=0.0)
    created_at    = Column(DateTime(timezone=True), server_default=func.now())

    items  = relationship("OrderItem",   back_populates="order")
    events = relationship("SampleEvent", back_populates="order")


class OrderItem(Base):
    __tablename__ = "order_items"
    id           = Column(Integer, primary_key=True, index=True)
    order_id     = Column(Integer, ForeignKey("orders.id"),       nullable=False, index=True)
    test_id      = Column(Integer, ForeignKey("test_catalog.id"), nullable=True)
    test_name    = Column(String, nullable=False)
    price        = Column(Float, default=0.0)
    status       = Column(String, default="pending")   # pending / resulted / validated
    result_value = Column(String, nullable=True)
    result_unit  = Column(String, nullable=True)
    flag         = Column(String, nullable=True)        # normal / high / low / critical
    validated_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    validated_at = Column(DateTime(timezone=True), nullable=True)

    order = relationship("Order", back_populates="items")


class SampleEvent(Base):
    """Append-only timestamp log driving the TAT breakdown. Never update/delete."""
    __tablename__ = "sample_events"
    id           = Column(Integer, primary_key=True, index=True)
    tenant_id    = Column(Integer, ForeignKey("tenants.id"),    nullable=True, index=True)
    branch_id    = Column(Integer, ForeignKey("branches.id"),   nullable=True, index=True)
    franchise_id = Column(Integer, ForeignKey("franchises.id"), nullable=True, index=True)
    order_id     = Column(Integer, ForeignKey("orders.id"),     nullable=True, index=True)
    patient_id   = Column(Integer, ForeignKey("patients.id"),   nullable=True, index=True)
    barcode      = Column(String, nullable=True, index=True)
    event_type   = Column(String, nullable=False, index=True)   # see EventType
    event_at     = Column(DateTime(timezone=True), nullable=False)
    actor_id     = Column(Integer, ForeignKey("users.id"), nullable=True)
    note         = Column(Text, nullable=True)
    created_at   = Column(DateTime(timezone=True), server_default=func.now())

    order = relationship("Order", back_populates="events")


class ResultAmendment(Base):
    """Append-only history of changes to a validated result (medico-legal)."""
    __tablename__ = "result_amendments"
    id            = Column(Integer, primary_key=True, index=True)
    tenant_id     = Column(Integer, ForeignKey("tenants.id"),     nullable=True, index=True)
    order_id      = Column(Integer, ForeignKey("orders.id"),      nullable=True, index=True)
    order_item_id = Column(Integer, ForeignKey("order_items.id"), nullable=False, index=True)
    old_value     = Column(String, nullable=True)
    new_value     = Column(String, nullable=True)
    old_flag      = Column(String, nullable=True)
    new_flag      = Column(String, nullable=True)
    reason        = Column(Text, nullable=False)
    amended_by    = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at    = Column(DateTime(timezone=True), server_default=func.now())
