"""
Phase 1 — organisation, identity and audit models.

These tables add multi-tenancy, a role hierarchy and an append-only audit
trail on top of the existing analyser-ingestion core (patients / devices /
lab_results). Nothing here touches the ingestion path; the scoping columns
added to the core tables are all nullable.

Role hierarchy
--------------
    super_admin   platform owner (MediCloud) — sees every tenant
      └ lab_admin   owner/admin of one lab (one tenant)
          ├ pathologist   validates + signs results
          ├ technician    enters results
          ├ receptionist  registration, billing
          └ phlebotomist  home collection
      ├ franchise   partner — scoped to its own franchise within a tenant
      └ patient     end user — scoped to its own records
"""
from sqlalchemy import Float, Column, Integer, String, Boolean, DateTime, ForeignKey, JSON, Text
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from database import Base


# ---------------------------------------------------------------------------
# Roles — kept as plain strings (no DB enum) so adding a role never needs a
# schema migration. Validate against ROLES at the application layer.
# ---------------------------------------------------------------------------
class Role:
    SUPER_ADMIN  = "super_admin"
    LAB_ADMIN    = "lab_admin"
    PATHOLOGIST  = "pathologist"
    TECHNICIAN   = "technician"
    RECEPTIONIST = "receptionist"
    PHLEBOTOMIST = "phlebotomist"
    FRANCHISE    = "franchise"
    PATIENT      = "patient"


ROLES = {
    Role.SUPER_ADMIN, Role.LAB_ADMIN, Role.PATHOLOGIST, Role.TECHNICIAN,
    Role.RECEPTIONIST, Role.PHLEBOTOMIST, Role.FRANCHISE, Role.PATIENT,
}

# Roles whose visibility is the whole tenant (every branch + franchise).
TENANT_WIDE_ROLES = {Role.LAB_ADMIN}

# Roles scoped to a single branch they belong to.
BRANCH_SCOPED_ROLES = {Role.PATHOLOGIST, Role.TECHNICIAN, Role.RECEPTIONIST, Role.PHLEBOTOMIST}


class Tenant(Base):
    """One lab business (the SaaS tenant). Super Admin sits above all tenants."""
    __tablename__ = "tenants"
    id          = Column(Integer, primary_key=True, index=True)
    name        = Column(String, nullable=False)
    slug        = Column(String, unique=True, index=True, nullable=False)
    # India compliance fields kept on the tenant, not hard-coded in billing.
    gst_exempt  = Column(Boolean, default=True)   # diagnostic services are GST-exempt by default
    is_active   = Column(Boolean, default=True)
    created_at  = Column(DateTime(timezone=True), server_default=func.now())
    # Configurable letterhead / signature / layout settings for the official
    # sample report PDF (routers/pdf.py). Single JSON blob so new fields never
    # need a migration. See services/report_settings.py for the shape + defaults.
    report_settings = Column(JSON, nullable=True)

    branches    = relationship("Branch",    back_populates="tenant")
    franchises  = relationship("Franchise", back_populates="tenant")
    users       = relationship("User",      back_populates="tenant")


class Branch(Base):
    """A lab-owned location inside a tenant (same legal entity)."""
    __tablename__ = "branches"
    id          = Column(Integer, primary_key=True, index=True)
    tenant_id   = Column(Integer, ForeignKey("tenants.id"), nullable=False, index=True)
    name        = Column(String, nullable=False)
    code        = Column(String, nullable=True)
    address     = Column(String, nullable=True)
    is_main     = Column(Boolean, default=False)
    is_active   = Column(Boolean, default=True)
    created_at  = Column(DateTime(timezone=True), server_default=func.now())

    tenant      = relationship("Tenant", back_populates="branches")


class Franchise(Base):
    """A partner collection centre inside a tenant (separate revenue split)."""
    __tablename__ = "franchises"
    id            = Column(Integer, primary_key=True, index=True)
    tenant_id     = Column(Integer, ForeignKey("tenants.id"), nullable=False, index=True)
    name          = Column(String, nullable=False)
    code          = Column(String, nullable=True)
    address       = Column(String, nullable=True)
    # commission_model: "margin" (B2B rate, no 194H TDS) or "commission" (referral, 194H applies)
    commission_model = Column(String, default="margin")
    commission_rate  = Column(Integer, default=0)   # percent, used when model == "commission"
    pan              = Column(String, nullable=True)  # needed for TDS (20% if absent)
    credit_limit     = Column(Integer, default=0)
    is_active        = Column(Boolean, default=True)
    created_at       = Column(DateTime(timezone=True), server_default=func.now())
    # --- B2B: a franchise acts as an "organization"; belongs to one group or none ---
    org_group_id   = Column(Integer, ForeignKey("org_groups.id"), nullable=True, index=True)
    aadhaar        = Column(String, nullable=True)
    gstin          = Column(String, nullable=True)
    contact_person = Column(String, nullable=True)
    phone          = Column(String, nullable=True)
    email          = Column(String, nullable=True)

    tenant        = relationship("Tenant", back_populates="franchises")


