from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from routers import devices, results, patients, simulate, pdf, tcp
from database import engine, Base

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

@app.get("/")
def root():
    return {"message": "MediCloud v3.0 — Multi-Device Middleware", "status": "ok"}
