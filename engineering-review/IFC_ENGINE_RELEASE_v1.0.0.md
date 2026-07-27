# EngineeringOS IFC Processing Engine — Release v1.0.0

Status: **RELEASED — FROZEN**. This subsystem is stable. Do not modify
without a verified bug, security issue, or explicit product requirement.

---

## Executive Summary

### Purpose
Turns an uploaded IFC (BIM) file into structured, queryable data:
spatial hierarchy, element properties, quantities, materials,
classifications, and relationships — plus a viewer-ready Fragments
geometry file and a human-readable import report. This closes the "IFC
parsing is 0% implemented" gap identified in the original platform
handover.

### Scope
Everything from "user has uploaded an IFC file" to "structured data is
queryable via the API and a report exists." Does not cover: IFC
*authoring* (writing IFC back out), clash detection, or viewer UI — all
explicitly out of scope per the approved architecture proposal.

### Features delivered
- Full spatial hierarchy extraction (Site → Building → Storey → Space)
- Element extraction with arbitrary property sets
- Quantity extraction (length/area/volume/weight/count)
- Material extraction (direct materials, layer sets, material lists)
- Classification extraction (Uniclass, OmniClass, or any system a file declares)
- Relationship extraction (aggregation, spatial containment, voids, fills)
- Fragments generation (compact viewer-ready geometry)
- Structured + human-readable import reports
- Resumable, idempotent, batched, observable processing pipeline
- Status polling and reprocess API, independent of worker availability

### Architecture decisions

**Why a standalone service (`apps/ifc-service`), not embedded in `apps/api`:**
Decided explicitly (not assumed) before implementation began — see
`IFC_ARCHITECTURE_PROPOSAL.md`. Three reasons drove it:
1. **Independent deployability.** IFC parsing is CPU/memory-heavy and
   bursty (a big model can take much longer and much more memory than a
   typical API request); isolating it means it can be scaled, deployed,
   or restarted without touching the API that serves all other traffic.
2. **Blast-radius isolation.** A crash or OOM in geometry parsing takes
   down the IFC worker, not the whole API.
3. **Clean technology boundary.** `web-ifc`/`@thatopen/fragments` pull in
   browser-oriented dependencies (`three.js` types) that have nothing to
   do with the rest of the API's dependency graph.

**Why `web-ifc` over IfcOpenShell or `ifc-lite-core`:** stack fit (pure
WASM, runs natively in the same Node runtime as everything else),
license (MPL-2.0, lower legal-review friction than LGPL for a commercial
SaaS), and measured performance on large files. Full comparison table in
the architecture proposal.

**Why Bull (not BullMQ):** the rest of the platform already uses
`@nestjs/bull` (see the existing capture image-processing queue). Reusing
the same library guarantees producer (`apps/api`) and consumer
(`apps/ifc-service`) speak the exact same Redis job format.

---

## Architecture Overview

```
┌──────────────┐        ┌───────────┐        ┌──────────────────┐
│   apps/api   │──add──▶│  Redis /  │◀──take─│  apps/ifc-service │
│ (NestJS)     │  job   │   Bull    │  job   │  (NestJS worker)  │
│              │        │  queue    │        │                   │
│ orchestration│        │           │        │  web-ifc parsing  │
│ status API   │◀───────┴───────────┴───────▶│  Fragments gen    │
│ reprocess API│   both read/write bim_models │  extraction       │
└──────┬───────┘        (Postgres)            └────────┬──────────┘
       │                                                │
       ▼                                                ▼
┌──────────────┐                              ┌──────────────────┐
│  PostgreSQL  │◀─────────────────────────────│   Object Storage  │
│ (shared, RLS)│      writes hierarchy/        │  (S3/MinIO/R2)    │
│              │      elements/etc.            │  original IFC +   │
└──────────────┘                               │  Fragments output │
                                                └──────────────────┘
```

- **`apps/api`** — owns model registration, the presigned-upload flow,
  status polling, and reprocess triggering. Contains **zero** IFC parsing
  logic and has no source-level dependency on `apps/ifc-service`.
