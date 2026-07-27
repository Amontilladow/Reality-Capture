# EngineeringOS Reality Capture — Master Backlog

**EngineeringOS v0.1 Release Candidate: VERIFIED.** Full RC verification
(workflow PASS/FAIL matrix, subsystem checks, deployment guide, release
checklist) is in `engineering-review/RC_VERIFICATION_REPORT_v0.1.md`. Zero
critical/major bugs open. One real gap: no browser-level visual
verification was possible in this environment (no browser tool) — flagged
explicitly there, not assumed passing.

**IFC Processing Engine: RELEASED v1.0.0, FROZEN.** Full release
documentation (architecture, schema, pipeline, resilience, deployment,
runbook, known limitations) is in
`engineering-review/IFC_ENGINE_RELEASE_v1.0.0.md`. Do not modify this
subsystem without a verified bug/security issue or explicit product
requirement — see that document before touching anything under
`apps/ifc-service`.

Read this file first, every session. Continue from the highest-priority
unfinished task. Update it before any commit; commit the code and this
file together.

No `/docs` directory exists in this repo. This backlog is built from the
locked Architecture Specification v1.1 (referenced in the original
continuation prompt but not included in the handover zip) and the
documented scope carried forward session to session. Anything not
traceable to a stated requirement is flagged **[unscoped — needs product
decision]** rather than built speculatively.

**Overall completion (business workflows toward v1.0): ~80%.**
Core tenancy/auth/hierarchy/issues/documents/timeline/notifications AND
the full IFC Processing Engine are done and verified. Remaining gap:
Reality Capture (image) processing, AI search live verification
(environment-blocked, not code), and export.

---

## Completed features (frozen — do not revisit without a real bug/security/
perf issue found)

- Company registration → login → project → building → level → location
  chain
- Auth (JWT + roles) + rate limiting
- Subscription limit enforcement (projects + users)
- Audit logging (correct action names)
- Issue creation/assignment/reassignment, invitations, role permissions
- Document creation/linking, timeline entries, hierarchy fetch, capture
  listing/filtering
- AI ingestion wired into issue creation (fire-and-forget, verified
  non-blocking when AI service is down)
- Real notifications (table + service + polling API), replacing the old
  "Phase 2" log-only stub. Verified live: assign → notification row →
  poll → mark read → idempotent re-mark.
- **IFC Processing Engine — fully implemented and verified this session.**
  See dedicated section below.

## IFC Processing Engine — COMPLETE ✅

### Architecture (approved before implementation)
Full comparison in `engineering-review/IFC_ARCHITECTURE_PROPOSAL.md`.
Chosen: `web-ifc` (parsing) + `@thatopen/fragments` (viewer-ready geometry),
run inside a **new standalone app, `apps/ifc-service`** — not embedded in
`apps/api` — per explicit architectural direction to keep IFC processing
independently deployable. `apps/api` is orchestration-only: it registers
the model, enqueues a job, and exposes status/reprocess endpoints; it owns
no parsing logic and has no code dependency on `apps/ifc-service`.

Queue: existing Bull (`@nestjs/bull`) architecture, not BullMQ — both
producer (`apps/api`) and consumer (`apps/ifc-service`) share the same
Redis-backed queue (`ifc-processing`), same library, so job data is
guaranteed compatible on both sides.

### What it does (all extracted, all verified against real data)
- Parses IFC (STEP/IFC4) files
- Extracts full spatial hierarchy: Site → Building → Storey → Space →
  Elements, into `bim_spatial_nodes`
- Extracts element properties (arbitrary Pset key/value pairs) into
  `bim_elements.properties` (jsonb)
- Extracts quantities (`IfcElementQuantity` — length/area/volume/weight/
  count) into `bim_element_quantities`
- Extracts materials (handles direct material, layer sets, and material
  lists) into `bim_materials` / `bim_element_materials`
- Extracts classifications (`IfcRelAssociatesClassification`, e.g.
  Uniclass/OmniClass) into `bim_element_classifications`
- Extracts relationships — aggregates, contained-in-structure (both
  derived from the same spatial tree walk that builds the hierarchy, so
  they're guaranteed consistent with it), plus voids/fills (openings,
  doors/windows) from a direct global query — into
  `bim_element_relationships`
- Generates Fragments (compact viewer-ready binary) and uploads it to
  object storage alongside the original file
- Produces the exact `IFC Import Report` format requested (duration, peak
  memory, element/hierarchy/object counts, warnings/errors, extraction
  counts, Fragments status), stored in `bim_import_reports` and logged
