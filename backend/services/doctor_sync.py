"""Keeps pathologist-role logins and the referral_doctors roster in sync.

Commission only ever fires when a pathologist VALIDATES a report — so a
referral doctor with no login can never earn it. For commission to work at
all, the doctor picked at patient registration has to be someone who can
actually validate, i.e. a pathologist User. This module auto-creates a
matching ReferralDoctor row (commission_percent defaults to 0, admin sets
the real rate afterwards) the first time the doctor lists are read, so
existing and future pathologist logins show up automatically without a
manual backfill step.
"""
from sqlalchemy.orm import Session
from typing import Optional


def sync_pathologist_doctors(db: Session, tenant_id: Optional[int]):
    from models.org import User, Role, ReferralDoctor

    pq = db.query(User).filter(User.role == Role.PATHOLOGIST, User.is_active.is_(True))
    if tenant_id is not None:
        pq = pq.filter(User.tenant_id == tenant_id)
    pathologists = pq.all()
    if not pathologists:
        return

    eq = db.query(ReferralDoctor).filter(ReferralDoctor.is_active.is_(True))
    if tenant_id is not None:
        eq = eq.filter(ReferralDoctor.tenant_id == tenant_id)
    existing_names = {(d.name or "").strip().lower() for d in eq.all()}

    changed = False
    for u in pathologists:
        name = (u.full_name or u.email or "").strip()
        if not name or name.lower() in existing_names:
            continue
        db.add(ReferralDoctor(tenant_id=tenant_id, name=name,
                              phone=getattr(u, "phone", None) or None,
                              commission_percent=0.0, is_active=True))
        existing_names.add(name.lower())
        changed = True
    if changed:
        db.commit()


def pathologist_name_set(db: Session, tenant_id: Optional[int]) -> set:
    """Lowercased full_names of active pathologists — used to flag which
    referral_doctors rows have an actual login (vs referral-only names)."""
    from models.org import User, Role
    pq = db.query(User).filter(User.role == Role.PATHOLOGIST, User.is_active.is_(True))
    if tenant_id is not None:
        pq = pq.filter(User.tenant_id == tenant_id)
    return {(u.full_name or u.email or "").strip().lower() for u in pq.all()}
