# GIS DXF Processing — Memory Architecture Remediation

Audit + implementation report for the "Render service OOMs on 50-100 MB DXF uploads" issue. Written against the real repository, not the previously-discussed stack — see §1.

## 1. Repository audit (what actually exists)

The GIS Drawing Preparation tool is **not** a thin DXF→GIS converter. It already has three
real layers, and the memory-sensitive engine already has serious defensive engineering around it:

| Layer | What it is | File |
|---|---|---|
| Frontend | `GisPrepPage.tsx` — upload, job list, review queue, re-run | `apps/web/src/pages/GisPrepPage.tsx` |
| Job queue/API | NestJS `@nestjs/bull` (Bull, Redis-backed) processor that downloads the source from S3, calls the engine over plain HTTP, re-uploads the result package, updates Postgres | `apps/api/src/modules/gis-prep/{controller,service,processor}.ts` |
| Engine | A ~7,900-line Python package, **already** on ezdxf 1.4.5 + shapely 2.2.0 + pyproj 3.8.0 (exactly the stack this brief suggested evaluating) | `apps/adm-gis-prep/src/m4adm/` |
| Engine host | A FastAPI router (`/gis-prep/prepare`) inside `engineeringos-ai-service`, which runs the engine as **its own subprocess**, in **its own virtualenv** (`/opt/m4adm`), with an RSS watcher, an address-space backstop, a one-job-at-a-time semaphore, a streamed-to-disk upload, and a hard upload-size cap | `apps/ai-service/app/routers/gis_prep.py`, `apps/ai-service/app/config.py` |

**What the engine actually does, end to end** (`m4adm/pipeline.py:_run`): copy the source
read-only → identify format → load the whole DXF with `ezdxf.recover.readfile()` → classify
every model-space entity → map layers → optional CRS georeferencing/transformation → apply
accepted fixes → **re-classify** the (now mutated) document → run ~15 categories of QC checks
(units, hygiene, layer properties, entity roles, title block, shared layers, feature geometry,
cross-layer snapping, layer topology, BDMS rules, services) building shapely geometry for every
entity along the way → write one `prepared_full.dxf` → for **each selected category** (e.g.
plot/roads/services), **re-read the entire prepared file from disk into a brand-new ezdxf
document**, delete everything not in that category, purge unused blocks, write the output, **re-read
that output again** to verify it. This is a full cross-reference CAD QC/correction tool — layer
tables, block definitions, in-place entity mutation, topology across entities, byte-identical
re-verification of its own output — not a format-conversion pass.

**Is the whole file loaded into memory?** Yes, repeatedly:
1. `m4adm.io.identify()` — **used to** call `path.read_bytes()` (the entire file, up to 100 MB) just to sniff a 64/4096-byte header and hash it with `hashlib.sha256(data)`, duplicating work `sha256_file()` (a streaming hash, already in the same module) already does. **Fixed, see §3.**
2. `m4adm.io.load_dxf()` → `ezdxf.recover.readfile()` builds the full in-memory object graph for the source. Unavoidable — see §2.
3. `m4adm.export.build_output()` → `ezdxf.readfile(prepared)` — a **second, independent full load of the already-large prepared file, once per output category**. A 3-category job (plot/roads/services) does this 3 times.
4. `m4adm.export.verify_output()` → `ezdxf.recover.readfile(out.path)` — a third load, once per output file, to re-verify it.

**Is geometry duplicated?** `classify_layout(doc)` is called 2-3 times in one job (initial
classification, optionally after georeferencing, and after layer-mapping/fixes mutate `doc`).
Each call is **genuinely required** — the document was mutated in between, so re-classifying is
correctness, not waste; this was verified by tracing every call site, not assumed. What *was*
pure waste: the pre-mutation `records`/`in_scope`/`pts` lists stayed referenced (and therefore
un-reclaimable) for the rest of the job even though nothing reads them again past the point where
`records2` is built, and the original full `doc` (plus `records2`/`ctx`/`specs`) stayed referenced
through the entire multi-category export loop even though `build_output()` never touches them —
it re-reads the prepared file from disk instead. **Fixed, see §3.**