- Reports live progress/stage back to `apps/api` via `bim_models`
  (polling-friendly, no cross-service call needed for status reads)

### Reliability/resumability design (documented, not just claimed)
Processing is broken into ordered stages (`IFC_PROCESSING_STAGES` in
`packages/types`). Each stage's DB writes happen in **one transaction**
that clears that stage's prior output for the model and sets
`bim_models.stage_completion['<stage>'] = true` in the same transaction —
so a stage is atomic: it either fully landed or didn't happen at all.
Retries/resumes check `stage_completion` and skip any stage already
marked done. This is **stage-level resume, not element-level** — a crash
mid-stage redoes that whole stage from scratch (safe/idempotent, not
always minimal-cost for a huge model) — documented as a real, honest
scope limit, not oversold.
`downloading`/`parsing` always re-run every attempt (cheap, side-effect-
free, not tracked in `stage_completion`).
Property/quantity/material extraction is combined into one per-element
pass (not three) — real per-element web-ifc reads are the expensive part;
doing it once instead of three times is a genuine efficiency win, and the
three stage labels are preserved for progress-reporting granularity only.
Elements are processed and written in fixed batches (200/batch) so memory
stays bounded by batch size, not total model size — the realistic
scalability lever available given web-ifc's synchronous, whole-file-open
API (see architecture proposal for why streaming parse isn't available
from any evaluated library).

### Bugs found and fixed during verification (all confirmed via a failing
test first, then a fix, then a passing re-test — not assumed)
1. **Postgres bulk-insert misuse** — `INSERT INTO x SELECT ... FROM
   ${sql(rows, cols)}` is not valid usage of postgres.js's bulk-insert
   helper (it emits a full `(cols) VALUES (...)` clause, not something
   usable as a `FROM` source). Caused a hard crash (`x.replace is not a
   function`) on the very first batch. Fixed across all 5 affected
   repository methods (elements, quantities, materials, classifications,
   relationships) to use the documented form: `INSERT INTO table
   ${sql(rows, cols)}` directly.
2. **Missing required column** — `insertElementsBatch` never included
   `project_id`, which is `NOT NULL` on `bim_elements`. Fixed.
3. **camelCase read-back mismatch** — `RETURNING id, ifc_guid` results
   were read via `row.ifc_guid` (snake_case), but the connection's
   `postgres.camel` transform returns `row.ifcGuid` (camelCase) — so
   dependent maps (element GUID → DB id) were always empty past the first
   row, silently dropping quantities/materials/classifications for every
   element after the first. Fixed in 3 call sites.
4. **Bull job-id reuse breaking reprocess** — `enqueueParseJob` reused
   `modelId` as the Bull job id on every enqueue. Bull treats job id as a
   lifetime dedup key (not just "while active"), so re-adding the same id
   after the original job **completed** silently no-op'd — reprocess
   requests returned success but the worker never actually re-ran.
   Confirmed via zero `job_start` log events despite a 200 response. Fixed
   by using a fresh unique job id (`${modelId}:${timestamp}`) per enqueue;
   `modelId` remains the stable identifier for all DB/business logic.
