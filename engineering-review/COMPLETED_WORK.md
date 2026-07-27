# EngineeringOS — COMPLETED_WORK.md

Specific, not summarized. Organized by feature.

---

## Feature: IFC Processing Engine v1.0.0 (RELEASED, FROZEN)

### Completed
- `apps/ifc-service/` created from scratch as a standalone NestJS app
  (own `package.json`, `nest-cli.json`, `.swcrc`, `tsconfig.json`,
  `.env.local`/`.env.example`).
- `src/config/{app,database,redis,storage}.config.ts` — `registerAs()`
  pattern matching `apps/api`'s conventions.
- `src/database/{database.module.ts,database.service.ts}` — independent
  postgres.js connection + `withTenant()`/`withTransaction()` helpers.
- `src/storage/{storage.module.ts,storage.service.ts}` — S3 download
  (original IFC) + upload (Fragments), path-style client.
- `src/health/health.controller.ts` — `GET /health`.
- `src/ifc/ifc-value.util.ts` — unwraps web-ifc's typed attribute value
  objects (`{value}`, `{_representationValue}`) into plain JS values;
  `extractQuantityValue()` for the 6 IFC quantity subtypes.
- `src/ifc/ifc-parser.service.ts` — `openModel()` (with malformed-file
  error handling), `walkHierarchy()` (single tree walk producing spatial
  nodes + element skeletons + aggregates/contained-in-structure
  relationships together), `getVoidsAndFills()`, `getClassifications()`,
  `extractElement()` (per-element properties+quantities+materials in one
  pass).
- `src/ifc/ifc-fragments.service.ts` — wraps `@thatopen/fragments`'
  `IfcImporter`.
- `src/ifc/ifc-repository.service.ts` — all Postgres writes:
  `runStage()` (atomic stage + `stage_completion` flag), batch insert
  methods for elements/quantities/materials/classifications/
  relationships, `finalize()`, `saveReport()`.
- `src/ifc/ifc-report.service.ts` — builds the exact requested report
  format (duration, peak memory, element/hierarchy/object counts,
  warnings/errors, extraction counts, Fragments status).
- `src/ifc/job-metrics.ts` — per-stage timing, peak RSS memory tracking,
  element processed/skipped counts, structured JSON log lines.
- `src/ifc/ifc-processing.processor.ts` — the Bull `@Processor`,
  orchestrates all 11 pipeline stages in order, batches elements 200/
  batch, checks `stage_completion` to skip already-done stages on resume.
- Migrations: `apps/api/src/database/migrations/003_ifc_processing.sql`
  (tracking columns + 6 new tables), `004_ifc_resumability.sql`
  (`stage_completion`, timing/memory columns, `bim_import_reports` table).