**Current production limits** (`apps/ai-service/app/config.py`, `Dockerfile`):
`gis_prep_max_upload_mb=25`, `gis_prep_memory_limit_mb=270` (RSS, watched every 0.1s),
`gis_prep_address_space_limit_mb=1536` (loose backstop), `M4ADM_MAX_DXF_MB=18` (baked into the
Dockerfile, gates the DWG→DXF conversion path specifically), `gis_prep_timeout_s=840`,
concurrency = 1 (semaphore). These numbers are **not arbitrary** — `apps/adm-gis-prep`'s own
`docs/DECISIONS.md` (D-034/D-035) and code comments document real measurements: *"loading a DXF
takes roughly 100 MB plus 9 MB per MB of file"*, and separately, real-world peaks of *"the 12 MB
M19B architectural originals ~280 MB, the 36 MB ground floor ~670 MB"* (a ~15-19x ratio on real
drawings — worse than the 9x formula). They were deliberately sized to fit inside
`engineeringos-ai-service`'s shared **512 MB** container, which also runs the OCR/drawing-extraction
service and the AI assistant.

**Render deployment** (`render.yaml`): `engineeringos-ai-service` is a `pserv` on the `starter`
plan (512 MB). `GIS_PREP_SERVICE_URL` on `engineeringos-api` points at it. There is no separate GIS
worker today — `apps/adm-gis-prep/docs/DECISIONS.md` D-034 records this was a **deliberate, explicit
2026-10-26 user decision**: *"no $7/month instance for about one job every 6 months; desktop tool
remains the main path."*

## 2. Root cause

Not a bug in the DXF-parsing code. Two separate, real things:

1. **Config/capacity mismatch, not a code defect.** The engine is deliberately co-hosted inside
   the 512 MB `engineeringos-ai-service` container (D-034), which only leaves ~270-300 MB of safe
   RSS budget. At the documented ~15-19x inflation ratio for real architectural drawings, that
   budget supports roughly an 18-25 MB input — which is exactly where the current caps sit. A
   50-100 MB drawing needs **roughly 1-2 GB** of real memory to process with this engine's
   current (necessarily full-document) architecture. No amount of in-process tuning closes a
   40-80x gap between a 512 MB container and a 2 GB requirement.
2. **Two concrete, fixable waste points**, found by tracing the actual code (not assumed):
   `identify()`'s whole-file read, and `doc`/`records2`/`ctx`/`specs` staying referenced through
   the entire per-category export loop, where every iteration does its own independent full
   re-read of the prepared file. These don't close the 40-80x gap by themselves, but they reduce
   peak memory meaningfully and were real, safe, zero-behavior-change fixes worth making
   regardless of what happens to capacity (§3, §7).