5. **jsonb key-casing on `stage_completion`** — postgres.js's camel
   transform rewrites jsonb **value** keys (not just column names) on
   every read, e.g. writing `{extracting_hierarchy: true}` reads back as
   `{extractingHierarchy: true}`. `isStageComplete()` was checking the
   snake_case key directly, so resume-skip never actually triggered — a
   "resumed" job silently redid every stage (safe, since stages are
   idempotent, but not actually resuming). Root-caused via a direct
   isolated read/write test, then fixed by converting the stage name to
   camelCase (matching postgres.js's own `toCamel()` exactly) before the
   lookup.
6. **[Found during the final release audit]** `report_json` was being
   persisted as an empty `{}` — the structured report object returned by
   `IfcReportService.build()` was destructured and discarded, only the
   text rendering was kept. Fixed; verified `report_json` now contains
   the full structured report (confirmed non-empty via a live re-run).
   Also removed two unused type definitions (`ParsedElementBatch`,
   `IfcProcessingProgress`) found via repository-wide search during the
   same audit — dead code from earlier design iterations, confirmed
   unreferenced before removal.

### Verification performed (all live, against real Postgres + Redis + a
local S3-compatible server — `s3rver`, standing in for MinIO/R2 since
`dl.min.io` is blocked in this sandbox's network allowlist)
- **Happy path, full pipeline, twice** (once before cleanup, once as a
  final regression check after all fixes): upload via real presigned URL
  → S3 PUT → register → enqueue → worker parses → all 6 extraction tables
  populated correctly → Fragments generated (real ~16KB binary, confirmed
  on disk) and uploaded → report generated and stored → `status: ready`.
  Every table's contents cross-checked against the source IFC file
  (element counts by type, quantity values, material name, classification
  system/code, relationship counts) — all correct, no regression between
  the two runs.
- **Malformed IFC**: garbage (non-STEP) input → clean `status: failed`
  with a readable error, **zero** rows in any extraction table, empty
  `stage_completion` — no partial/corrupted state.
- **Empty IFC model**: valid IFC4 file with only `IfcProject`, no
  hierarchy or elements → `status: ready`, `element_count: 0`, no crash.
- **Duplicate upload**: same file registered as two independent models →
  both process correctly and identically (40 elements each), no
  collision.
- **Interrupted/resumed processing**: manually marked
  `extracting_hierarchy` complete mid-flight, triggered reprocess →
  confirmed via log evidence that stage was **skipped** ("already
  complete, skipping (resume)"), remaining stages ran normally, element
  count stayed at 40 (not doubled), final `stage_completion` accurately
  reflects all 4 tracked stages as done.
- **Repeated reprocessing (idempotency)**: reprocessed an already-`ready`
  model twice in a row → identical element (40) and relationship (72)
  counts both times — deterministic.

### Known limitations (honestly scoped, not silently missing)
- Stage-level resume, not element-level (see above) — acceptable for
  current model sizes; a future enhancement for very large (multi-GB)
  models would be batch-level checkpointing within the properties stage.
- Never tested against a true multi-GB IFC file — no such fixture was
  obtainable in this sandbox (public samples with real Psets/Qtos were
  either too small to exercise every code path, requiring a hand-authored
  synthetic augmentation, or LFS-gated and unreachable). Architecture
  reasoning for large-file behavior is in the proposal doc; it has not
  been empirically load-tested at scale.
- Fragments generation failure is treated as a warning, not a job
  failure (by design — hierarchy/properties/etc. are the source of truth
  and are already safely persisted by that point), so a systematically
  broken Fragments pipeline could go unnoticed without someone reading
  warnings. Worth a monitoring/alerting hook eventually, not urgent now.
- Only tested against IFC4 (via `IfcOpenHouse`) and a hand-augmented copy
  of it. IFC2x3 files are expected to work (web-ifc supports both schemas
  and the extraction code doesn't assume schema version) but has not been
  explicitly tested against a real IFC2x3 sample.

## Remaining features, priority order

1. **Reality Capture (image) processing** — thumbnail/rendition
   generation is still the Phase-1 fallback-to-original-file stub (bug #8
   from an earlier session mitigated the symptom — no crash — not the
   root gap: no real image-processing pipeline exists yet).
2. **AI validation** — live verification of `search.py` / `assistant.py`
   against a real embedding pipeline. Blocked by network allowlist
   (`huggingface.co` unreachable), not a code defect. Qdrant itself is
   confirmed reachable in this sandbox via GitHub release binary.
3. **Export** — not yet investigated at all.
4. **Production-readiness audit** — full pass across the platform, once
   the above are done.

## BIM Viewer (frontend) — IN PROGRESS, core flow built and verified

Built this session, on top of the frozen IFC Processing Engine:
- `apps/web`: BIM model upload modal, models list with live status/progress
  polling, a real 3D Fragments viewer (`@thatopen/components` +
  `@thatopen/fragments`), spatial tree, property panel, and element search
  — all wired into navigation (`ProjectDetail` → "BIM models" link →
  models list → "Open viewer" → full-bleed viewer page).
- `apps/api`: added `getModelViewerData` (presigned Fragments URL +
  status), `getHierarchy` (spatial tree), `getElementByGuid`, and enriched
  `getElement` with quantities/materials/classifications — all consumed
  by the new frontend pages.

### Bugs found and fixed during this integration
7. **Vite/Rollup CJS interop gap (pre-existing, not introduced this
   session)** — `vite build` failed the moment any file imported a runtime
   *value* (not just a type) from `@engineeringos/types`, because Vite's
   default `commonjsOptions.include` only targets `node_modules/**`,
   excluding pnpm-workspace-linked packages from CJS→ESM conversion
   entirely. `CapturesPage.tsx` (pre-existing code) was the first file to
   trip this. Fixed in `apps/web/vite.config.ts` by explicitly including
   the workspace package. This was blocking *any* production build of the
   web app, not just BIM-viewer-related code — a real platform-level fix.
8. **Untyped-null Postgres parameter (same class as the earlier-documented
   IFC-engine bugs)** — `BimService.getElements()` had bare
   `${x ?? null} IS NULL` checks with no cast on several optional filters
   (`modelId`, `ifcType`, `levelId`, `constructionStatus`, `search`).
   Postgres can't infer a parameter's type from `IS NULL` alone (that
   operator accepts any type), so the query failed at the *planning*
   stage — not only when a filter was actually null, but for *any* call,
   because each `${}` becomes its own bind position regardless of whether
   the same JS value also appears elsewhere with a cast. Found via the
   element search feature (first real caller of this endpoint with
   optional filters genuinely absent), fixed by adding an explicit cast to
   every bare occurrence, re-verified with three scenarios (all filters
   present, some absent, all absent).

### What's real vs. what's honestly out of scope
Delivered: orbit navigation (via `camera-controls`, bundled with
`OrthoPerspectiveCamera`), click-to-select with highlight, search-driven
selection with highlight, fit-to-model, spatial tree navigation, full
property/quantity/material/classification display.

Explicitly NOT built yet (per the large original feature list): walk/
first-person mode, section planes/box, explode, isolation, hide/show,
transparency, storey/discipline/category filter toggles, issue management
integrated into the viewer (camera position + screenshot capture),
dashboard KPIs, dark/light mode, accessibility pass, mobile layouts.
These are real, substantial scopes of their own — not silently stubbed,
not claimed as done.

### Verification performed
- `tsc --noEmit`: clean (both before and after every change in this slice).
- `vite build` (production): clean, confirmed working end-to-end including
  through both bugs above being found and fixed.
- `vite` dev server: confirmed serving `index.html` and transforming every
  new source file without error (main.tsx, App.tsx, BimViewerPage.tsx,
  BimModelsPage.tsx, BimViewer.tsx all returned HTTP 200 through Vite's
  module graph).
- **Every REST endpoint the new frontend pages call** was verified live
  against a real processed model: `listBimModels`, `getModelViewerData`
  (confirmed `status: ready` + a real presigned Fragments URL),
  `getModelHierarchy` (confirmed correct parent/child spatial tree),
  `getElementByGuid` (confirmed full property/quantity/material/
  classification payload matches the source IFC file exactly), and
  element search (confirmed correct results across three filter
  combinations after the fix above).
- **Not verified: actual browser rendering/interaction.** No browser or
  screenshot tool is available in this environment — the 3D canvas
  rendering, click/orbit/search-to-highlight interaction, and overall
  visual correctness have not been confirmed in a real browser. This is
  the single most important remaining verification step before
  considering this flow production-ready, and should be done by a human
  or a browser-testing tool at the next opportunity.

## Known bugs
None currently open. Bugs #7 and #8 found and fixed during BIM Viewer
frontend integration (see above).

## Technical debt (deliberately deferred, not forgotten)
- `strictPropertyInitialization` / `noUnusedLocals` disabled repo-wide;
  lint cleanup and dead-code sweep deferred until MVP business workflows
  are solid.
- `apps/ifc-service`'s `DatabaseService` has the same pre-existing
  postgres.js generic-typing strictness noise as `apps/api`'s (harmless,
  cosmetic, cataloged not fixed — same category as the item above).
- Stage-level (not element-level) resume granularity — see IFC engine
  limitations above.

## Blockers (environmental, not code)
- MinIO/S3 itself unreachable in this sandbox (`dl.min.io` blocked) — a
  local `s3rver` stand-in was used for real verification instead (see IFC
  engine verification section); production MinIO/R2 behavior should still
  be smoke-tested once deployed somewhere that can reach it.
- HuggingFace Hub unreachable — blocks live embedding tests for AI
  search/assistant.
- Qdrant server IS reachable (GitHub release binary) — update any future
  assumption that it isn't.
- No true multi-GB IFC test fixture was obtainable — see IFC engine
  limitations above.

## Exact continuation point
IFC Processing Engine is done. Next highest-priority item is **Reality
Capture (image) processing** — replace the current fallback-to-original-
file stub in `captures/processors/image-processing.processor.ts` with a
real thumbnail/rendition pipeline. Given the IFC engine's success with a
dedicated service pattern, consider (but don't assume without asking)
whether image processing should stay in-process in `apps/api` (current
state) or follow the same standalone-service pattern — this is worth a
short architectural check-in before starting, the way the IFC engine's
approach was confirmed first.
