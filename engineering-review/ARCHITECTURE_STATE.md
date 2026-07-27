# EngineeringOS — ARCHITECTURE_STATE.md

## System overview

```
                    ┌──────────────────┐
                    │     apps/web      │  React + TS + Vite
                    │  (browser client) │  Three.js / @thatopen for BIM viewer
                    └─────────┬─────────┘
                              │ HTTPS (REST, /api/v1/*)
                              ▼
                    ┌──────────────────┐
                    │     apps/api      │  NestJS — orchestration, auth,
                    │                   │  tenancy, all business modules
                    └────┬────────┬─────┘
                         │        │
              enqueues   │        │  reads/writes
              Bull job   │        ▼
                         │  ┌───────────┐
                         │  │ PostgreSQL │  Shared DB, row-level security
                         │  │  (RLS)     │  scoped by company_id
                         │  └─────┬─────┘
                         ▼        │
              ┌──────────────────┐│
              │  Redis / Bull     ││
              │  queue            ││
              └─────────┬────────┘│
                        │         │
                        ▼         │
              ┌──────────────────┐│
              │ apps/ifc-service  ││  NestJS — standalone worker.
              │ (IFC processing)  │┘  web-ifc parsing, @thatopen/fragments
              └─────────┬─────────┘   generation, all IFC extraction.
                        │
                        ▼
              ┌──────────────────┐
              │  Object storage   │  S3-compatible (MinIO/R2 in prod,
              │  (S3-compatible)  │  s3rver as a local dev/test stand-in)
              └──────────────────┘

              ┌──────────────────┐
              │ apps/ai-service   │  Python FastAPI. Ingestion endpoints
              │ (Python, separate)│  exist and are called fire-and-forget
              └──────────────────┘  from apps/api on issue/capture create.
                                     Qdrant + embedding search: code exists,
                                     live-verification blocked by network
                                     allowlist (huggingface.co unreachable
                                     in this sandbox), not a code defect.
```

## Applications (`apps/*`)

### `apps/api` (NestJS, TypeScript)
The main backend. Owns: auth, tenancy/RLS, companies, projects,
hierarchy (buildings/levels/locations), issues, documents, timeline,
captures, notifications, subscriptions, audit logging, and **BIM
orchestration only** (model registration, presigned upload URLs, status
polling, reprocess triggering, hierarchy/element read endpoints, viewer
data endpoint). Does **not** contain any IFC parsing logic.

Key modules touched/added across sessions:
- `modules/bim/` — `bim.service.ts`, `bim.controller.ts`, `bim.module.ts`
- `modules/notifications/` — real notifications (table+service+API)
- `modules/ai-client/` — fire-and-forget calls into `apps/ai-service`

### `apps/ifc-service` (NestJS, TypeScript) — standalone, independently deployable
Owns the entire IFC processing pipeline. Zero code dependency on
`apps/api` — communicates only via the shared `ifc-processing` Bull queue
(Redis) and directly reads/writes the shared Postgres database and object
storage. Has its own `DatabaseService`/`StorageService` (deliberately
duplicated from `apps/api`'s equivalents, not imported, to preserve
independent deployability).

Structure (see `IFC_ENGINE_RELEASE_v1.0.0.md` for full detail):
```
apps/ifc-service/src/
  main.ts, app.module.ts
  config/          — app, database, redis, storage (registerAs pattern)
  database/        — DatabaseService (withTenant/RLS pattern)
  storage/         — StorageService (S3 download/upload)
  health/          — health.controller.ts
  ifc/
    ifc-parser.service.ts       — web-ifc wrapper (hierarchy walk, per-element extraction)
    ifc-fragments.service.ts    — @thatopen/fragments wrapper
    ifc-repository.service.ts   — all Postgres writes, stage-scoped transactions
    ifc-report.service.ts       — import report builder
    job-metrics.ts              — per-stage timing/memory/count tracking
    ifc-processing.processor.ts — the Bull @Processor, orchestrates all stages
    ifc-processing.module.ts
    ifc-value.util.ts           — unwraps web-ifc's typed attribute objects
```

### `apps/web` (React + TypeScript + Vite)
The frontend. Existing (pre-IFC-work): auth pages, project list/detail,
captures, floor plan/drawings viewer, 360 photo viewer.
Added this phase: BIM model upload modal, models list (status/progress
polling), the 3D BIM viewer page (spatial tree + property panel + search),
all wired into navigation from `ProjectDetail`.

Key new files:
```
apps/web/src/
  lib/bim.api.ts                          — all BIM REST client functions
  components/BimModelUploadModal.tsx
  components/bim-viewer/
    BimViewer.tsx        — core Three.js/@thatopen canvas, imperative
                            handle: fitToModel(), selectByGuid()
    SpatialTree.tsx       — hierarchy tree UI
    PropertyPanel.tsx     — properties/quantities/materials/classifications UI
    ElementSearch.tsx     — search box, wired to viewer highlight
  pages/BimModelsPage.tsx  — list + upload + status polling
  pages/BimViewerPage.tsx  — full-bleed viewer page (tree + canvas + panel)
```

