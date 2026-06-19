# MediCloud — Phase 2: orders, sample events & TAT

Builds the clinical workflow layer on top of Phase 1. The analyser-ingestion
core (patients / devices / lab_results) is untouched; every new table is
additive and reuses the Phase 1 tenant/branch/franchise scoping.

## New tables (`backend/models/clinical.py`)

- `departments` — Biochemistry, Haematology, …
- `test_catalog` — individual tests (code, unit, method, price, `tat_target_minutes`)
- `packages` + `package_tests` — profiles/panels (bundle of tests)
- `reference_ranges` — per-test ranges by sex/age
- `orders` — a requisition for a patient (one sample/barcode, a priority, a status)
- `order_items` — the tests on an order (with result fields for later)
- `sample_events` — **append-only** timestamp log; the source of all TAT numbers

## The TAT model

`sample_events` records one row per lifecycle transition. The seven event types,
in order: `collected → dispatched → received → test_started → resulted →
validated → reported`. Stage durations are the gaps between consecutive events,
so nothing is precomputed:

| stage | from → to | phase |
|---|---|---|
| wait_for_pickup | collected → dispatched | pre-analytical |
| transit | dispatched → received | pre-analytical |
| receipt_accessioning | received → test_started | pre-analytical |
| testing | test_started → resulted | analytical |
| validation | resulted → validated | post-analytical |
| reporting | validated → reported | post-analytical |

`total` = collected → reported.

The engine (`backend/services/tat.py`) is pure Python (no DB), so it's portable
and unit-tested. It computes per-stage **median / p90 / average** and the
pre-/analytical/post-analytical rollup, grouped by franchise.

## Endpoints

Catalog (`/api/catalog`) — reads tenant-scoped; writes require lab_admin:
- `POST/GET /departments`, `POST/GET /tests`, `POST/GET /packages`
- `POST /reference-ranges`, `GET /reference-ranges/{test_id}`

Orders (`/api/orders`):
- `POST /` — create an order with items (franchise users are pinned to their franchise)
- `GET /` — list (scope-filtered; `?status=`)
- `GET /{id}` — order detail with items + event timeline
- `POST /{id}/events` — append a sample event (`{event_type, event_at?, note?}`); auto-advances order status

TAT (`/api/tat`):
- `GET /by-franchise?date_from=&date_to=&priority=` — per-franchise stage breakdown
- `GET /order/{id}` — single-order timeline + stage minutes

All TAT/order queries are scope-filtered: a franchise sees only its own, a
lab_admin sees the whole tenant.

## Running it

The new tables auto-create on backend startup. To do it explicitly, or to load
demo data so the TAT report has something to show:

```bash
docker compose exec backend python -m scripts.init_phase2        # create tables
docker compose exec backend python -m scripts.seed_demo_tat      # OPTIONAL demo orders+events
# re-run demo cleanly:
docker compose exec backend python -m scripts.seed_demo_tat --reset
```

Then (with a lab_admin token):

```bash
curl http://localhost:8001/api/tat/by-franchise -H "Authorization: Bearer <token>"
```

The demo seeder creates Franchise A/B/C with event chains timed to reproduce the
A≈4h / B≈3h10m / C≈5h comparison (with jitter), so `by-franchise` returns a
realistic breakdown immediately. Demo rows are tagged `order_no` `DEMO-*` and are
removable with `--reset`.

## Verified

- All 8 new tables build; mappers/relationships resolve.
- Demo seed + TAT engine produce correct per-stage median/p90 and phase rollup
  (Franchise C pre-analytical ≈193 min vs A ≈134, B ≈79; lab-side stages flat).
- Scope isolation on `orders` and `sample_events`: franchise sees only its own,
  patient only its own, lab_admin the whole tenant.

## Not in this phase (next up)

- Wire the analyser ingestion to auto-emit a `resulted` sample_event when a
  result lands (a small hook in the results path), so TAT fills itself without
  manual event posting.
- Move the per-franchise aggregation into a Postgres view / materialized view
  for scale (the pure-Python engine is fine to start).
- Result entry → pathologist validation flow against `order_items`, critical-value
  flags, and amendment versioning.
