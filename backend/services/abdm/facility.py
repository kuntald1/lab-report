"""
ABDM facility resolver — the single place that maps tenant <-> HIP id.

Every outbound gateway call must resolve the HIP from the patient's tenant.
Every inbound callback must resolve the tenant from the X-HIP-ID header and
scope its DB work to that tenant. Both directions go through here so the
multi-tenant boundary is enforced in one place, not scattered.
"""
from models.abdm import AbdmFacility


class FacilityNotMapped(RuntimeError):
    """Raised when a tenant has no active ABDM facility mapping."""


def hip_for_tenant(db, tenant_id: int | None) -> AbdmFacility | None:
    """The HIP/facility for a tenant, or None if that tenant isn't ABDM-enabled."""
    if tenant_id is None:
        return None
    return (db.query(AbdmFacility)
              .filter(AbdmFacility.tenant_id == tenant_id,
                      AbdmFacility.active.is_(True))
              .first())


def tenant_for_hip(db, hip_id: str | None) -> AbdmFacility | None:
    """Reverse lookup: which tenant owns this HIP id (from an inbound X-HIP-ID)."""
    if not hip_id:
        return None
    return (db.query(AbdmFacility)
              .filter(AbdmFacility.hip_id == hip_id,
                      AbdmFacility.active.is_(True))
              .first())


def require_hip_for_tenant(db, tenant_id: int | None) -> AbdmFacility:
    """Same as hip_for_tenant but raises instead of returning None."""
    fac = hip_for_tenant(db, tenant_id)
    if fac is None:
        raise FacilityNotMapped(
            f"tenant {tenant_id} has no active ABDM facility mapping "
            f"(insert a row in abdm_facilities to onboard it)")
    return fac


def upsert_facility(db, tenant_id: int, hip_id: str, hip_name: str,
                    cm_id: str = "sbx") -> AbdmFacility:
    """Onboard or update a tenant's ABDM facility. Call this per new client."""
    fac = (db.query(AbdmFacility)
             .filter(AbdmFacility.tenant_id == tenant_id).first())
    if fac is None:
        fac = AbdmFacility(tenant_id=tenant_id, hip_id=hip_id,
                           hip_name=hip_name, cm_id=cm_id, active=True)
        db.add(fac)
    else:
        fac.hip_id = hip_id
        fac.hip_name = hip_name
        fac.cm_id = cm_id
        fac.active = True
    db.commit()
    db.refresh(fac)
    return fac
