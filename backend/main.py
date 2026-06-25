from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
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
   


Base.metadata.create_all(bind=engine)

app = FastAPI(title="MediCloud Middleware API", version="3.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(devices.router,  prefix="/api/devices",  tags=["Devices"])
app.include_router(results.router,  prefix="/api/results",  tags=["Results"])
app.include_router(patients.router, prefix="/api/patients", tags=["Patients"])
app.include_router(simulate.router, prefix="/api/simulate", tags=["Simulate"])
app.include_router(pdf.router,      prefix="/api/results",  tags=["PDF"])
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

@app.get("/")
def root():
    return {"message": "MediCloud v3.0 — Multi-Device Middleware", "status": "ok"}
