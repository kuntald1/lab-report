"""
Price resolution — the single source of truth for "what does test T cost for
patient P / organization O".

Rule (confirmed):
  1. If the patient's organization is in a GROUP and that group includes the test
     -> use the GROUP's mrp/price.
  2. Else if the (standalone) organization includes the test
     -> use the ORGANIZATION's mrp/price.
  3. Else (Direct / walk-in, or test not linked anywhere)
     -> use the BASE test's mrp/price.

Each context stores its own frozen copy, so these are independent lookups, not a
single value with overrides. Editing one context never affects another.
"""
from dataclasses import dataclass
from models.clinical import TestCatalog
from models.b2b import OrgGroupTest, OrgTest
from models.org import Franchise   # franchises == organizations


@dataclass
class ResolvedPrice:
    test_id: int
    mrp: float
    price: float
    source: str        # 'group' | 'org' | 'base'


def resolve_price(db, test_id: int, organization_id: int | None) -> ResolvedPrice:
    base = db.query(TestCatalog).filter(TestCatalog.id == test_id).first()
    if base is None:
        raise ValueError(f"test {test_id} not found")

    # Direct / walk-in -> base
    if organization_id is None:
        return ResolvedPrice(test_id, base.mrp or 0.0, base.price or 0.0, "base")

    org = db.query(Franchise).filter(Franchise.id == organization_id).first()

    # 1) group price (if org is grouped and the group includes this test)
    if org is not None and getattr(org, "org_group_id", None):
        gt = (db.query(OrgGroupTest)
                .filter(OrgGroupTest.org_group_id == org.org_group_id,
                        OrgGroupTest.test_id == test_id)
                .first())
        if gt is not None:
            return ResolvedPrice(test_id, gt.mrp or 0.0, gt.price or 0.0, "group")

    # 2) standalone org price
    ot = (db.query(OrgTest)
            .filter(OrgTest.organization_id == organization_id,
                    OrgTest.test_id == test_id)
            .first())
    if ot is not None:
        return ResolvedPrice(test_id, ot.mrp or 0.0, ot.price or 0.0, "org")

    # 3) base
    return ResolvedPrice(test_id, base.mrp or 0.0, base.price or 0.0, "base")


def resolve_many(db, test_ids: list[int], organization_id: int | None) -> dict[int, ResolvedPrice]:
    """Resolve a list of tests at once (e.g. when billing a group/profile)."""
    return {tid: resolve_price(db, tid, organization_id) for tid in test_ids}
