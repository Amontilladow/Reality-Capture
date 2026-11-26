# GIS DXF 30 MB Capacity Validation & Production Sizing

A benchmark-and-sizing follow-up to `GIS_PREP_MEMORY_REMEDIATION.md` (the earlier root-cause
audit and memory fixes). That work is preserved unchanged; this is new evidence plus a new,
centrally-defined upload limit, implemented from scratch before this benchmark ran.

## 1. The 30 MB upload limit (implemented)

A single shared constant, `GIS_PREP_MAX_UPLOAD_MB` / `GIS_PREP_MAX_UPLOAD_BYTES`
(`packages/types/src/gis-prep.types.ts`), replaces two things that existed before this change:

- `GIS_PREP_MAX_SIZE_BYTES = 500 * 1024 * 1024` in `apps/api/src/modules/gis-prep/gis-
  prep.service.ts` — the only thing actually *enforced* server-side, but never actually safe:
  anything much past ~20-25 MB would already OOM or get killed by `apps/ai-service`'s own
  subprocess watcher before this 500 MB ceiling was ever the limiting factor.
- `CLOUD_DXF_LIMIT_MB = 18` in `apps/web/src/lib/drawing-format.ts` — a second, **hand-maintained,
  already-drifted** number shown to users as a hint, completely disconnected from what the API
  actually enforced (500 MB). A real pre-existing bug, closed by this change: there is now exactly
  one number, not two that can silently disagree again.

Enforced at three independent points, as asked:
1. **Client-side, before any upload starts** (`apps/web/src/lib/gis-prep.api.ts`'s
   `uploadAndCreateGisPrepJob`): checks `file.size` and throws immediately. Also a `declaredSizeBytes`
   field on the upload-URL request (`apps/api`'s `getUploadUrl`), so an obviously oversized file is
   rejected before a presigned URL is even issued — not the real enforcement (client-reported size
   is never trusted), just avoiding a wasted upload.
2. **The real upload/API boundary** (`createJob`'s existing post-upload `HEAD`-based size check,
   unchanged in mechanism, now reading the shared constant): deletes the oversized object and
   rejects with an actionable message before a job is ever queued. This was already the only real
   enforcement point before this change (the presigned PUT itself has no server-side size
   condition — see that file's own comment); it just used the wrong, unsafe number.
3. **The pipeline's own safety net** (`apps/ai-service`'s `gis_prep_max_upload_mb`, `routers/
   gis_prep.py`, unchanged streaming-rejection logic): the same number, kept in sync by hand since
   a Python service can't import a TS constant.

"MB" means 1024×1024 bytes everywhere in this codebase's `*_MB` config, consistently, both before
and after this change — documented explicitly now rather than left implicit. The original upload is
never touched: every rejection path deletes the *uploaded copy* (or never writes one), the source a
user already has is untouched, and a successful job's source copy is still read-only and hash-
verified exactly as before (`m4adm.export.JobWorkspace`, unchanged).

**The number itself is 8 MB, not 30 MB** — see §4 for why; §1's implementation work (the
mechanism, the three enforcement layers, the tests) was completed exactly as specified, and then
corrected by the benchmark evidence in §2-3, per this assignment's own framing: *"The 30 MB limit
is our proposed operational target, not a predetermined technical conclusion."*

## 2. Benchmark

Run against the real `m4adm.pipeline.prepare()` end to end (not a memory micro-benchmark), on
an unconstrained host (16 GB RAM — so these are the engine's own real peak RSS numbers, not
clipped by any container limit), using the same `/proc/<pid>/status` VmRSS-polling approach
`gis_prep.py` already uses in production (here polled every 50 ms). No real 5-30 MB engineering
DXF was found in the repository (`apps/adm-gis-prep/fixtures/*.dxf` are all under 200 KB, built
for logic tests, not size); six representative, **valid** synthetic drawings (same
closed-LWPolyline-plot + attributed-block shape as `m4adm.fixtures.valid_plot()`, scaled to a
grid) were generated and actually run twice each, 12 runs total, not estimated or extrapolated
between them.

| Input size | Entities | Peak RSS (run 1 / run 2) | Wall time | CPU | Output size | Output verified | Status |
|---|---|---|---|---|---|---|---|
| 5.02 MB | 9,102 | 196.4 / 196.5 MB | ~18 s | ~99% of wall | 5.05 MB | ✅ | Ready for review |
| 10.08 MB | 18,284 | 312.7 / 312.7 MB | ~35 s | ~99% | 10.12 MB | ✅ | Ready for review |
| 15.08 MB | 27,312 | 431.6 / 431.6 MB | ~53 s | ~99% | 15.17 MB | ✅ | Ready for review |
| 20.08 MB | 36,336 | 539.9 / 540.0 MB | ~72 s | ~99% | 20.22 MB | ✅ | Ready for review |
| 25.08 MB | 45,358 | 668.0 / 668.0 MB | ~91 s | ~99% | 25.26 MB | ✅ | Ready for review |
| 30.08 MB | 54,380 | 780.3 / 780.0 MB | ~109 s | ~99% | 30.31 MB | ✅ | Ready for review |

