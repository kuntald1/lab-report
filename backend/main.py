from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from routers import devices, results, patients, simulate, pdf, tcp
from routers import auth_router, admin
from routers import catalog, orders, tat
from database import engine, Base
# Import models so their tables register on Base before create_all().
from models import models as _core_models   # noqa: F401  (patients/devices/lab_results)
from models import org as _org_models        # noqa: F401  (tenants/branches/franchises/users/audit)
from models import clinical as _clinical_models  # noqa: F401  (orders/sample_events/catalog)

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

@app.get("/")
def root():
    return {"message": "MediCloud v3.0 — Multi-Device Middleware", "status": "ok"}
