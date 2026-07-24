from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
import os
from routers import devices, results, patients, simulate, pdf, tcp
from routers import auth_router, admin
from routers import catalog, orders, tat
from routers import sample_status
from database import engine, Base
# Import models so their tables register on Base before create_all().
from models import models as _core_models   # noqa: F401  (patients/devices/lab_results)
from models import org as _org_models        # noqa: F401  (tenants/branches/franchises/users/audit)
from models import clinical as _clinical_models  # noqa: F401  (orders/sample_events/catalog)
from routers import abdm
import models.abdm  # registers the abdm tables on metadata
from routers import b2b as b2b_router
from routers import billing as billing_router
from routers import payments_rzp
from routers import public_report
from routers import messaging as messaging_router
import models.messaging
from routers import reports as reports_router
import models.reports
from routers import reports2 as reports2_router
from routers import commission as commission_router
import models.commission
   


Base.metadata.create_all(bind=engine)

app = FastAPI(title="MediCloud Middleware API", version="3.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Uploaded report-branding assets (lab logo, pathologist signature) — served
# back out at /report-assets/... . Backed by a named Docker volume
# (report_assets_data) so uploads survive image rebuilds.
_REPORT_ASSETS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "uploads", "report_assets")
os.makedirs(_REPORT_ASSETS_DIR, exist_ok=True)
app.mount("/report-assets", StaticFiles(directory=_REPORT_ASSETS_DIR), name="report-assets")

app.include_router(devices.router,  prefix="/api/devices",  tags=["Devices"])
app.include_router(pdf.router,      prefix="/api/results",  tags=["PDF"])
app.include_router(results.router,  prefix="/api/results",  tags=["Results"])
app.include_router(patients.router, prefix="/api/patients", tags=["Patients"])
app.include_router(simulate.router, prefix="/api/simulate", tags=["Simulate"])
app.include_router(tcp.router,      prefix="/api/tcp",      tags=["TCP"])
app.include_router(auth_router.router, prefix="/api/auth",  tags=["Auth"])
app.include_router(admin.router,       prefix="/api/admin", tags=["Admin"])
app.include_router(catalog.router,     prefix="/api/catalog", tags=["Catalog"])
app.include_router(orders.router,      prefix="/api/orders",  tags=["Orders"])
app.include_router(tat.router,         prefix="/api/tat",     tags=["TAT"])
app.include_router(sample_status.router, prefix="/api/sample-status", tags=["Sample Status"])
app.include_router(abdm.router, prefix="/api/abdm", tags=["ABDM"])
app.include_router(b2b_router.router, prefix="/api/b2b", tags=["B2B"])
app.include_router(billing_router.router, prefix="/api/billing", tags=["Billing"])
app.include_router(payments_rzp.router, prefix="/api/billing", tags=["Razorpay"])
app.include_router(public_report.router, prefix="/api/public", tags=["Public Report"])
app.include_router(messaging_router.router, prefix="/api/billing", tags=["Messaging"])
app.include_router(reports_router.router, prefix="/api/reports", tags=["Reports"])
app.include_router(reports2_router.router, prefix="/api/reports2", tags=["Reports2"])
app.include_router(commission_router.router, prefix="/api/commission", tags=["Doctor Commission"])

@app.get("/")
def root():
    return {"message": "MediCloud v3.0 — Multi-Device Middleware", "status": "ok"}
