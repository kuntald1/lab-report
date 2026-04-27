# 🔬 MediCloud — Lab Middleware System

A LIVEHEALTH-style middleware that connects lab analyser machines to a database.
Built with **React + Python FastAPI + PostgreSQL**.

---

## 📁 Project Structure

```
medicloud/
├── backend/
│   ├── main.py              ← FastAPI app entry point
│   ├── database.py          ← PostgreSQL connection
│   ├── requirements.txt     ← Python dependencies
│   ├── Dockerfile
│   ├── models/
│   │   └── models.py        ← Device, Patient, LabResult tables
│   ├── parsers/
│   │   └── astm_parser.py   ← ASTM/HL7 parser (core middleware logic)
│   └── routers/
│       ├── devices.py       ← Device CRUD APIs
│       ├── patients.py      ← Patient CRUD APIs
│       ├── results.py       ← Parse + store results APIs
│       └── simulate.py      ← Generate test ASTM data
│
├── frontend/
│   ├── src/
│   │   ├── App.jsx
│   │   ├── main.jsx
│   │   ├── index.css
│   │   ├── services/api.js  ← All API calls
│   │   ├── components/
│   │   │   └── Sidebar.jsx
│   │   └── pages/
│   │       ├── Dashboard.jsx
│   │       ├── Devices.jsx
│   │       ├── Patients.jsx
│   │       ├── Results.jsx
│   │       └── Simulator.jsx ← Core testing page
│   ├── package.json
│   ├── vite.config.js
│   └── Dockerfile
│
├── docker-compose.yml
└── README.md
```

---

## 🚀 How to Run

### Option A — Docker (Easiest)
```bash
# Make sure Docker Desktop is installed
cd medicloud
docker-compose up --build
```
Then open:
- Frontend: http://localhost:3000
- Backend API: http://localhost:8000
- API Docs: http://localhost:8000/docs

---

### Option B — Manual (Without Docker)

#### 1. Start PostgreSQL
Install PostgreSQL and create:
```sql
CREATE USER medicloud WITH PASSWORD 'medicloud123';
CREATE DATABASE medicloud_db OWNER medicloud;
```

#### 2. Start Backend
```bash
cd medicloud/backend
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

#### 3. Start Frontend
```bash
cd medicloud/frontend
npm install
npm run dev
```

---

## 🧪 How to Test (Without Real Machine)

1. Open **http://localhost:3000**
2. Go to **Patients** → Add a patient with barcode `MC00000001`
3. Go to **Devices** → Add a device (e.g. Erba H560, Hematology)
4. Go to **Simulator**:
   - Click **"CBC (Normal)"** template
   - Click **"⚡ Parse & Save to Database"**
   - See parsed parameters appear on the right
5. Go to **Results** → See the saved result with all parameters

---

## 🔌 How the Middleware Works

```
Machine sends raw ASTM text via TCP/IP
        ↓
POST /api/results/parse  ← Your system receives it
        ↓
astm_parser.py translates ASTM → clean JSON
        ↓
JSON saved to PostgreSQL (lab_results table)
        ↓
Frontend fetches and displays results
```

### Sample ASTM Input:
```
H|\^&|||Erba H560|||||||P|1
P|1||P001|||||M
O|1|MC00000001||^^^CBC|R
R|1|^^^WBC|7.5|10^3/uL|4.0-11.0|N
R|2|^^^HGB|14.2|g/dL|13.0-17.0|N
L|1|N
```

### Parsed JSON Output:
```json
{
  "protocol": "ASTM",
  "device_type": "Hematology",
  "barcode": "MC00000001",
  "parameters": [
    { "param": "WBC", "name": "White Blood Cells", "value": 7.5, "unit": "10³/µL", "flag": "N", "status": "Normal" },
    { "param": "HGB", "name": "Hemoglobin", "value": 14.2, "unit": "g/dL", "flag": "N", "status": "Normal" }
  ]
}
```

---

## 📡 API Endpoints

| Method | URL | Description |
|--------|-----|-------------|
| GET  | /api/devices | List all devices |
| POST | /api/devices | Add new device |
| GET  | /api/patients | List all patients |
| POST | /api/patients | Register patient |
| POST | /api/results/parse | **Parse raw ASTM/HL7 data** |
| GET  | /api/results | Get all results |
| GET  | /api/simulate/astm/cbc | Generate sample CBC data |
| GET  | /api/simulate/astm/biochem | Generate sample Biochem data |

Full interactive docs: **http://localhost:8000/docs**

---

## 🔮 Next Steps (Phase 2)

- [ ] TCP Socket Server to receive data directly from machines
- [ ] TCP Proxy to mirror LiveHealth traffic
- [ ] PDF report generation
- [ ] WhatsApp/Email report delivery
- [ ] HL7 FHIR support
- [ ] Real-time WebSocket updates