- **`apps/ifc-service`** — a separately deployable NestJS app. Owns the
  entire parse → extract → generate → report pipeline. Has its own
  `DatabaseService` and `StorageService` (deliberately duplicated, not
  imported from `apps/api`, so it can be built/deployed with zero
  reference to the other app's code).
- **Redis / Bull** — the only coupling between the two apps. `apps/api`
  calls `queue.add()`; `apps/ifc-service` has the `@Processor` that
  consumes it. Job payload shape is a shared contract in
  `packages/types/src/ifc-processing.types.ts` (imported by both, but this
  is a pure type-only shared package, not shared runtime code).
- **PostgreSQL** — shared database, both apps connect directly (not
  through each other). Row-level security scopes every query by
  `company_id`; both apps set `app.current_company_id` per-transaction via
  their respective `withTenant()` helpers.
- **Object storage (S3-compatible)** — holds the original uploaded IFC
  file and the generated Fragments file. `apps/ifc-service` downloads the
  former and uploads the latter directly.
- **`web-ifc`** — parses the IFC/STEP file, exposes the spatial structure
  tree and per-entity attribute/property/quantity/material access.
- **`@thatopen/fragments`** (`IfcImporter`) — runs its own internal
  `web-ifc` instance to convert the file into the compact Fragments binary
  format for efficient viewer delivery.

### Complete processing flow (upload → completed import)
1. Client requests a presigned upload URL from `apps/api`
   (`POST .../bim/models/upload-url`).
2. Client `PUT`s the IFC file bytes directly to object storage.
3. Client calls `POST .../bim/models` with the storage key. `apps/api`
   inserts a `bim_models` row (`status: pending`) and enqueues a Bull job
   containing `{modelId, companyId, projectId, storageKey}`.
4. `apps/ifc-service`'s `IfcProcessingProcessor` picks up the job, marks
   the model `processing`, and runs the pipeline (see "Processing
   Pipeline" below).
5. Throughout, `apps/ifc-service` writes progress (`processing_stage`,
   `processing_progress`) directly to `bim_models` — `apps/api`'s status
   endpoint reads this with **no cross-service call**, so status polling
   works even if the worker is temporarily down or busy.
6. On completion, `apps/ifc-service` writes final counts, timing, memory,
   warnings, the Fragments storage key, and a full import report row, and
   sets `status: ready` (or `failed`, with a stored error).

---

## Folder Structure

```
apps/ifc-service/
├── .env.example / .env.local      Environment configuration
├── nest-cli.json, .swcrc,
│   tsconfig.json                  Build configuration (mirrors apps/api)
├── package.json                   Dependencies (web-ifc, @thatopen/fragments,
│                                   @nestjs/bull, postgres, @aws-sdk/client-s3)
├── test-fixtures/                 Real IFC sample files used for verification
│   ├── IfcOpenHouse_IFC4.ifc      Original public sample (Site/Building/
│   │                              Storey/Walls/Roof, no Psets/Qtos)
│   ├── IfcOpenHouse_augmented.ifc Same file + hand-appended valid STEP
│   │                              entities (Pset, Qto, Classification) —
│   │                              exercises every extraction code path
│   └── empty_model.ifc            Minimal valid IFC4 file, IfcProject only,
│                                   no hierarchy/elements — resilience fixture
└── src/
    ├── main.ts                    Bootstrap: starts Nest app (health HTTP +
    │                              Bull worker in the same process)
    ├── app.module.ts               Root module — wires config, DB, storage,
    │                              Bull connection, and the IFC module
    ├── config/                    One file per config domain (app, database,
    │                              redis, storage) — registerAs() pattern,
    │                              same env var names as apps/api
    ├── database/
    │   ├── database.module.ts     Global module, provides the raw postgres.js
    │   │                          connection ('PG_CONNECTION')
    │   └── database.service.ts    withTenant()/withTransaction() helpers —
    │                              same RLS pattern as apps/api, independently
    │                              implemented (no shared code)
    ├── storage/
    │   ├── storage.module.ts      Global module
    │   └── storage.service.ts     S3 download (IFC bytes) + upload
    │                              (Fragments), path-style S3 client
    ├── health/
    │   └── health.controller.ts   GET /health — DB connectivity check, for
    │                              cloud health checks / independent deploy
    └── ifc/                        The engine itself
        ├── ifc-value.util.ts       Unwraps web-ifc's typed attribute value
        │                          objects into plain JS values
        ├── ifc-parser.service.ts   web-ifc wrapper: model open/close,
        │                          spatial tree walk, per-element property/
        │                          quantity/material extraction, global
        │                          classification/void/fill queries
        ├── ifc-fragments.service.ts @thatopen/fragments wrapper
        ├── ifc-repository.service.ts All Postgres writes — stage-scoped
        │                          atomic transactions, batch inserts
        ├── ifc-report.service.ts   Builds the structured + text import report
        ├── job-metrics.ts          Per-job stage timing / peak memory /
        │                          element counts / structured log lines
        ├── ifc-processing.processor.ts  The Bull @Processor — orchestrates
        │                          every stage in order
        └── ifc-processing.module.ts     Registers the Bull consumer queue
                                   + all IFC providers
```

### Module responsibilities, one line each
- `IfcParserService` — the only place that touches `web-ifc` directly.
- `IfcFragmentsService` — the only place that touches `@thatopen/fragments`.
- `IfcRepositoryService` — the only place that writes to IFC-related tables.
- `IfcReportService` — pure function: inputs in, report text/object out.
- `JobMetrics` — observability only; no side effects on the pipeline's data.
- `IfcProcessingProcessor` — orchestration only; delegates all real work.

---

## Public Interfaces

### REST endpoints (all under `apps/api`, prefix `/api/v1`)
| Method | Path | Purpose |
|---|---|---|
| `POST` | `/projects/:projectId/bim/models/upload-url` | Get a presigned S3 upload URL + storage key |
| `POST` | `/projects/:projectId/bim/models` | Register a model after upload; enqueues parsing |
| `GET`  | `/projects/:projectId/bim/models/:modelId/status` | Poll status/progress/error (no cross-service call) |
| `POST` | `/projects/:projectId/bim/models/:modelId/reprocess` | Re-queue a failed/stuck model without re-uploading |

`status` response shape:
```json
{
  "data": {
    "id": "uuid", "status": "pending|processing|ready|failed",
    "processingStage": "extracting_hierarchy", "processingProgress": 45,
    "processingError": null, "elementCount": 40, "parsedAt": null
  },
  "error": null
}
```

### Queue messages (Bull, queue name `ifc-processing`)
Job name: `parse-ifc`. Payload (`IfcParseJobData` in
`packages/types`):
```ts
{ modelId: string; companyId: string; projectId: string; storageKey: string }
```
Job id: `${modelId}:${timestamp}` — unique per enqueue (see Release Notes
for why this matters). `defaultJobOptions`: 3 attempts, exponential
backoff starting at 10s, last 100 completed/failed jobs retained.

### Database interactions
See "Database Schema" below for full table list. All writes go through
`IfcRepositoryService`; all reads for status go through `apps/api`'s
`BimService` reading `bim_models` directly.

### Storage interactions
- Original file: downloaded once per job attempt from the `storageKey`
  provided at registration.
- Fragments: uploaded to
  `{companyId}/bim-fragments/{projectId}/{modelId}.frag`.

### Configuration / environment variables (`apps/ifc-service`)
| Variable | Default | Purpose |
|---|---|---|
| `PORT` | 3100 | Health HTTP port |
| `DB_HOST`/`DB_PORT`/`DB_NAME`/`DB_USER`/`DB_PASSWORD`/`DB_SSL` | localhost/5432/engineeringos/postgres/postgres/false | Postgres connection (must match `apps/api`'s DB) |
| `REDIS_HOST`/`REDIS_PORT` | localhost/6379 | Must match `apps/api`'s Redis |
| `S3_ENDPOINT`/`S3_REGION`/`S3_ACCESS_KEY_ID`/`S3_SECRET_ACCESS_KEY`/`S3_BUCKET` | localhost:9000/us-east-1/minioadmin/minioadmin/engineeringos | Must match `apps/api`'s bucket |

---

## Database Schema

Two migrations, both idempotent (`IF NOT EXISTS` / `ON CONFLICT DO
NOTHING` throughout): `003_ifc_processing.sql`, `004_ifc_resumability.sql`.

| Table | Purpose | Key relationships | Indexes |
|---|---|---|---|
| `bim_models` (extended) | Tracks one uploaded model + its processing state | `project_id → projects`, `uploaded_by → users` | existing |
| `bim_spatial_nodes` | IFC-native Site/Building/Storey/Space tree | `model_id → bim_models`, self-referencing `parent_id` | `(model_id)`, `(parent_id)` |
| `bim_elements` (extended) | Every non-spatial IFC entity (walls, doors, MEP, etc.) | `model_id → bim_models`, `spatial_node_id → bim_spatial_nodes` | `(spatial_node_id)`, existing `(model_id, ifc_guid)` unique |
| `bim_element_quantities` | IfcElementQuantity values | `element_id → bim_elements` | `(element_id)` |
| `bim_materials` / `bim_element_materials` | Materials + element↔material links | `model_id → bim_models`; join table | `(model_id, name)` unique |
| `bim_element_classifications` | Classification system/code/name per element | `element_id → bim_elements` | `(element_id)` |
| `bim_element_relationships` | Aggregation/containment/void/fill edges, stored **by GUID** (not FK'd), since either side can be an element or a spatial node | `model_id → bim_models` | `(model_id)`, `(relating_guid)`, `(related_guid)` |
| `bim_import_reports` | One row per completed/failed import attempt | `model_id → bim_models` | `(model_id, generated_at)` |

All tables have row-level security matching the existing tenant-isolation
pattern (`company_id = current_setting('app.current_company_id')`).

### Resume mechanism (on `bim_models`)
- `stage_completion` (jsonb) — one boolean flag per pipeline stage. Set
  **inside the same transaction** as that stage's data writes, so a flag
  can only be true if its data genuinely committed.
- `processing_stage` / `processing_progress` — live-updated for polling,
  independent of the resume mechanism.
- `attempt_count`, `started_at`, `completed_at`, `duration_ms`,
  `peak_memory_bytes`, `elements_skipped`, `warnings` — observability.

**Important implementation detail:** `stage_completion` keys are read back
camelCase by the Postgres driver's transform regardless of how they're
written (a jsonb-value quirk, not a column-naming one) — `isStageComplete()`
converts the stage name to camelCase before lookup to account for this.
See Release Notes bug #5 for why this matters and how it was found.

---

## Processing Pipeline

Executed in this exact order by `IfcProcessingProcessor.handle()`:

1. **Upload** — handled entirely by `apps/api` + client, before a job ever exists.
2. **Queue** — `apps/api` enqueues; `apps/ifc-service` is the sole consumer.
3. **Parse** — `web-ifc` opens the model from downloaded bytes; malformed
   files fail here with a readable error (verified).
4. **Spatial hierarchy** — one recursive walk of `getSpatialStructure()`
   builds the Site→Building→Storey→Space tree AND simultaneously derives
   aggregation/containment relationships (same walk, not a second pass).
5. **Elements** — every non-spatial node from the walk becomes a
   `bim_elements` row, batched (200/batch) to bound memory.
6. **Properties** — per-element Pset key/value pairs, extracted in the
   same batch pass as elements (one web-ifc read per element, not three).
7. **Quantities** — `IfcElementQuantity` values, same batch pass.
8. **Materials** — direct material / layer set / material list, same batch pass.
9. **Classifications** — one global query for
   `IfcRelAssociatesClassification`, resolved against already-inserted
   element ids.
10. **Relationships** — aggregates + contained-in-structure (from the tree
    walk) plus voids/fills (one more global query), stored by GUID.
11. **Fragments** — `@thatopen/fragments` converts the file to a compact
    binary, uploaded to storage. **Failure here is a warning, not a job
    failure** — the structured data is already safely persisted by this
    point, and a viewer-convenience file failing shouldn't undo that.
12. **Report generation** — structured (`bim_import_reports.report_json`)
    and human-readable (`report_text`) versions, in the exact format
    requested, logged and persisted.
13. **Completion** — `bim_models.status = 'ready'` (or `'failed'`, with
    `processing_error` set, on any unhandled exception — Bull's
    attempts/backoff then governs automatic retry).

### Failure handling and resume
- Any exception outside the per-element `try/catch` in stage 5-8 fails
  the whole job: `status = 'failed'`, error stored, a FAILED report is
  still generated, Bull retries per its backoff policy.
- A per-element exception during extraction is caught individually — that
  element is recorded as **skipped** (counted, logged, included in the
  report's warnings), and the batch continues. One bad element never
  fails the whole model.
- On any retry (automatic via Bull, or manual via the reprocess endpoint),
  each stage checks `stage_completion` first and **skips stages already
  committed**, re-running only from the first incomplete stage onward —
  verified live (see Resilience section).

---

## Resilience

All verified live against real Postgres + Redis + a local S3-compatible
server, not reviewed in the abstract.

| Scenario | Verified behavior |
|---|---|
| **Malformed IFC** | Clean `status: failed`, readable error, **zero** rows written to any extraction table, empty `stage_completion` — no partial state. |
| **Empty IFC** | Valid file with only `IfcProject`, no hierarchy/elements → `status: ready`, `element_count: 0`, no crash. |
| **Duplicate upload** | Same file registered as two separate models → both process independently and identically; no collision (each gets its own unique job id and model id). |
| **Interrupted processing** | Manually marked a stage complete mid-flight, then triggered reprocess → log-confirmed the stage was **skipped**, remaining stages ran normally, element count stayed correct (no duplication), final `stage_completion` accurately reflects what actually ran. |
| **Reprocessing (idempotency)** | Reprocessed an already-`ready` model twice in a row → identical element and relationship counts both times. |

---

## Performance

### Observed (against the ~40-element test fixture — see Known Limitations for scale caveats)
- Full pipeline duration: ~1–2 seconds
- Peak RSS: ~210–240MB (dominated by the Node/Nest/web-ifc/WASM baseline,
  not by this specific small file)
- Fragments output: ~16KB for a 40-element model

### Memory strategy
- Elements are extracted and written in **fixed batches of 200**, so JS
  heap usage for element data is bounded by batch size, not total model
  size — the batch's arrays are discarded after each batch's DB write.
- The one unavoidable exception: `web-ifc` itself opens the entire file
  into WASM memory to parse it at all — no evaluated library (see
  architecture proposal) supports true streaming parse of arbitrary IFC.
  This is a real, documented constraint of the chosen technology, not an
  oversight.

### Batch strategy
- 200 elements/batch for extraction+insert.
- Classification/relationship queries are global (one pass), justified
  because these relationship counts are typically far smaller than
  element counts for realistic models.

### Expected scalability
- Designed for models up to the low hundreds of thousands of elements
  without architectural changes, given the batching approach.
- Multi-GB files: architecturally reasoned about (see proposal), but
  **not empirically load-tested** — no such fixture was obtainable in
  this development sandbox. This is the single most important thing to
  validate before a production launch with real-world large models.

### Known limits
- Stage-level (not element-level) resume — a crash mid-stage re-does that
  whole stage, not just the unfinished portion of it. Safe (idempotent)
  but not minimal-cost for a very large model's properties stage.

---

## Production Deployment Guide

### Required services
- PostgreSQL (shared with `apps/api`, same database)
- Redis (shared with `apps/api`, same instance/cluster)
- S3-compatible object storage (shared with `apps/api`, same bucket)

### Environment variables
See "Configuration" table above. Production values should point at real
managed Postgres/Redis/S3 (or MinIO/R2), not the `localhost` dev defaults.

### Build
```bash
cd apps/ifc-service
pnpm install --filter ifc-service...
pnpm --filter ifc-service run build   # nest build (SWC)
```

### Deployment
Runs as a standard Node process (`node dist/main.js`) exposing one HTTP
port (health check only) and consuming from the shared Bull queue.
Containerize identically to `apps/api` (same Node version, same build
tooling). No inbound traffic is expected on its HTTP port other than
health checks — it does not need to be behind the public-facing API
gateway/load balancer's main routing rules, only an internal health-check
path.

### Scaling recommendations
- Horizontal: run multiple instances — Bull distributes jobs across
  connected consumers automatically; the job-id scheme (unique per
  enqueue) and stage-level idempotency make concurrent-safe processing
  straightforward.
- Vertical: memory is the constraining resource for large files (see
  Performance); size instances according to the largest IFC file the
  business expects to support, with headroom above the baseline ~200MB.

### Monitoring
- `GET /health` — liveness/readiness (checks DB connectivity).
- Structured JSON log lines for `job_start`, `stage_start`, `stage_end`,
  `element_skipped`, `job_end` — every line includes `modelId`, so logs
  are filterable per-import in any log aggregator.
- `bim_models.status = 'failed'` + `processing_error` — the primary
  signal for alerting; consider a poll/alert on failed-status counts.

### Logging
All logging goes through NestJS's `Logger` (no raw `console.*` calls
anywhere in the service — verified via repository-wide search as part of
the release audit).

### Backups
Standard Postgres backup practice covers all IFC engine tables (no
special handling needed — they're ordinary tables in the shared
database). Object storage (original files + Fragments) should follow
whatever backup/versioning policy applies to the rest of the platform's
uploaded files.

### Recovery
A model stuck in `processing` (e.g., after an infrastructure-level
crash rather than a clean job failure) can be recovered via the
`reprocess` endpoint — it resets status without touching
`stage_completion`, so already-completed stages are skipped and only the
remaining work re-runs.

---

## Operational Runbook

**Start the service:**
```bash
cd apps/ifc-service && node dist/main.js
```
Requires Postgres, Redis, and object storage all reachable first.

**Monitor jobs:**
- Poll `GET /projects/:projectId/bim/models/:modelId/status` for a
  specific model, or query `bim_models` directly for a fleet view:
  `SELECT status, count(*) FROM bim_models GROUP BY status;`

**Investigate a failure:**
1. `SELECT processing_error FROM bim_models WHERE id = '<modelId>';`
2. `SELECT report_text FROM bim_import_reports WHERE model_id =
   '<modelId>' ORDER BY generated_at DESC LIMIT 1;` for the full report
   including warnings.
3. Search logs for `"modelId":"<modelId>"` for the complete stage-by-stage
   timeline.

**Reprocess a model:**
```
POST /projects/:projectId/bim/models/:modelId/reprocess
```
Safe to call repeatedly; already-completed stages are skipped.

**Recover an interrupted import:** same as reprocess — no special
procedure needed. `stage_completion` ensures only incomplete work re-runs.

---

## Known Limitations

### Current limitations (verified, real)
- Stage-level, not element-level, resume granularity.
- No empirical test against a true multi-GB IFC file.
- Fragments failures degrade to a warning rather than raising an alert by
  themselves — a systematically broken Fragments pipeline needs someone
  to notice via warnings, not an automatic page.
- Only IFC4 tested directly; IFC2x3 is expected to work (`web-ifc`
  supports both, extraction code doesn't assume schema version) but is
  unverified against a real IFC2x3 sample.

### Future improvements
- Batch-level (not just stage-level) checkpointing within the properties
  stage, for very large models where redoing an entire stage after a
  late-stage crash would be costly.
- Alerting hook on repeated Fragments failures.
- Explicit IFC2x3 regression fixture.

### Nice-to-have enhancements
- Parallel processing across multiple workers for a single large model
  (currently one job = one worker = sequential batches; the batching
  structure was designed to make this feasible later without an
  architectural rewrite, but it isn't implemented now).
- A dedicated monitoring dashboard for import throughput/failure rates.

---

## Release Notes — v1.0.0

### Features delivered
Full IFC parsing pipeline: hierarchy, elements, properties, quantities,
materials, classifications, relationships, Fragments generation, and
import reporting — running as an independently deployable service,
orchestrated (not executed) by `apps/api`.

### Bugs fixed during verification (all found via a failing test, then fixed, then re-verified passing)
1. Postgres bulk-insert misuse (`SELECT ... FROM ${sql(rows, cols)}` is
   not valid postgres.js usage) — caused a hard crash on the first batch.
2. Missing required `project_id` column in element inserts.
3. camelCase/snake_case mismatch reading back `RETURNING` results —
   silently dropped quantities/materials/classifications past the first
   element in a batch.
4. Bull job-id reuse across reprocess attempts — silently no-op'd re-runs
   of already-completed jobs.
5. jsonb key-casing on `stage_completion` — resume-skip logic never
   actually triggered until fixed (stages redid unnecessarily, though
   safely).

Plus one defect found during the final release audit itself:
6. `report_json` was being persisted as an empty `{}` — the structured
   report object was built but discarded before being saved. Fixed;
   verified `report_json` now contains the full structured report.

Two unused type definitions (`ParsedElementBatch`, `IfcProcessingProgress`)
were found and removed during the release audit — dead code left over
from earlier design iterations, confirmed via repository-wide search
before removal.

### Verification completed
Full happy-path pipeline (twice, no regression), all 5 resilience
scenarios (malformed/empty/duplicate/interrupted-resume/idempotent
reprocessing), all passing against real Postgres, Redis, and a local
S3-compatible server. Full detail in `MASTER_BACKLOG.md`.

### Breaking changes
None — this is new functionality; no existing endpoints or schemas were
altered in an incompatible way (`bim_models` was extended with new
nullable/defaulted columns only).

### Migration requirements
Run `003_ifc_processing.sql` and `004_ifc_resumability.sql` (via the
existing `pnpm db:migrate` runner) before deploying this version. Both
are idempotent and safe to run against a database that already has them
applied.