Routing (`App.tsx`): `/projects/:projectId/bim` (models list, inside
`AppShell`) and `/projects/:projectId/bim/:modelId` (full-bleed viewer,
outside `AppShell`, matching the existing 360-viewer pattern).

### `apps/ai-service` (Python FastAPI) — largely untouched this phase
Ingestion endpoints (`/ingest/capture`, `/ingest/issue`) exist and are
called fire-and-forget from `apps/api`. Search/assistant routers exist,
statically reviewed as sound, not live-verified (see Known Issues).

## Packages

### `packages/types` (`@engineeringos/types`)
Shared TypeScript types only — no runtime logic shared between apps
beyond plain constants/types. CommonJS-compiled (`tsc`). Contains the
IFC job/queue contract (`IFC_PROCESSING_QUEUE`, `IFC_PARSE_JOB_NAME`,
`IfcParseJobData`, `IFC_PROCESSING_STAGES`, `IfcImportReport`, and the
various `Ifc*Input` extraction shapes) alongside the pre-existing BIM,
capture, issue, project, user, subscription, audit, and API types.

**Important gotcha (documented as bug #7 in the RC report):** this
package is CJS-compiled but consumed by `apps/web` (a Vite/Rollup ESM
bundler) as a workspace-linked package, not a `node_modules` registry
install. Vite's default `commonjsOptions.include` only processes
`node_modules/**`, so any file importing a runtime *value* (not just a
type) from this package will fail at `vite build` time unless
`apps/web/vite.config.ts` explicitly includes the package path in
`build.commonjsOptions.include`. This is already fixed — **do not remove
that config** without understanding why it's there.

## Database architecture

Single shared PostgreSQL database, row-level security throughout, scoped
by `company_id` via `current_setting('app.current_company_id')` set per
transaction (`withTenant()` helper pattern, implemented independently in
both `apps/api`'s and `apps/ifc-service`'s `DatabaseService`).

Migrations live in `apps/api/src/database/migrations/`, numbered
sequentially, run via `apps/api`'s `run-migrations.ts` (tracks applied
files in a `_migrations` table, idempotent). IFC-related migrations:
`003_ifc_processing.sql`, `004_ifc_resumability.sql` — see
`IFC_ENGINE_RELEASE_v1.0.0.md`'s Database Schema section for the full
table-by-table breakdown (`bim_spatial_nodes`, `bim_element_quantities`,
`bim_materials`/`bim_element_materials`, `bim_element_classifications`,
`bim_element_relationships`, `bim_import_reports`, plus extended columns
on `bim_models` and `bim_elements`).

## API structure

REST, prefix `/api/v1`, JWT auth (`Authorization: Bearer <token>`), NestJS
guards (`JwtAuthGuard` → `RolesGuard`, order matters). Response envelope
convention throughout: `{ data: ..., error: ... }`. BIM endpoints
documented in full in `IFC_ENGINE_RELEASE_v1.0.0.md`'s "Public Interfaces"
section; frontend-added endpoints (`viewer-data`, `hierarchy`,
`elements/by-guid/:guid`) documented in `MASTER_BACKLOG.md`'s "BIM Viewer
(frontend)" section.

## Frontend structure

React Router, `AppShell` layout for most routes, full-bleed routes (no
sidebar chrome) for immersive viewers (360 photo viewer, BIM viewer) —
both follow the same pattern. React Query for all server state, no global
Redux-style store beyond `zustand` (used elsewhere, not by the BIM
viewer). API client convention: one `lib/<domain>.api.ts` file per
backend domain, using shared `apiGet`/`apiPost`/`apiPatch`/
`apiGetWithMeta` helpers from `lib/api.ts`.

## Services / Integrations

- PostgreSQL — shared, RLS-scoped.
- Redis — shared, backs the `ifc-processing` Bull queue (and the earlier
  `image-processing` queue for captures).
- S3-compatible object storage — shared bucket, used for original
  captures/drawings/IFC files and generated Fragments/thumbnails.
- Qdrant — vector search backend for `apps/ai-service`; confirmed
  reachable via a downloaded GitHub release binary in this sandbox
  (`dl.min.io`/MinIO direct download is blocked, but
  `release-assets.githubusercontent.com` is not).

## Data flow — the BIM upload-to-viewer path (see `IFC_ENGINE_RELEASE_v1.0.0.md` for full stage-by-stage detail)

```
Client → apps/api: request presigned upload URL
Client → S3: PUT the IFC file directly
Client → apps/api: register model (enqueues Bull job, model status=pending)
apps/ifc-service: picks up job, marks processing, runs full pipeline
apps/ifc-service: writes progress continuously to bim_models (no cross-
                  service call needed for apps/api's status endpoint)
apps/ifc-service: on completion, writes final data + Fragments to S3 +
                  import report, sets status=ready
Client → apps/api: poll status until ready
Client → apps/api: viewer-data (presigned Fragments URL) + hierarchy
Client: loads Fragments directly from S3 into the browser via
        @thatopen/components — never parses IFC in the browser
Client → apps/api: element search / element-by-guid on demand
```