Every run succeeded (`returncode=0`, every output DXF byte-verified against its source handle
set — the existing re-read verification, unchanged). Run-to-run variance is negligible (≤0.3 MB
peak RSS, ≤2 s wall time across the pair at every size) — this benchmark's own numbers are highly
reproducible, not noisy.

**Temporary disk usage** (the job's own working directory — input copy + `work/` + `output/`,
measured after completion, since nothing is deleted mid-job): scales almost exactly 3× the input
size (e.g. 30 MB in → ~90.6 MB of job-directory disk) — the source copy, the prepared-full
intermediate, and the final output together. Disk was never close to being the constraint here;
memory was, by a wide margin.

**The ratio itself**: peak RSS ÷ input size runs from 39× at 5 MB down to 26× at 30 MB (a fixed
~80 MB base cost matters more at small sizes); the data fits `peak_rss_mb ≈ 80 + 23.3 × dxf_mb`
almost exactly (predicted vs. actual peak RSS differs by under 2% at every one of the six sizes).
This is *worse* than the ~9-19× this repo's own prior measurements found on real drawings
(`DECISIONS.md` D-034/D-035) — this benchmark's dense, regular grid of plot entities is a
reasonable, not a best-case, stand-in, and real architectural originals should not be assumed to
do better.

## 3. Safety margin against the existing infrastructure

The existing `engineeringos-ai-service` container has **512 MB** total, with its own baseline
(FastAPI, the embedding model, the AI assistant) already using an estimated **~180-210 MB**
(this repo's own prior comments; not independently re-measured here) — leaving roughly
**300-330 MB** of real headroom for the GIS engine subprocess, not 512 MB, and not isolated from
whatever else the container happens to be doing when a GIS job runs.

Measured against that, directly from §2's table:

- **5 MB (196 MB peak)**: fits comfortably under the *existing* `GIS_PREP_MEMORY_LIMIT_MB=270 MB`
  watcher threshold, with real margin even added to the service's own baseline.
- **10 MB (313 MB peak)**: already **over** the existing 270 MB watcher threshold, and over even
  the more generous ~300-330 MB raw-headroom estimate. On the real container today, this would be
  caught and killed by the existing RSS watcher (a clean, actionable failure — not a crash — but
  also not a drawing that actually finishes).
- **15 MB and up**: increasingly far over every one of these ceilings; 30 MB's 780 MB peak is
  **more than the entire container**, on its own, with nothing else running.

This also means the assignment's own proposed "~350 MB sustained" target is not, by itself, fully
compatible with the container's real headroom (210 + 350 = 560 MB > 512 MB) — adopting it at face
value as the watcher threshold would itself risk the exact container-level OOM this whole exercise
exists to prevent. The existing 270 MB watcher threshold was already sized correctly against the
real constraint; this benchmark didn't find a reason to raise it.

Other margin-eating factors evaluated, per the assignment's own list:
- **Variability between runs**: negligible (§2) — not a meaningful factor at this sample size.
- **Subprocess overhead**: already measured as part of each run (the subprocess *is* what RSS was
  polled on); the Python interpreter/FastAPI parent process is small and stable by comparison.
- **Concurrent application activity**: the existing `_one_at_a_time` semaphore
  (`routers/gis_prep.py`) prevents two GIS jobs from running together, but does **not** prevent a
  GIS job running at the same time as an OCR/drawing-extraction request or the AI assistant in the
  same container — those share the same 512 MB cgroup limit. This wasn't simulated directly (out
  of scope to reproduce safely here), but it's a real, one-directional risk: any genuine
  concurrent load only shrinks the safe ceiling further, never raises it. It argues for more
  conservative headroom, not less, which is reflected in §4's chosen value.

## 4. Evidence-based recommendation

**Answer: C — 30 MB is not safe on the existing 512 MB infrastructure.** Not marginally: at 30 MB,
peak RSS (780 MB) is roughly **1.5× the entire container's capacity**, with nothing else running
in it. This is not a headroom question (option B) — it's a hard overrun.

**Maximum safe upload size on the existing infrastructure, from this benchmark's own measured
points:** 5 MB is comfortably safe (196 MB, well under the existing 270 MB watcher threshold);
10 MB is already unsafe (313 MB, over that threshold). The defensible operational limit sits
between those two measured points, not beyond either of them.