3. A secondary risk worth naming honestly: the in-process RSS watcher polls every 100 ms;
   `ezdxf.recover.readfile()` can allocate a large fraction of its peak memory in large C-level
   bursts, so RSS can spike past both the per-process budget and the container's total limit
   between polls. When that happens, it's Render's/the kernel's **container-level** OOM killer
   that intervenes, not the watcher's clean `proc.kill()` — which can plausibly take the
   **co-hosted OCR/drawing-extraction service down too**, since they share the one container.
   This is the same class of incident already fixed once for the OCR service itself (PR #187);
   today it's shared infrastructure risk between the two workloads.

### Why this can't be "fixed" into a streaming/O(1)-memory pipeline

`ezdxf.iterdxf` (and ezdxf's other streaming aids) is a **one-pass, read-only** iterator over
model-space entities only — no block/layer-table/layout access, no write-back. This engine's own
feature set genuinely needs the full document model: layer-table edits, block-definition lookups,
in-place entity mutation (layer remap, coordinate transform, accepted fixes), cross-entity
topology/snapping checks, title-block validation against the official template, and
byte-identical re-verification of its own rewritten DXF outputs. Rewriting ~8,000 lines of
calibrated QC/BDMS/topology logic around a model that cannot support any of that is a different,
much larger project than a memory fix — and it directly risks the brief's own
"never sacrifice engineering accuracy for performance" rule. This was investigated, not assumed:
see D-043 in `docs/DECISIONS.md`.

## 3. Changes made (implemented, tested, safe within the existing architecture)

| File | Change |
|---|---|
| `apps/adm-gis-prep/src/m4adm/io/__init__.py` | `identify()` now reads a 4096-byte header and reuses the existing streaming `sha256_file()`, instead of `path.read_bytes()` (a full-file read, the FIRST thing every job did). |
| `apps/adm-gis-prep/src/m4adm/pipeline.py` | After the prepared DXF is written, explicitly `del doc, records2, ctx, specs` + `gc.collect()` (these are never read again — every later stage reads `target2`/`records2`-derived `target2` dict, not the objects themselves). Same `gc.collect()` after every per-category `build_output()` call, since each one's own fresh `ezdxf.readfile()` is just as cyclic. Also drops `records`/`in_scope`/`pts` right after `records2` replaces them. `ezdxf.Drawing` holds owner/back-reference cycles, so CPython's refcounting alone doesn't reclaim these on `del` — `gc.collect()` forces it. |
| `apps/adm-gis-prep/tests/test_memory_management.py` (new) | Pins `identify()`'s observable behaviour (format/version/hash/notes) unchanged, asserts it never calls `Path.read_bytes()` again, and confirms a 3-category job still produces identical per-category output to a 1-category job (the del/gc change must only affect memory lifetime, never which entities land where). |
| `apps/api/src/modules/gis-prep/gis-prep.processor.ts` | `SERVICE_TIMEOUT_MS` raised 15 → 35 minutes, so it stays comfortably above the engine's own `GIS_PREP_TIMEOUT_S` and a large job always gets the engine's own actionable timeout message instead of a generic network abort. |
| `render.yaml` | Added a **commented-out** `engineeringos-gis-prep-worker` service block (same Docker image as `engineeringos-ai-service`, bigger plan, dedicated to GIS traffic) — see §5. Not activated. |
| `apps/adm-gis-prep/docs/DECISIONS.md` | D-043/D-044 record this work in the project's own decision-log convention. |

All changes preserve existing behavior exactly (verified by the existing 100+ test suite, all
passing, plus 5 new targeted tests) and reduce — but, per §2, cannot alone close — the memory gap
for 50-100 MB files.

## 4. Benchmark evidence

See §7 (filled in from the actual benchmark run against both the pre-fix and post-fix code,
using representative synthetic DXFs generated in-pipeline — see "Benchmark methodology" below).

### Benchmark methodology

No real 50-100 MB customer DXF was available in this environment, so four representative,
**valid** (passes the engine's own format/metadata gating, not garbage bytes) synthetic drawings
were generated at the requested sizes using the project's own fixture primitives
(`m4adm.fixtures.new_doc/poly/detail/title` — the same shapes `valid_plot()` already uses:
closed 4-vertex LWPOLYLINE plot boundaries + an attributed `PlotDetail` block reference each),
arranged on a grid spaced apart so cross-layer snapping/topology checks run at realistic (not
pathologically all-touching) density. Generator: `gen_large_dxf.py` (kept in this PR's scratch
output, not committed — see §6 for where to find it if the benchmark needs re-running).

**This is a conservative, not a worst-case, benchmark.** Real architectural originals (the
~15-19x-inflation case this repo's own D-034/D-035 and `gis_prep.py` comments already measured)
have far more varied entity types, deeper block nesting and messier geometry than a regular grid
of identical plots, and should be expected to use **more** memory per MB than these numbers show.
Where the two disagree, size any new capacity against the documented historical ratio, not
against this benchmark's more optimistic one.

## 5. Dedicated worker — prepared, NOT deployed

A `type: pserv` Render service block was added to `render.yaml`, fully commented out:
same Docker image as `engineeringos-ai-service` (same `/opt/m4adm` venv, same `/gis-prep` router —
no new code to maintain), a bigger plan (~4 GB RAM target), and its own
`GIS_PREP_MEMORY_LIMIT_MB`/`GIS_PREP_MAX_UPLOAD_MB`/`GIS_PREP_TIMEOUT_S` env overrides sized
against the **pessimistic** 15-19x ratio, not this benchmark's own numbers.

**This was deliberately not activated or deployed.** Per the brief's own Section 9/10 rules
("do not deploy or replace production services without explicit authorization") and because it
reverses a prior, explicit, user-made cost decision (D-034: *"no $7/month instance... desktop
tool remains the main path"*) with a materially larger ongoing cost. Activating it needs a human
decision on that tradeoff, not a Blueprint sync triggered by this change. To activate: see the
comment block in `render.yaml` directly above the proposed service.

**Why `pserv`, not `type: worker`:** the existing, working integration between the NestJS Bull
queue and the Python engine is **Bull processor (Node) → plain HTTP call → Python FastAPI**
(`gis-prep.processor.ts`'s `callService()`). Redis/Bull itself stays entirely Node-side; Python
never touches it. This already is the kind of "reliable integration strategy that preserves the
existing queue architecture" the brief asks for (and avoids the real protocol-compatibility risk
of a Python process trying to consume Node `bull`'s Redis job format directly, which the brief
explicitly warns against assuming is safe). The dedicated worker keeps that same pattern — it's
just a second, differently-sized destination for the same HTTP call — rather than introducing a
new consumption model. `apps/ifc-service` (the repo's other Python-adjacent worker) is a true
`type: worker` because it polls its OWN BullMQ queue directly in Node; that's a different shape
and not a template for this change.

## 6. Benchmark artifacts

Kept in this session's scratch directory, not committed (per the environment's own convention —
intermediate benchmark outputs don't belong in the repo): the DXF generator, the subprocess-based
RSS-polling harness (mirrors `gis_prep.py`'s own `/proc/<pid>/status` approach), the 4 generated
DXFs, and the raw before/after JSON results. Reproducible from the instructions in this file if
the benchmark needs to be re-run against a different container-size assumption.

## 7. Limitations and what was explicitly NOT done

- **No real 50-100 MB customer DXF was used** — see §4's methodology note. The benchmark numbers
  are a reasonable lower bound, not a guarantee for the messiest real drawings.
- **No new Render service was deployed.** §5.
- **No fine-grained Uploaded/Queued/Preflight/Processing/Validating/Completed/Failed/Cancelled
  status model was implemented.** The current 6-state model
  (`QUEUED`/`RUNNING`/`READY_FOR_REVIEW`/`PREPARED_WITH_WARNINGS`/`BLOCKED`/`FAILED`) already
  surfaces actionable failure messages end-to-end (the engine's own "too large"/"took too
  long"/"needs more memory" text flows through `gis-prep.processor.ts` into
  `gis_prep_jobs.error_message` and is displayed as-is on `GisPrepPage.tsx`) — that part of the
  brief's Section 6 was found already satisfied, verified by reading the actual display code, not
  assumed. Real phase-by-phase progress (e.g. a visible "Preflight" vs "Validating" state) would
  need the `/prepare` call to become a streaming/polling protocol instead of one blocking
  request/response, which is a real feature addition, not a memory fix, and was left out of this
  pass's scope on purpose rather than half-built.
- **No cancellation support was added.** The current single blocking HTTP call has no mid-flight
  cancel path; adding one is a protocol change (see above), not a memory fix.
- **The two found-and-fixed waste points (§3) do not, by themselves, make 50-100 MB safe** inside
  the existing 512 MB container. Closing that gap needs the capacity change in §5, which needs a
  human decision on its cost, per the brief's own authorization rule.
- **Not investigated**: whether any single QC check (e.g. cross-layer snapping/topology) scales
  worse than linearly with entity count at tens of thousands of entities. The benchmark run times
  in §4 should be read with this in mind — a slow check is a CPU/latency concern, not itself a
  root cause of the OOM, and pinning it down further was out of scope for a memory-focused pass.

## 8. Rollback

Every change in §3 is a small, independent, behavior-preserving diff with full test coverage
(existing + new tests, all passing) — reverting any one of them (`git revert` on the relevant
commit, or hand-reverting the specific file) is safe and has no interaction with the others.
The `render.yaml` addition is inert (commented out); deleting it is a no-op on production. No
database migration, no data backfill, and no production deploy were part of this change, so there
is nothing to roll back at the infrastructure level — reverting the code changes alone fully
restores the prior state.