class User(Base):
    """Any human (or service) that logs in. Scope derives from role + the ids below."""
    __tablename__ = "users"
    id            = Column(Integer, primary_key=True, index=True)
    email         = Column(String, unique=True, index=True, nullable=False)
    full_name     = Column(String, nullable=True)
    phone         = Column(String, nullable=True)
    hashed_password = Column(String, nullable=False)
    role          = Column(String, nullable=False, index=True)
    # Scope anchors — which ones are set depends on the role.
    tenant_id     = Column(Integer, ForeignKey("tenants.id"),    nullable=True, index=True)
    branch_id     = Column(Integer, ForeignKey("branches.id"),   nullable=True, index=True)
    franchise_id  = Column(Integer, ForeignKey("franchises.id"), nullable=True, index=True)
    patient_id    = Column(Integer, ForeignKey("patients.id"),   nullable=True, index=True)
    department_id = Column(Integer, ForeignKey("departments.id"), nullable=True, index=True)  # which lab section this person works in — independent of role
    is_active     = Column(Boolean, default=True)
    created_at    = Column(DateTime(timezone=True), server_default=func.now())

    tenant        = relationship("Tenant", back_populates="users")


class RoleDef(Base):
    """Master list of roles shown in dropdowns (Users & Staff, Menu Permissions, ...).
    The KEY set is fixed to the roles the backend actually knows how to scope/authorize
    (see Role class below) — creating a row with an unrecognized key would produce a
    login the system can't grant any permissions to, so this table only lets an admin
    rename the display label and mark a role inactive (hidden from pickers), not invent
    new keys. This is what makes role dropdowns across the app "dynamic" instead of
    each page hardcoding its own copy of the list."""
    __tablename__ = "role_defs"
    role_key   = Column(String, primary_key=True)
    label      = Column(String, nullable=False)
    is_active  = Column(Boolean, default=True)
    sort_order = Column(Integer, default=0)


class RoleMenuConfig(Base):
    """Which sidebar menu items are hidden for a given role. Absence of a row
    (or an empty hidden_keys list) means that role sees everything — this is
    additive/restrictive only, so it can never accidentally grant access.
    super_admin and lab_admin always bypass this (enforced server-side)."""
    __tablename__ = "role_menu_config"
    role         = Column(String, primary_key=True)
    hidden_keys  = Column(JSON, nullable=True)   # list[str] of nav item ids hidden for this role
    updated_at   = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class AuditLog(Base):
    """Append-only trail. Never UPDATE or DELETE rows here."""
    __tablename__ = "audit_log"
    id          = Column(Integer, primary_key=True, index=True)
    tenant_id   = Column(Integer, nullable=True, index=True)
    user_id     = Column(Integer, nullable=True, index=True)
    user_email  = Column(String, nullable=True)
    action      = Column(String, nullable=False)   # e.g. "create", "update", "login", "validate"
    entity      = Column(String, nullable=True)     # e.g. "patient", "lab_result", "user"
    entity_id   = Column(String, nullable=True)
    before      = Column(JSON, nullable=True)
    after       = Column(JSON, nullable=True)
    ip          = Column(String, nullable=True)
    detail      = Column(Text, nullable=True)
    created_at  = Column(DateTime(timezone=True), server_default=func.now())


class ReferralDoctor(Base):
    """Referral / referring doctor — sends patients to the lab and earns commission.
    No login credentials needed; just a name and optional commission rate.

    When this doctor is also the one who VALIDATES a report (matched to a
    pathologist login by name — see services/doctor_sync.py), the fields
    below let their own signature/qualification/registration print on the
    report instead of a single tenant-wide default — see routers/pdf.py
    _validating_doctor()."""
    __tablename__ = "referral_doctors"
    id                 = Column(Integer, primary_key=True, index=True)
    tenant_id          = Column(Integer, ForeignKey("tenants.id"), nullable=True, index=True)
    name               = Column(String, nullable=False)
    phone              = Column(String, nullable=True)
    commission_percent = Column(Float, default=0.0)
    is_active          = Column(Boolean, default=True)
    created_at         = Column(DateTime(timezone=True), server_default=func.now())
    qualification      = Column(String, nullable=True)     # e.g. "MD (Pathology)"
    registration_no    = Column(String, nullable=True)      # medical council registration no.
    signature_filename = Column(String, nullable=True)      # uploaded signature image, see services/report_settings.py asset helpers
