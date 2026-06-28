"""
Credit gating for franchise/organization report access.

Rule (Phase 4): a franchise's reports are LOCKED when its outstanding balance
goes ABOVE its credit limit (outstanding > credit_limit). While within limit,
reports and PDFs are accessible; once it crosses, the franchise sees the report
list but values and PDFs are blocked until the balance is brought back in.
"""
from sqlalchemy.orm import Session

from models.org import Franchise, Role


def franchise_outstanding(db: Session, franchise_id) -> float:
    if not franchise_id:
        return 0.0
    from models.b2b import OrgLedger
    last = (db.query(OrgLedger)
              .filter(OrgLedger.organization_id == franchise_id)
              .order_by(OrgLedger.id.desc()).first())
    return float(last.balance_after) if last and last.balance_after is not None else 0.0


def franchise_credit_limit(db: Session, franchise_id) -> float:
    if not franchise_id:
        return 0.0
    org = db.query(Franchise).filter(Franchise.id == franchise_id).first()
    return float(org.credit_limit) if org and org.credit_limit is not None else 0.0


def is_franchise_locked(db: Session, franchise_id) -> bool:
    """True when outstanding > credit_limit for this franchise id."""
    if not franchise_id:
        return False
    return franchise_outstanding(db, franchise_id) > franchise_credit_limit(db, franchise_id)


def franchise_locked(db: Session, user) -> bool:
    """Convenience: is THIS user a franchise that is over its credit limit?
    Non-franchise users are never locked."""
    if getattr(user, "role", None) != Role.FRANCHISE:
        return False
    return is_franchise_locked(db, getattr(user, "franchise_id", None))