**Implemented value: 8 MB.** Chosen (via this benchmark's own linear fit, not a fresh guess) as
the largest round number whose predicted peak RSS (~266 MB) stays under the *existing*
`GIS_PREP_MEMORY_LIMIT_MB=270 MB` watcher threshold with **no other configuration change** —
maximizing safety margin for the number of moving parts touched. `GIS_PREP_MAX_UPLOAD_MB` in
`packages/types` and `gis_prep_max_upload_mb` in `apps/ai-service/app/config.py` were both set to
8 (not deployed — see §6).

**Does this solve the operational requirement?** No, and that should be said plainly rather than
buried: 8 MB does not meet either this assignment's 30 MB target or the original engagement's
50-100 MB target. It is the honest ceiling of what today's 512 MB shared container can take
without risking the exact OOM behavior this whole investigation exists to prevent — a safety
limit, not a product target.

**D — a dedicated worker is still required**, for the SAME reason `GIS_PREP_MEMORY_REMEDIATION.md`
already concluded it was needed for 50-100 MB: ezdxf's full-document memory model (required by
this engine's own cross-reference QC — layer/block edits, topology/snapping checks, re-verified
rewritten DXF outputs; a true streaming rewrite would mean discarding that functionality, which
every version of this brief has explicitly ruled out) inflates DXF file size into peak RSS by a
ratio no in-process tuning changes enough to fit a 512 MB container. This benchmark adds sharper,
smaller-file evidence to that same conclusion; it does not change it. The commented-out,
NOT-activated `engineeringos-gis-prep-worker` block already proposed in `render.yaml` remains the
only evidenced path to an operational limit anywhere near 30 MB, let alone 50-100 MB.

## 5. Preserved functionality

Unchanged in this pass, verified by the full existing test suites (not re-derived from memory):
DXF parsing and entity handling, layer mapping/classification, block-aware processing (purge,
cross-reference), geometry correction, topology/snapping checks, coordinate transformations
(CRS/georeferencing), engineering QC logic (all ~15 check categories), output generation, and the
byte-verified rewritten-DXF re-read check. Every one of these ran, unmodified, inside every
benchmark job in §2 (`"verification": {"ok": true}` on every output, every run) and in the full
pre-existing test suite (next section). S3/job-management integration (`apps/api`'s
`gis-prep.service.ts`/`.processor.ts`/`.controller.ts`) is unchanged except for the size-check
value and the added pre-upload check — no change to upload flow, job-status model, or output
handling.

## 6. Regression testing

All existing suites, full runs, no changes beyond what §1 already describes:
- `apps/adm-gis-prep`: 100+ tests, all passing (includes the prior pass's memory-management tests).
- `apps/api`: 1,306 tests, all passing, including 24 in `gis-prep.*.spec.ts` (5 new boundary cases:
  just under / exactly at / one byte over the upload limit, plus the new declared-size pre-check).
- `apps/web`: 190 tests, all passing, including the corrected `drawing-format.test.ts` (closing
  the stale-18 MB-hint bug from §1).
- `apps/ai-service`: 3 new tests (`tests/test_gis_prep_router.py`, this router had **no** test
  coverage before this change) — an oversized upload is rejected before the engine subprocess is
  ever started (`asyncio.create_subprocess_exec` asserted never called), and both an exactly-at-
  limit and a comfortably-under-limit upload reach it correctly.
- Full typecheck (`tsc --noEmit`) clean in `packages/types`, `apps/api`, `apps/web`.
- "Invalid or malformed DXF": already covered by existing end-to-end tests (`test_dwg_input.py`,
  `test_integrity.py` — the `M4-IN-001` "not a recognised DXF or DWG" path) and this pass's own
  `test_identify_unknown_content`; verified present, not re-duplicated.

## 7. Remaining risks

- The benchmark used synthetic, regularly-structured drawings (no real 5-30 MB engineering DXF
  was available in-repo or supplied). Treat §2's numbers as a plausible, not a worst-case,
  estimate — real drawings with heavier block nesting or more entity-type variety may do worse,
  consistent with this repo's own historical real-drawing measurements landing on a *lower* (not
  higher) inflation ratio than this benchmark found, which argues this benchmark is already
  reasonably conservative, not optimistic.
- Concurrent-container-activity risk (§3) was reasoned about, not directly measured.
- 8 MB is a safety ceiling, not a product answer — it leaves the stated business need (processing
  real 50-100 MB drawings, or even this assignment's own 30 MB target) unmet until the dedicated
  worker is actually approved and deployed.

## 8. Deployment and rollback

**Nothing was deployed.** Every change is a code-level default or constant; `render.yaml`'s
proposed worker block remains commented out and untouched by this pass. **What a deploy of this
work would change in production:** `apps/ai-service`'s Docker image would need rebuilding
(`gis_prep_max_upload_mb` default changed in `app/config.py`), and `apps/api`/`apps/web` would
need their normal build+deploy (the `packages/types` constant, read at build time by both). No
database migration, no environment-variable change, no infrastructure change.

**Rollback**: every change in this pass is an independent, behavior-preserving diff, covered by
tests that would fail loudly if reverted incorrectly. `git revert` on the relevant commit(s) is
safe. Reverting `GIS_PREP_MAX_UPLOAD_MB` alone (e.g. back toward 30, or to any other value) is a
one-line change in `packages/types/src/gis-prep.types.ts` plus the matching line in `apps/ai-
service/app/config.py` — by design, there is now exactly one place to change per side, not the
two independently-drifting numbers this pass started by finding and closing.