- `apps/api/src/modules/bim/{bim.service.ts,bim.module.ts,bim.controller.ts}`
  extended: `registerModel()` now enqueues a real Bull job (unique job id
  per attempt — see bug #4 below), plus `getModelStatus()`,
  `reprocessModel()`, `getModelViewerData()`, `getHierarchy()`,
  `getElementByGuid()`, and `getElement()` enriched with quantities/
  materials/classifications.
- `packages/types/src/ifc-processing.types.ts` — the full job/progress/
  extraction-input contract shared (as types only) between `apps/api` and
  `apps/ifc-service`.
- Test fixtures: `apps/ifc-service/test-fixtures/{IfcOpenHouse_IFC4.ifc,
  IfcOpenHouse_augmented.ifc, empty_model.ifc}` — real IFC files, one
  hand-augmented with valid STEP entities (Pset/Qto/Classification) to
  exercise every extraction code path.
- Documentation: `engineering-review/IFC_ARCHITECTURE_PROPOSAL.md`
  (pre-implementation architecture comparison, approved before coding),
  `engineering-review/IFC_ENGINE_RELEASE_v1.0.0.md` (full release doc:
  architecture, folder structure, public interfaces, schema, pipeline,
  resilience, performance, deployment guide, runbook, known limitations).

### Bugs fixed (all found via a failing test first, not assumed)
1. Postgres bulk-insert misuse (`INSERT ... SELECT ... FROM ${sql(rows,
   cols)}` is invalid postgres.js usage) — fixed across 5 repository
   methods to use the documented `INSERT INTO table ${sql(rows, cols)}`
   form.
2. Missing required `project_id` column in `insertElementsBatch`.
3. camelCase/snake_case mismatch reading `RETURNING` results (`row.ifc_guid`
   vs. actual `row.ifcGuid` from the `postgres.camel` transform) — silently
   dropped quantities/materials/classifications past the first element in
   a batch. Fixed in 3 call sites.
4. Bull job-id reuse (`jobId: modelId`) silently no-op'd reprocess
   requests once the original job had completed (Bull treats job id as a
   lifetime dedup key). Fixed: unique `${modelId}:${timestamp}` per
   enqueue.
5. jsonb key-casing on `stage_completion` — postgres.js's camel transform
   rewrites jsonb *value* keys too, not just column names, so
   `isStageComplete()` was checking the wrong casing and resume-skip never
   actually triggered (safe, but not actually resuming). Fixed with a
   `toCamelKey()` conversion matching postgres.js's own `toCamel()`.
6. `report_json` was persisted as an empty `{}` — the structured report
   object was built then discarded. Fixed; verified non-empty.
   Also removed 2 unused type definitions found via repo-wide search
   during the release audit (`ParsedElementBatch`, `IfcProcessingProgress`).

### Verified
- Full happy-path pipeline, twice (no regression across fixes).
- 5 resilience scenarios: malformed IFC, empty model, duplicate upload,
  interrupted/resumed processing, repeated reprocessing — all passing,
  including live log evidence that resume-skip actually skips completed
  stages (not just claims to).
- All verified against real Postgres, Redis, and a local S3-compatible
  server (`s3rver`, standing in for MinIO since `dl.min.io` is blocked in
  this sandbox).

---

## Feature: BIM Viewer (frontend)

### Completed
- `apps/web/src/lib/bim.api.ts` — full REST client module: `listBimModels`,
  `getModelUploadUrl`, `registerBimModel`, `uploadBimModel` (combines
  upload+register), `getModelStatus`, `reprocessModel`,
  `getModelViewerData`, `getModelHierarchy`, `getElement`,
  `getElementByGuid`, `listElements`, `updateElementStatus`.
- `apps/web/src/components/BimModelUploadModal.tsx` — drag/drop IFC
  upload, per-file progress, mirrors the existing `CaptureUploadModal`
  pattern.
- `apps/web/src/components/bim-viewer/BimViewer.tsx` — core 3D viewer:
  `@thatopen/components` `Components`/`Worlds`/`SimpleScene`/
  `OrthoPerspectiveCamera`/`SimpleRenderer`, `@thatopen/fragments` model
  loading, click-to-select with highlight, `fitToModel()` and
  `selectByGuid()` exposed via `forwardRef`/`useImperativeHandle`.
- `apps/web/src/components/bim-viewer/SpatialTree.tsx` — builds a nested
  tree from the flat `bim_spatial_nodes` API response, click to select.
- `apps/web/src/components/bim-viewer/PropertyPanel.tsx` — renders
  element attrs, properties, quantities, materials, classifications.
- `apps/web/src/components/bim-viewer/ElementSearch.tsx` — search box,
  results click through to both the property panel and a 3D highlight
  via `BimViewer`'s `selectByGuid`.
- `apps/web/src/pages/BimModelsPage.tsx` — list, upload trigger, live
  status/progress polling (`refetchInterval` while any model is pending/
  processing), retry-on-failure.
- `apps/web/src/pages/BimViewerPage.tsx` — full-bleed layout: spatial
  tree (left) + 3D viewer (center) + property panel (right) + search in
  the toolbar.
- Routing added to `App.tsx`: `/projects/:projectId/bim` (inside
  `AppShell`), `/projects/:projectId/bim/:modelId` (full-bleed, outside
  `AppShell`).
- Nav link added in `ProjectDetail.tsx` ("BIM models" button).
- Backend additions supporting the above: `getModelViewerData()`,
  `getHierarchy()`, `getElementByGuid()` in `bim.service.ts`/
  `bim.controller.ts`; `getElement()` enriched with quantities/materials/
  classifications.
- `apps/web/package.json` — added `@thatopen/components@3.4.7`,
  `@thatopen/fragments@3.4.6`, `camera-controls@^3.1.2`,
  `web-ifc@0.0.77`; upgraded `three` from `^0.169.0` to `^0.182.0` (peer
  requirement of `@thatopen/components`).

### Bugs fixed
7. **Vite/Rollup CJS interop gap (pre-existing, not introduced this
   phase)** — `vite build` failed for the whole app once any file
   imported a runtime value from `@engineeringos/types`, because Vite's
   default `commonjsOptions.include` only targets `node_modules/**`,
   excluding workspace-linked packages. Fixed in `apps/web/vite.config.ts`
   by adding `build.commonjsOptions.include: [/node_modules/,
   /packages\/types/]`. **This was blocking any production build of the
   entire web app**, not just BIM code.
8. **Untyped-null Postgres parameter** in `BimService.getElements()` —
   bare `${x ?? null} IS NULL` checks with no cast on `modelId`/
   `ifcType`/`levelId`/`constructionStatus`/`search` filters. Postgres
   can't infer a type from `IS NULL` alone, so the query failed at the
   planning stage for *any* call (not just when a filter was null). Fixed
   with explicit casts on every bare occurrence.
- Also found (mid-implementation, before it ever ran): `@thatopen/
  components` re-declares its own `ModelIdMap` type separately from
  `@thatopen/fragments`' (pnpm resolves two physical instances of the
  fragments package, peer-resolved against two different `three`
  versions) — fixed by never importing `@thatopen/fragments` types
  directly in `BimViewer.tsx`, using only `OBC.*` (the components
  package's own re-exports).

### Verified
- `tsc --noEmit`: clean, both apps, after every change.
- `vite build` (production): clean, confirmed multiple times including
  through both bug fixes above.
- `vite` dev server: confirmed serving and transforming every new source
  file without error (HTTP 200 through the module graph for `main.tsx`,
  `App.tsx`, `BimViewerPage.tsx`, `BimModelsPage.tsx`, `BimViewer.tsx`).
- **Every REST endpoint the new pages call**, verified live against a
  real processed model: `listBimModels`, `getModelViewerData` (confirmed
  `status: ready` + a real presigned Fragments URL that was independently
  fetched and returned HTTP 200), `getModelHierarchy` (confirmed correct
  3-node spatial tree), `getElementByGuid` (confirmed 127 property keys +
  2 quantities + 1 material + 1 classification, matching the source file
  exactly, including correct handling of a GUID containing a literal `$`
  character), and element search (confirmed correct results across three
  filter combinations after bug #8's fix).
- **NOT verified: actual browser rendering/interaction.** No browser or
  screenshot tool is available in this environment. Stated explicitly in
  every relevant document rather than assumed passing.

---

## Feature: Notifications (real, replacing an earlier fake stub)

### Completed
- Migration `002_notifications.sql` — `notifications` table, RLS.
- `apps/api/src/modules/notifications/{notifications.service.ts,
  notifications.controller.ts,notifications.module.ts}` — create, list
  (paginated, unread-only filter), unread count, mark-read, mark-all-read.
- Wired into `IssuesService.create()` and `IssuesService.update()`
  (initial assignment and reassignment both notify).

### Verified
- Live: invited a second user, accepted invitation, created an issue
  assigned to them, confirmed the notification row, polled
  `GET /notifications` and `/unread-count` as that user, marked read,
  confirmed idempotent re-mark (no error, no double-update).

---

## Release Candidate Verification (this phase's final activity)

Full RC report: `engineering-review/RC_VERIFICATION_REPORT_v0.1.md`.
Verified the complete workflow (13 steps, login through properties
display) end to end with real data. Zero critical/major/minor bugs open.
Deployment guide and release checklist included in that document.
