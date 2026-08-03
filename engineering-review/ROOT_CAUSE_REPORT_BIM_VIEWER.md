# BIM Viewer Investigation — Navigation Loss & Missing Geometry

**Date:** 2026-08-02
**Status:** Issue 1 resolved and deployed. Issue 2 is **frozen, not resolved** — see below. This is a working document, not a closed postmortem.

**Scope:** Two production defects in the BIM viewer (`apps/web/src/components/bim-viewer/BimViewer.tsx`), investigated end-to-end against a real production model (LATEST STAIR-03, `model_id=5bed4b5c-6797-4971-a277-3daa2c109287`).

This document exists so the next debugging session on this subsystem starts from verified findings instead of re-walking the same dead ends. Issue 2 in particular went through 8 rounds of hypothesis → disproof, including two rounds where a claimed finding was later found to be wrong and had to be corrected (one after already being filed upstream). That history is kept in full below, not cleaned up, because the disproven paths are exactly what a future investigator needs to avoid repeating.

---

## Issue 1: Camera loses the model on extreme zoom — RESOLVED

### Symptom
Zooming in very close, or zooming out very far, eventually made the model disappear. Sometimes unrecoverable without a full page reload.

### Root cause (confirmed)
The `camera-controls` library (used internally by `@thatopen/components`' `OrthoPerspectiveCamera`) defaults `infinityDolly` to `true`. Once dolly distance would exceed `minDistance` or `maxDistance`, instead of clamping distance and stopping, it kept translating **both the camera and the orbit target** together, unbounded, in the current view direction — flying the camera (and its reference point) through and past the model into empty space.

### Evidence
Deterministic reproduction in an isolated harness:

| Test | Target before | Target after |
|---|---|---|
| 100 zoom-in ticks past minDistance | `(-2.509, 0.088, -0.230)` | `(-18.353, 0.088, -0.230)` (~16 units past model bbox) |
| 200 zoom-out ticks past maxDistance | `(-2.509, 0.088, -0.230)` | `(42360.962, 0.088, -0.230)` (42,000+ units away) |
| Same tests with `infinityDolly=false` | `(-2.509, 0.088, -0.230)` | **byte-identical**, zero drift |
| 80 interleaved rotate+zoom, `infinityDolly=false` | `(-2.509, 0.088, -0.230)` | **byte-identical**, zero drift |

### Fix
`world.camera.controls.infinityDolly = false;` in `BimViewer.tsx`. Deployed and validated: camera now stops cleanly at min/maxDistance instead of flying through the model, in every tested scenario.

### Secondary, related fixes shipped alongside
- **`dollyToCursor` disabled.** With it on, wheel-zoom recomputes the orbit target from a ray through the cursor position on every tick. Confirmed by direct reproduction: with an off-center cursor (the normal case for a small/off-center model in a large viewport), this walked the target away from the model within ~20 scroll ticks, even during zoom-*in*.
- **`maxDistance` scaled to model size.** The library default (300) is unrelated to a given model's actual scale.
- **`far` clipping plane scaled proportionally to `maxDistance`.** The camera's `far` is hardcoded to 1000 in the library's `setupCamera()`; the maxDistance formula floors at exactly that value, so reaching max zoom-out silently far-clipped the entire model on every load, regardless of model size.
- **`model.box` used instead of `new THREE.Box3().setFromObject(model.object)`** for the initial camera fit. `model.object`'s mesh children populate asynchronously after `core.load()` resolves (confirmed: `model.object.children.length === 0` immediately after resolution, populated ~150-200ms later), so reading the box synchronously from the object graph always found it empty and silently skipped the fit, leaving the camera at its hardcoded default position. `model.box` is populated synchronously during the library's own internal setup, before `core.load()` returns.
- **`fitToModel()` (the "Fit to model" button) fixed.** It built its box from `world.meshes`, a `Set` our own code never wrote to (we add `model.object` directly to the scene graph, never to `world.meshes`), so the box was always empty and the fit silently no-opped. Fixed to read `model.box` from the loaded `FragmentsModel`, same reliable source as the initial-load fit.

### Hypotheses considered and discarded for Issue 1
None — this investigation converged directly on `infinityDolly` with strong evidence and no false starts, unlike Issue 2 below.

---

## Issue 2: Missing/incomplete geometry — FROZEN, NOT RESOLVED

### Symptom
Some IFC elements never appear in the viewer, or appear incomplete, for large structural models (LATEST STAIR-03: 2999 elements, mostly structural steel — beams, plates, fasteners, welds).

### Why this is frozen, not closed
Eight rounds of hypothesis and disproof produced real, verified facts (below), but the central question — **why does the actual production-generated fragment file differ from every local regeneration of the same source file** — is still unanswered. Two separate claims of "root cause confirmed" were made and retracted during this investigation (see disproved hypotheses 5 and 6, and the `getItemsGeometry()` sparse-array bug in Confirmed Facts, which caused both retractions). A third overclaim was caught before being written down, when a direct question about the production `.frag`'s exact provenance surfaced a gap this investigation had not actually closed. Continuing to iterate under time pressure was producing more retractions, not more convergence — the responsible move is to stop, write down exactly what's known and unknown, and let a fresh pass (ideally on a different day, possibly a different person) pick it up.

### Confirmed facts

Objective statements only — each one independently checked against real evidence, not inference.

- `bim_models.element_count = 2999`, `elements_skipped = 0`, `processing_error = NULL` for this model (verified via `pg_restore` of a real production backup, not memory).
- 2999 distinct `bim_elements` rows, 2999 distinct `ifc_guid` values for this model — the parser is not dropping elements.
- Every GUID checked (up to 2887 in one pass, plus targeted individual checks) resolves successfully via `guidsToModelIdMap()` against the loaded fragments model. No GUID-level data loss found anywhere in the pipeline.
- `IFCELEMENTASSEMBLY` containers have `Representation = $` (null) in the raw IFC source itself (e.g. `#31862= IFCELEMENTASSEMBLY(...,$,'D/9',...)`). 162 of the 194 originally-flagged "degenerate" elements are this — zero geometry is correct for them, not a bug.
- `getItemsGeometry(localIds)` can return an array shorter than the requested `localIds` — it omits entries for zero-geometry items rather than padding them. Confirmed by direct logging.
- Three local, back-to-back generations of the same source file (`IfcImporter.process()`, same machine, same command) produce the identical set of 3,737 zero-geometry local IDs (of 6542 total) — verified by hashing the sorted id list. The three `.frag` outputs have different byte sizes (526,017 / 526,015 / 526,018 bytes) but identical total triangle count (266,982).
- Local source IFC (`LATEST STAIR-03.ifc`, from the user's Downloads folder): SHA-256 `bc16edc48460c65f849a178939dbcb28df4b21f450563da73bd4a4f51795d9b2`, 2,583,629 bytes.
- Production's actual uploaded-IFC object key (from `bim_models.storage_key` in the restored backup): `511f38d4-e2ca-45f7-b38c-c1a112862490/captures/4196109b-8eec-49ad-81c1-c798d83c99df/331e5dba-074d-4b3c-a3ed-912a5dc05827.ifc`. **Its SHA-256 is unknown** — see Open Questions.
- Production's fragments output object: SHA-256 `c95829bf...` (fetched once via a presigned URL from the live app).
- Three local `.frag` outputs: SHA-256 `3365f57d...` / `c2aaf093...` / (third run, hash not captured).
- A specific weld (local id 16118, GUID `1eDJg6002nA34tD3WpCZ0m`) showed 0 geometry in the production `.frag`, but is **not** a member of the 3,737-id set any of the three local runs produce.
- Local generation environment: Node.js v24.18.1, pnpm 11.15.1, `@thatopen/fragments@3.4.6` + `three@0.185.1` + `web-ifc@0.0.77`, Windows.
- Production generation environment per `apps/ifc-service/Dockerfile` + `pnpm-lock.yaml`: base image `node:22-alpine` (Node 22.x, musl libc/Linux), pnpm 11.15.1, same resolved `@thatopen/fragments@3.4.6` + `three@0.185.1` + `web-ifc@0.0.77` triple. **Node major version differs from local (22 vs. 24) — this was not checked until this pass, and its impact is unverified.**

### Disproved hypotheses

Do not re-investigate any of these without new evidence.

1. ❌ **Representation-type failure** (SweptSolid/circular-profile, Clipping/boolean CSG rasterize incorrectly)
2. ❌ **Representation failure specific to Brep welds**
3. ❌ **Content/scale-dependent trigger**
4. ❌ **Environment parity — dependency versions** (versions matched; runtime/OS parity was a separate, unchecked question — see Confirmed Facts)
5. ❌ **Client-side loading non-determinism** — claimed, then retracted (see detail below; the retraction itself is now flagged as unverified, not re-affirmed)
6. ❌ **Server-side generation non-determinism** — claimed, filed upstream, then corrected in the same thread

Detail on each, kept in full because the disproof evidence is exactly what a future investigator needs to avoid repeating these paths:

#### 1. Representation-type failure (SweptSolid/circular-profile, Clipping/boolean CSG)
**Claim:** Certain IFC representation types fail to rasterize in `@thatopen/fragments`, explaining the missing beams.

Two individual `IFCBEAM` elements were traced end-to-end from raw IFC entity through to actual per-item mesh data:
- GUID `1eDJg6002LSJ4tD3WpCZ0m` ("MEZZ. BEAM"): `Body/SweptSolid` + `IFCRECTANGLEPROFILEDEF` (plain rectangle). Result: 24 vertices, 12 triangles — correct, complete, bounding box exactly matching source dimensions.
- GUID `28i7zQmCfFuuz8aH6OCTkg` ("STAY ANGLE"): `Body/Clipping` (the suspected-bad type). Result: 222 vertices, 144 triangles — real, substantial geometry.

Both render correctly for these specific test cases. (Note: a *different*, separately-confirmed upstream bug for circular-profile SweptSolid elements remains real and is tracked as [ThatOpen/engine_fragment#259](https://github.com/ThatOpen/engine_fragment/issues/259) — that finding is unaffected by this disproof, it just isn't the explanation for *this* model's missing beams.)

#### 2. Representation failure specific to Brep welds
One weld (GUID `1eDJg6002nA34tD3WpCZ0m`) traced to `Body/Brep` → `IFCFACETEDBREP` → `IFCCLOSEDSHELL` with 20 real faces in the source, showing 0 geometry in the loaded production model. Looked like a clean, minimal, representation-specific bug.

**Disproof:** a Minimal Reproducible Example (just this entity's full dependency closure, ~6.3KB) rendered it correctly in isolation (72 vertices, 32 triangles).

#### 3. Content/scale-dependent trigger
Binary-search style testing: reconstructed subsets at ~50%, ~93.6%, and 100% of entity count, including a full unfiltered re-serialization of every entity, and the exact byte-for-byte original 2.5MB file — all rendered the target weld correctly through the local `IfcImporter.process()` pipeline. No correlation found between file scale/content and the failure.

#### 4. Environment parity (dependency versions)
Verified: production's `apps/ifc-service` resolves `@thatopen/fragments@3.4.6` paired with `three@0.185.1` (confirmed via `pnpm-lock.yaml`, which `pnpm install --frozen-lockfile` in the Dockerfile guarantees matches what's installed, assuming the currently-deployed image was actually built from the current Dockerfile+lockfile). Local reproduction used the identical resolved pair. **This check was incomplete** — see "Open questions" below; dependency version matching was verified, but the Node runtime version itself was not (see the provenance table).

#### 5. Client-side loading non-determinism (claimed, then retracted)
**Initial claim:** fetching the live production `.frag` twice produced the same SHA-256 hash but different parsed geometry for the same GUIDs — reported as "confirmed non-determinism in `core.load()`."

**Retracted.** A controlled test (20 independent fresh page loads, cache-busted fetch, hash-verified identical input every time) showed zero variance across all 20 runs. But this retraction is **itself now suspect**: that test used the same undercounting scan pattern described in "Confirmed facts" above (`for (const x of meshData)`), which is exactly the bug that produces spurious "0 zero-geometry" results. **The 20-run test has not been re-run with the corrected counting method. Its "zero variance" result should not be trusted as either confirmed or disproven — it is an open gap, not a settled finding in either direction.**

#### 6. Server-side generation non-determinism (claimed, filed upstream, then corrected)
**Initial claim:** three local generations of the same file produced different zero-geometry counts (0 / 3,737 / 3,737) — filed upstream as [engine_fragment#260](https://github.com/ThatOpen/engine_fragment/issues/260) with the framing "observed nondeterministic geometry-to-item assignment."

**Corrected in the same GitHub thread** ([correction comment](https://github.com/ThatOpen/engine_fragment/issues/260#issuecomment-5160126246)) after finding the `getItemsGeometry()` sparse-array undercounting bug: the "0" result for run 1 was a measurement artifact. Re-measured correctly, all three local runs produce the **identical** 3,737-item zero-geometry set (see "Confirmed facts"). This is not evidence of non-determinism across these three runs — it's the opposite, a consistent, reproducible failure. The upstream issue was corrected rather than left standing with the wrong framing.

### Open questions

Only unanswered items — nothing here has a confirmed answer yet.

- **Uploaded IFC hash unknown.** Whether the actual production-uploaded object (`storage_key = 511f38d4-...-e2ca-45f7-b38c-c1a112862490/captures/4196109b-.../331e5dba-....ifc`) is byte-identical to the local Downloads copy (`bc16edc4...`) has never been checked — `bim_models` has no stored checksum column, and no code path in this app exposes a read/download URL for the *original* upload (only `getModelViewerData` → `fragmentsUrl`, for the generated `.frag`, exists). This is the single most likely explanation for "production differs from local" and the cheapest to close if it's true.
- **Production container inaccessible.** No Render API token or dashboard session, no container shell, available in this environment — confirmed just now (an unauthenticated Render dashboard load prompted sign-in, and local `.env.local` only has localhost-minio S3 credentials, not production R2). Docker image digest, build timestamp, and whether the frozen-lockfile install reflects a stale cached layer are all unverified.
- **Node 22 vs. 24 impact unknown.** Local generation happened on Node v24.18.1; production is pinned to Node 22 (`node:22-alpine`). This mismatch was not even checked until this pass. Whether it matters for `@thatopen/fragments`/`web-ifc` (native WASM bindings, buffer handling, etc.) has not been investigated.
- **Production artifact provenance incomplete.** The full apples-to-apples comparison (OS, CPU architecture, exact running Node version, image digest, exact command line for both sides) cannot be completed from this environment — see the table below for exactly what's known vs. not.

| | Production worker | Local generator |
|---|---|---|
| OS / base image | `node:22-alpine` (musl libc, Linux) — from `apps/ifc-service/Dockerfile` | Windows |
| CPU architecture | Unknown — not recorded anywhere accessible from here | x86_64 |
| Node.js version | 22.x (pinned by base image tag) — **not verified against the actual running container** | **v24.18.1** — confirmed, differs from production's major version |
| pnpm version | 11.15.1 (Dockerfile: `npm install -g pnpm@11.15.1`) | 11.15.1 (same, per local `pnpm --version`/postinstall output) |
| `@thatopen/fragments` | 3.4.6, paired with `three@0.185.1` per `pnpm-lock.yaml` — assumes `pnpm install --frozen-lockfile` in the Docker build actually ran against the currently-deployed image | 3.4.6, paired with `three@0.185.1` — confirmed matching, via direct inspection of the resolved pnpm store path in error stack traces |
| `web-ifc` | 0.0.77 per lockfile | 0.0.77, confirmed |
| Docker image digest / container id | **Unknown — no Render API or container shell access in this environment** | N/A |
| Exact command / code path | `apps/ifc-service`'s `IfcFragmentsService`, invoked by the BullMQ processing job | `tools/bim-debug/generate-fragment.cjs`, a direct call to the same `IfcImporter.process()` |
| Input IFC SHA-256 | **Unknown** — see "Uploaded IFC hash unknown" above | `bc16edc4...` (the file in the user's Downloads folder, assumed but not proven to be the same upload) |
| Output `.frag` SHA-256 | `c95829bf...` (fetched once via a presigned URL from the live app) | `3365f57d...` / `c2aaf093...` / (third, uncaptured) across three local runs |

Until the two starred items above are closed, "production differs from local" cannot be attributed to the library, the generation process, or anything else with confidence — it might simply be two different input files.

### Separate, not-yet-investigated item
GUID `32$ek4m5rEgvoHmkRSTjkO` ("Bolt assembly", `IFCMECHANICALFASTENER`) showed 0 triangles in both of the two production-session checks performed. Tracked separately in `KNOWN_ISSUES.md`, not combined with anything above unless a shared root cause is actually demonstrated.

### Recommended next step (attempted this pass, blocked — needs the user)
1. **Get the actual uploaded IFC file's bytes and hash-compare against the local Downloads copy.** Attempted this pass: pulled the real `storage_key` from the restored production backup (see Confirmed Facts), but there is no way to fetch the object from this environment — no app endpoint exposes a read URL for the original upload (only the generated `.frag` has one), and the local `.env.local` S3 credentials point at localhost minio, not production R2. Closing this needs one of: (a) the user pulling the object via the Cloudflare R2 dashboard and hashing it, (b) the user granting temporary R2 read credentials, or (c) explicit approval to add a small, temporary, read-only presigned-URL endpoint mirroring the existing fragments one and deploy it. This alone might close the investigation.
2. If the inputs match, get Docker image digest + build timestamp from the Render dashboard and confirm against `pnpm-lock.yaml`'s current state. Attempted this pass: no authenticated Render session available in this environment (dashboard load prompted sign-in). Needs the user's Render access.
3. Only after both of those are ruled out does it make sense to resume investigating the library itself.

---

## Backend bugs found and fixed as a byproduct of this investigation

None of these are related to the BIM viewer directly, but were discovered while building diagnostic tooling for it and are real, independently-verified, deterministic fixes — unlike Issue 2 above, these are done.

1. **`POST /auth/refresh` always 500'd** (`apps/api/src/modules/auth/auth.service.ts`). The query selected `rt.*` (refresh_tokens.*) then also explicitly selected `u.company_id` etc. `rt.*` already includes `refresh_tokens.id`, and nothing overrode it with the user's actual `id` — so `stored.id` silently held the refresh token's own row id instead of the user's id. `issueTokens()` then used that wrong value as both the new JWT's `sub` claim and the `user_id` column on the new `refresh_tokens` row, violating the `user_id -> users.id` foreign key on every single refresh. Fixed by aliasing `rt.id AS refresh_token_id` and explicitly selecting `u.id`.

2. **Pagination `total`/`totalPages` always wrong on every paginated endpoint** (`apps/api/src/database/database.service.ts`, `paginate()`). Checked for the literal key `'full_count'`, but the DB client is configured with `transform: postgres.camel`, so the actual key is always `fullCount`. The check never matched, silently falling back to `rows.length` (the current page's size) as the reported total. Affects bim elements, issues, captures, projects, notifications, and users list endpoints.

3. **Unstable pagination ordering** (`apps/api/src/modules/bim/bim.service.ts`, `getElements()`). `ORDER BY e.ifc_type, e.ifc_name` has no unique tiebreaker; elements commonly share identical type+name (generic "Beam", "Fastener" instances), making `LIMIT/OFFSET` pagination over ties unstable — confirmed by direct reproduction: paging through this exact endpoint at 200/page returned 2999 raw rows but only 2887 distinct ids for a model with exactly 2999 elements. Fixed by adding `e.id` as a final sort key.

---

## Tooling built during this investigation (kept, relocated out of app code)

These are treated as permanent forensic assets, not throwaway debug scripts — retained for the next pass at Issue 2, or the next time a similar BIM viewer geometry/loading issue needs this kind of investigation.

- `tools/bim-debug/generate-fragment.cjs` — generates a `.frag` from a raw `.ifc` using the exact production `IfcImporter` code path (own workspace package, pinned to the same `@thatopen/fragments`/`web-ifc` versions as `apps/ifc-service`).
- `tools/bim-debug/extract-minimal-repro.cjs`, `extract-sized-subset.cjs`, `extract-prefix-subset.cjs`, `reserialize-full.cjs` — IFC dependency-closure extractors used for the MRE and binary-search testing above.
- `tools/bim-debug/hash-compare.cjs` — SHA-256 + size comparison for `.frag` (or any) files.
- `apps/web/dev-harness/repro.html` + `repro-main.ts` — standalone Vite-served harness replicating `BimViewer.tsx`'s world/camera/renderer/fragments setup, parametrized by query string (`?file=name`), for isolated (non-production) testing of camera and geometry behavior. Lives inside `apps/web` because it needs Vite's dev server and the app's resolved `node_modules`, but is excluded from production builds via `vite.config.ts`'s explicit `rollupOptions.input` (only `index.html` is ever built) and is not linked from anywhere in the shipped app. Verified via a real `vite build` that only `dist/index.html` is produced.
- **Critical caveat for anyone reusing `repro-main.ts`'s geometry-scanning logic**: `model.getItemsGeometry(localIds)` can return an array shorter than the requested `localIds`, omitting entries for zero-geometry items rather than padding them. Always index by the request (`meshData[j] ?? []`), never iterate the returned array directly (`for (const x of meshData)`) — that exact pattern produced two of the three retracted claims in this investigation.
- `tools/bim-debug/fragment_determinism.test.ts` — a Jest regression test (currently `describe.skip`/`it.todo`, gated behind `BIM_DEBUG_SOURCE_IFC`) documenting the expected end-state: N generations of the same file should produce identical zero-geometry sets, ideally an empty one. Not yet runnable end-to-end — the geometry-verification half needs a browser/Worker context this repo has only exercised manually so far, not from Jest.
- A local, throwaway PostgreSQL 18 instance was used to `pg_restore` a real production backup for exact, verified element/GUID/type counts, avoiding reliance on memory or assumptions about database state. Not part of the committed tooling (ad hoc, data-dependent, requires a fresh backup file each time).

---

## Investigation timeline

Grounded in real commit timestamps, not reconstructed from memory. Where ordering within a day reflects the investigation narrative above rather than a commit boundary, that's noted as inferred.

**2026-08-01 — Early camera investigation (false starts, later superseded)**
- `a234b7d` Wired the camera into loaded fragments models (`useCamera`)
- `f3a30cd` Attempted a zoom-instability fix on top of that change
- `7f6b9f0` Reverted the whole `useCamera` experiment — made things worse, not better

**2026-08-02 — Camera root cause found and fixed; backend bugs found as a byproduct; geometry investigation begins**
- `718f24b` Fixed the camera never fitting to the loaded model
- `07f0a3f` Added temporary diagnostic logging to trace the model-load path
- `8e8ebd5` Fixed zoom-out losing the model
- `5632b13` Disabled dolly-to-cursor zoom (confirmed as a secondary drift cause)
- `8e195fa` Fixed the "Fit to model" button
- `45aa4ff` Added temporary wheel-event diagnostic logging for the root-cause hunt
- `8c10996` Found and fixed the unrelated `POST /auth/refresh` 500 bug
- `c965f24` **Camera root cause confirmed and fixed** — `infinityDolly`
- `c2b2259` Added a temporary diagnostic hook — the missing-geometry audit begins
- `96b044f` Found and fixed two pagination bugs surfaced by that audit

**2026-08-03 — Geometry investigation deepens, is frozen (not solved); provenance feature built**
- *(inferred order, no individual commits)* Hypotheses 1–4 tested and disproved (representation type, Brep welds, content/scale, dependency-version parity)
- Filed [engine_fragment#260](https://github.com/ThatOpen/engine_fragment/issues/260) upstream, with initial framing later found to need correction
- **Sparse-array `getItemsGeometry()` counting bug discovered** — both the client-side and server-side "confirmed nondeterminism" claims (Hypotheses 5–6) retracted as a result; the GitHub issue was corrected in place rather than left standing
- `4a152eb` Archived the investigation as a report (pre-provenance version)
- `9a67499` Relocated forensic tooling into `tools/bim-debug/` and `apps/web/dev-harness/`
- A direct question about the production `.frag`'s exact provenance surfaced the checksum gap this investigation hadn't closed — investigation formally **frozen**, explicitly not claimed solved
- `f1a9e2a` Built and locally verified the artifact provenance feature in direct response to that gap

**Pending — Phase 5**: deploy the provenance feature, reprocess the production model, compare production vs. local source SHA-256, record the outcome here, and only then decide whether to resume the geometry investigation. This report stays open until that entry is added.
