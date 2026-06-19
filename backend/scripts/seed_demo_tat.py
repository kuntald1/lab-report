"""
OPTIONAL demo data for the TAT report.

Creates three franchises (A, B, C) if missing and a batch of orders for each,
with full sample-event chains whose timing reproduces the franchise comparison
we discussed (A ~4h, B ~3h10m, C ~5h) plus random jitter so percentiles are
meaningful. This lets GET /api/tat/by-franchise return real data right away.

    python -m scripts.seed_demo_tat            # seed
    python -m scripts.seed_demo_tat --reset    # delete demo data and reseed

Demo rows are tagged with order_no starting 'DEMO-' so they're easy to find /
remove and never collide with real orders.
"""
import os, sys, random
import datetime as dt
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from database import engine, Base, SessionLocal
from models import models, org, clinical   # noqa: F401
from models.org import Tenant, Branch, Franchise
from models.models import Patient
from models.clinical import Order, OrderItem, SampleEvent, EventType, OrderStatus

# stage minutes per franchise: (wait_for_pickup, transit, receipt, testing, validation, report)
PROFILES = {
    "Franchise A": (75, 35, 25, 50, 20, 15),   # ~240 min total
    "Franchise B": (40, 20, 25, 50, 20, 15),   # ~190 min total
    "Franchise C": (120, 50, 25, 50, 20, 15),  # ~300 min total
}
ORDERS_PER_FRANCHISE = 8


def jitter(m):  # ±15%
    return m * random.uniform(0.85, 1.15)


def get_tenant_branch(db):
    t = db.query(Tenant).filter(Tenant.slug == "default").first()
    if not t:
        t = Tenant(name="Default Lab", slug="default"); db.add(t); db.commit(); db.refresh(t)
    b = db.query(Branch).filter(Branch.tenant_id == t.id, Branch.is_main == True).first()
    if not b:
        b = Branch(tenant_id=t.id, name="Main Lab", is_main=True); db.add(b); db.commit(); db.refresh(b)
    return t, b


def get_franchise(db, tenant, name):
    f = db.query(Franchise).filter(Franchise.tenant_id == tenant.id, Franchise.name == name).first()
    if not f:
        f = Franchise(tenant_id=tenant.id, name=name); db.add(f); db.commit(); db.refresh(f)
        print(f"  + created {name} (id={f.id})")
    return f


def reset_demo(db):
    demo_orders = db.query(Order).filter(Order.order_no.like("DEMO-%")).all()
    ids = [o.id for o in demo_orders]
    if ids:
        db.query(SampleEvent).filter(SampleEvent.order_id.in_(ids)).delete(synchronize_session=False)
        db.query(OrderItem).filter(OrderItem.order_id.in_(ids)).delete(synchronize_session=False)
        db.query(Order).filter(Order.id.in_(ids)).delete(synchronize_session=False)
        db.commit()
    db.query(Patient).filter(Patient.barcode.like("DEMO-%")).delete(synchronize_session=False)
    db.commit()
    print(f"  ~ removed {len(ids)} demo order(s)")


def main(reset=False):
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        if reset:
            reset_demo(db)
        if db.query(Order).filter(Order.order_no.like("DEMO-%")).first():
            print("Demo data already present. Use --reset to rebuild it. Skipping.")
            return

        tenant, branch = get_tenant_branch(db)
        now = dt.datetime.now(dt.timezone.utc)
        seq = 0
        for fname, profile in PROFILES.items():
            fr = get_franchise(db, tenant, fname)
            for i in range(ORDERS_PER_FRANCHISE):
                seq += 1
                barcode = f"DEMO-{fr.id}-{i}"
                patient = Patient(barcode=barcode, patient_name=f"Demo {fname} #{i}",
                                  tenant_id=tenant.id, branch_id=branch.id,
                                  registered_franchise_id=fr.id)
                db.add(patient); db.commit(); db.refresh(patient)

                order = Order(tenant_id=tenant.id, branch_id=branch.id, franchise_id=fr.id,
                              patient_id=patient.id, order_no=f"DEMO-{seq:04d}", barcode=barcode,
                              priority="routine", status=OrderStatus.REPORTED, total_amount=0.0)
                db.add(order); db.commit(); db.refresh(order)
                db.add(OrderItem(order_id=order.id, test_name="Complete Blood Count", price=0.0))

                # build the event chain backwards from a collected time a few hours ago
                collected = now - dt.timedelta(hours=random.uniform(4, 30))
                waits = [jitter(m) for m in profile]
                t = collected
                stamps = [(EventType.COLLECTED, t)]
                for ev, mins in zip(
                    [EventType.DISPATCHED, EventType.RECEIVED, EventType.TEST_STARTED,
                     EventType.RESULTED, EventType.VALIDATED, EventType.REPORTED], waits):
                    t = t + dt.timedelta(minutes=mins)
                    stamps.append((ev, t))
                for ev, when in stamps:
                    db.add(SampleEvent(tenant_id=tenant.id, branch_id=branch.id, franchise_id=fr.id,
                                       order_id=order.id, patient_id=patient.id, barcode=barcode,
                                       event_type=ev, event_at=when))
                db.commit()
            print(f"  + {ORDERS_PER_FRANCHISE} demo orders for {fname}")

        print("\nDone. Try:  GET /api/tat/by-franchise")
    finally:
        db.close()


if __name__ == "__main__":
    main(reset="--reset" in sys.argv)
