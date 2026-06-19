# MediCloud — Phase 1: multi-tenancy, roles & audit

This phase adds the foundation layer **without touching the analyser-ingestion
path** (the `patients` / `devices` / `lab_results` flow and the ASTM/HL7 parsers
are unchanged). All scoping columns added to existing tables are nullable.

## What was added

**New tables** (`backend/models/org.py`)
- `tenants` — one row per lab business (the SaaS tenant). `gst_exempt` defaults
  to `true` (diagnostic services are GST-exempt by default — configurable, not
  hard-coded).
- `branches` — lab-owned locations inside a tenant.
- `franchises` — partner collection centres. Carries `commission_model`
  (`"margin"` = B2B rate, no 194H TDS; `"commission"` = referral, 194H applies),
  `commission_rate`, and `pan` (TDS is 20% without a PAN).
- `users` — anyone who logs in, with a `role` plus scope anchors
  (`tenant_id` / `branch_id` / `franchise_id` / `patient_id`).
- `audit_log` — append-only trail (never updated or deleted).

**Scoping columns** added (nullable) to existing tables:
- `patients` → `tenant_id`, `branch_id`, `registered_franchise_id`
- `devices` → `tenant_id`, `branch_id`
- `lab_results` → `tenant_id`, `branch_id`

**Auth** (`backend/auth/`)
- `security.py` — bcrypt password hashing + PyJWT tokens.
- `deps.py` — `get_current_user`, `Scope`, `get_scope`, `require_roles(...)`,
  and `apply_scope(query, model, scope)` — the query-layer row filter.
- `audit.py` — `write_audit(...)`.

**Routers**
- `routers/auth_router.py` → `POST /api/auth/login`, `GET /api/auth/me`,
  `GET /api/auth/scope`.
- `routers/admin.py` → tenants / branches / franchises / users / audit, all
  scope-aware and role-guarded.

## Role hierarchy

```
super_admin            platform owner — sees every tenant
  └ lab_admin          one lab (tenant-wide)
      ├ pathologist     branch-scoped (validates + signs)
      ├ technician      branch-scoped (enters results)
      ├ receptionist    branch-scoped
      └ phlebotomist    branch-scoped (home collection)
  ├ franchise          sees only patients its franchise registered
  └ patient            sees only its own records
```

## How visibility is enforced

Every read query that touches tenant data is filtered through `apply_scope`,
so isolation lives at the query layer, not in the UI. Example:

```python
from auth.deps import get_scope, apply_scope
from models.models import Patient

@router.get("/")
def list_patients(db: Session = Depends(get_db), scope = Depends(get_scope)):
    return apply_scope(db.query(Patient), Patient, scope).all()
```

`apply_scope` only applies a filter when the column exists on the model AND the
value is set on the scope, so the same helper works for every table.

## Running it (once, after deploy)

Install the two new deps and seed the default tenant + admins + backfill the
existing analyser rows into that tenant:

```bash
# from backend/  (or: docker compose exec backend ...)
pip install -r requirements.txt
python -m scripts.init_phase1
```

Seeded logins (override via env vars; **change in production**):
- super admin — `superadmin@medicloud.local` / `ChangeMe!123`
- lab admin   — `admin@medicloud.local` / `ChangeMe!123`

Set a real JWT secret in the environment: `JWT_SECRET=<random-long-string>`.

Then:

```bash
curl -X POST http://localhost:8000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@medicloud.local","password":"ChangeMe!123"}'
# use the returned access_token as:  Authorization: Bearer <token>
```

## Verified

- All 8 tables build; cross-module foreign keys resolve (`configure_mappers`).
- bcrypt hash/verify and JWT encode/decode round-trip.
- Scope isolation: lab_admin sees the whole tenant, franchise A sees only its
  own patients, franchise B sees only its own, a patient sees only itself,
  super_admin sees all.

## Not in this phase (next up)

Phase 2 — `orders` / `order_items`, the test catalog & reference ranges, and the
`sample_events` table that powers the TAT breakdown. The ingestion path keeps
writing `lab_results` exactly as today; `sample_events` will sit alongside it.
