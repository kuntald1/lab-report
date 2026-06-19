"""Helper for writing append-only audit entries.

Call `write_audit(...)` after any state change worth recording (logins,
create/update, result validation, report release, bill settlement). Rows are
only ever inserted — never updated or deleted.
"""
from typing import Optional, Any

from sqlalchemy.orm import Session

from models.org import AuditLog, User


def write_audit(
    db: Session,
    *,
    action: str,
    user: Optional[User] = None,
    entity: Optional[str] = None,
    entity_id: Optional[Any] = None,
    before: Optional[dict] = None,
    after: Optional[dict] = None,
    ip: Optional[str] = None,
    detail: Optional[str] = None,
    tenant_id: Optional[int] = None,
) -> AuditLog:
    entry = AuditLog(
        action=action,
        entity=entity,
        entity_id=str(entity_id) if entity_id is not None else None,
        before=before,
        after=after,
        ip=ip,
        detail=detail,
        user_id=user.id if user else None,
        user_email=user.email if user else None,
        tenant_id=tenant_id if tenant_id is not None else (user.tenant_id if user else None),
    )
    db.add(entry)
    db.commit()
    db.refresh(entry)
    return entry
