# EngineeringOS — Performance and Infrastructure Optimization

**Phase 7: Continuous Improvement, AI Optimization & Product Growth**
Every finding below was verified directly against the current codebase and, where noted, a real local build/test run — not inherited from prior-phase documentation without re-checking. Distinguishes **measured** facts from **code-level observations** (true of the code as written, not load-tested) and from **estimates**. No premature caching, no unnecessary microservices, and no "trend-chasing" framework swaps are proposed anywhere below — every recommendation ties back to a specific, confirmed finding.

---

## 1. Background job queues (Bull/Redis)

Three queues exist: `image-processing` (captures), `ifc-processing` (BIM models), `webhook-delivery`. All three retry with exponential backoff (`attempts: 3, backoff: { type: 'exponential', delay: 5000 }`) — confirmed by reading each module's `BullModule.registerQueue()` call.

| Queue | Completed-job cleanup | Failed-job cleanup |
|---|---|---|
| `ifc-processing` (`bim.module.ts`) | Capped at last 100 (`removeOnComplete: 100`) | Capped at last 100 (`removeOnFail: 100`) |
| `webhook-delivery` (`webhooks.module.ts`) | Capped at last 100 | Capped at last 100 |
| `image-processing` (`captures.service.ts`'s per-job `.add()` call) | Removed immediately (`removeOnComplete: true`) | **Never removed** (`removeOnFail: false`) |

**Confirmed, narrow finding:** unlike the other two queues, `image-processing` never prunes failed jobs. A completed job is cleaned up immediately (good — bounds growth on the success path), but a permanently-failed job (corrupted upload, unsupported format after 3 retries) stays in Redis forever. On the project's free-tier Redis plan, an accumulation of failed jobs over time is a real, if slow-growing, memory risk — this is not "missing caps entirely" (completed jobs are in fact capped tightly), it's specifically the failure path.

**Implemented this phase:** changed `removeOnFail: false` to `removeOnFail: 100` in `captures.service.ts`, matching the other two queues' convention exactly. One-line change, no behavioral risk — failed job *records* are a debugging convenience, not needed indefinitely, and 100 is ample for triage.

## 2. Unbounded query: `drawings.service.ts findAll()`

**Confirmed by reading the code** (`drawings.service.ts:90-105`): this query has no `LIMIT`/`OFFSET` and no pagination parameters at all — it returns every current drawing for a project in one response, with a `LEFT JOIN`+`GROUP BY` for linked-capture counts. For a project with a very large drawing set, this is an unbounded result set and an unbounded join — both response size and query cost scale linearly with however many drawings a project accumulates, with no ceiling.

**No other `findAll`-style method in the codebase was found with this specific gap** during this review — most list endpoints already take pagination parameters (confirmed pattern elsewhere, e.g. the Issues/RFI list endpoints). This appears to be a one-off oversight specific to this file, not a repo-wide pattern.

**Implemented this phase, scoped down from the original plan:** a true paginated contract (`limit`/`offset` query params, a `{ rows, total }` response shape) would mean changing this method's return shape, its controller route, and every frontend caller that consumes it today as a plain array — that is real new scope, not a safe/low-risk fix, and was not done. Instead, a `LIMIT 500` was added to the query itself, with **no change to the response shape or any caller** — this bounds the worst case (an unbounded result set) without touching the API contract at all. True cursor/offset pagination remains a valid follow-on if a project is ever found to exceed 500 current drawings in practice, but is not needed today and is deferred to the roadmap, not Task #130's safe-fix list.

## 3. Misleading comment: `SubscriptionGuard`

**Confirmed by reading the code** (`subscription.guard.ts:29`): the comment says "single query, cached in Redis in production," but the method directly below it is a plain `this.db.query` with no Redis, no cache client, and no conditional "in production" branch anywhere in the file. The comment describes a caching behavior that does not exist in the code.

This guard runs on every request to a feature-gated route (`@RequireFeature(...)`), so it is a genuinely hot path — but there's no measured evidence this query is actually slow (it's a two-table join on primary-key-indexed columns, likely sub-millisecond in practice; this is an inference from the query shape, not a measured timing, since no APM/latency instrumentation exists to check — see `MONITORING_AND_INCIDENT_MANAGEMENT.md`).

**Implemented this phase:** the comment was corrected to describe what the code actually does (the false "cached in Redis" claim was removed) — a trivial, zero-risk documentation fix, no behavior change. **Real caching was deliberately not added** — there's no measured latency problem to justify it, and a subscription-status cache has real staleness risk (a downgraded/cancelled company could keep feature access past its actual expiry) that isn't worth taking on without evidence it's needed.

## 4. N+1-shaped sequential loop: `RiskService.recalculateProject()`

**Confirmed by reading the code** (`risk.service.ts:107-116`): the full-project "Refresh analysis" action iterates every risk-worthy graph node and calls `recalculateForNode()` sequentially, one at a time (`for (const node of nodes) { await this.recalculateForNode(...) }`), where each call does its own DB round-trips (signal lookup, exposure computation, upsert). For a project with hundreds of risk-worthy nodes (RFIs + issues + snags + drawings + QA inspections + submittals combined), this means hundreds of sequential round-trips for one user action.

**Scope of exposure is narrow, not a general request-path problem:** this endpoint (`POST .../risk/recalculate`) is gated behind `@RequireProjectPermission('manage_project_records')` — not called on every page load, only on an explicit "refresh analysis" action by an authorized user. The incremental path (`recalculateForEntity()`, used by the automatic RFI/Issue/Snag event hooks) only ever touches one node per call, so it doesn't have this shape at all.

**No measured timing exists** for how long a full recalculation actually takes on a realistically-sized project — this would need a project with a known node count and a wall-clock measurement, which wasn't available to run in this pass (no seeded large-project fixture exists in this environment). **Recommendation: do not optimize without that measurement.** Batching this into fewer round-trips is possible but adds real complexity (the per-node logic has node-type-specific branches and a careful "don't override an existing human assessment or matrix override" upsert — see the `CASE` logic kept intact in `risk.service.ts`'s upsert, which batching would need to preserve exactly). This is a "measure first" item, not a "fix now" item — flagged for the roadmap (P2), not Task #130's safe-fix list.

## 5. Dead dependencies in `apps/api/package.json`

**Confirmed via package.json and grep for actual usage:**

| Package | Confirmed usage in `src/` |
|---|---|
| `drizzle-orm` | None found |
| `drizzle-kit` | None found |
| `pg` | None found — the actual Postgres client used everywhere is the `postgres` package (`postgres.js`), confirmed in `database.module.ts` |
| `crypto` | None found — Node's built-in `crypto` module is used directly (no import needed at all); this npm package name shadows a Node builtin and serves no purpose here |

These appear to be leftovers from an earlier, since-replaced data-access approach (the current `DatabaseService`/`postgres.js` pattern is what's actually wired in everywhere). Keeping them costs: slightly slower `npm install`/CI, slightly larger `node_modules` in any Docker build context, and (for the `crypto` package specifically) genuine confusion risk for a future engineer who might `import 'crypto'` expecting the Node builtin and get this unrelated npm package instead.

**Recommendation (safe, low-risk):** remove all four from `apps/api/package.json`'s dependencies and run `npm install` to regenerate the lockfile, then re-run the full test suite and build to confirm nothing actually depended on them silently. Flagged in Task #130.

## 6. Frontend bundle: confirmed code-splitting gap

**Confirmed by reading `App.tsx` and `IssuesPage.tsx` directly:**
- `BimViewerPage`, `BimModelsPage`, `Viewer360`, `FloorPlanViewer`, and `BuildLensTimelinePage` are already route-level `lazy()`-loaded (`App.tsx:46-54`) — this was already done in a prior phase and remains correct; no further BIM/viewer splitting work is needed.
- `IssuesPage` is **not** lazy-loaded (`App.tsx:19` is a static `import`), and it statically imports the full `xlsx` library at module scope (`IssuesPage.tsx:4`) for its Excel-export feature. `xlsx` is a well-known large dependency. The practical effect: every user who loads the app at all pays for `xlsx` in their initial bundle, whether or not they ever touch Issues or export to Excel, and whether or not `IssuesPage` itself is ever visited.

**Implemented and measured this phase:** `IssuesPage.tsx`'s module-level `import * as XLSX from 'xlsx'` was changed to `const XLSX = await import('xlsx')` inside `exportIssuesToExcel()` itself — no feature change, the export button behaves identically. Two real `vite build` runs (before and after this change, not estimated) measured:

| | Before | After |
|---|---|---|
| Main (eager) bundle | 3,059.75 kB raw / 895.36 kB gzip | 2,772.67 kB raw / 798.57 kB gzip |
| `xlsx` | (bundled into main chunk, not separable) | own chunk: 429.03 kB raw / 143.08 kB gzip, loaded only on export click |

**Measured result: every user's initial page load is ~287 kB raw / ~97 kB gzip (≈11% of the main bundle) lighter**, and the `xlsx` cost now only applies to the subset of users who actually export to Excel. `npx tsc -b` was clean before and after; the full frontend build succeeded both times. Making `IssuesPage` itself route-lazy (it's still eagerly imported in `App.tsx`) is a reasonable follow-on but needs a `Suspense` boundary consistent with the existing lazy routes — not done in this pass, since the `xlsx` fix alone captures the bulk of the measurable win here for near-zero risk.

## 7. Database connection pool: unconfigured, using library defaults

**Confirmed by reading `database.module.ts`:** the `postgres()` client is constructed with host/port/database/credentials/SSL options only — no `max` (pool size), `idle_timeout`, or `connect_timeout` option is set. This means the connection pool runs at `postgres.js`'s built-in default (10 connections per instance) rather than a deliberately-chosen value.

**This is not necessarily wrong** — 10 is a reasonable default for a moderate-traffic API — but it is **unverified against this app's actual concurrency needs**, because no production traffic/connection-saturation metrics exist to check it against (see `MONITORING_AND_INCIDENT_MANAGEMENT.md` for the broader absence of APM). **Recommendation: do not change this speculatively.** Changing pool size without evidence of either connection exhaustion (errors/timeouts under load) or idle-connection waste is a guess, not an optimization. This is flagged as a "watch, don't touch" item pending real traffic data, consistent with this phase's "measure before optimizing" rule.

## 8. Storage tiering — not implemented, not recommended now

Confirmed: no cold/archival storage tier exists anywhere in the codebase (search for `storageTier`/`storage_tier`/archival-related code returned nothing). All capture/document/BIM files live in one storage class regardless of age or access frequency. **Not recommended as a near-term item** — this is a genuine cost optimization for a mature, large-scale deployment with meaningfully aged data, but there's no measured storage-cost or access-pattern data today to justify it, and it adds real complexity (a tiering policy, a migration path for existing objects, and retrieval-latency tradeoffs for tiered-down files). Noted for awareness, not actioned.

## 9. Index coverage — spot-checked, looks solid

42 of this project's migration files contain explicit `CREATE INDEX` statements, confirming index additions have been a consistent habit as the schema grew, not an afterthought. No systematic missing-index audit against live query plans was possible in this pass (no `EXPLAIN ANALYZE` access to representative production-sized data) — this is a code-level observation (indexes exist on the columns that matter for the query shapes seen while reading the code), not a verified-against-real-data audit.

## 10. Priority ranking of the above (highest value first)

1. **`image-processing` queue's missing `removeOnFail` cap (§1)** — one-line fix, prevents a slow-growing but real memory risk on a constrained Redis plan.
2. **`xlsx` dynamic import (§6)** — one-line-equivalent fix, directly reduces every user's initial page-load bytes, the most universally-felt performance win on this list.
3. **Dead dependency removal (§5)** — zero runtime effect, but reduces install/build time and removes a confusing `crypto` package-name collision.
4. **`drawings.service.ts` pagination (§2)** — protects against a real, if not yet triggered, unbounded-response risk as projects accumulate drawings.
5. **`SubscriptionGuard` comment fix (§3)** — zero functional change, but stops a future engineer from trusting a caching behavior that isn't there.

Items 6-9 (recalculation batching, connection pool tuning, storage tiering, further bundle splitting) are correctly left as "measure first" or "not needed yet" — implementing any of them now would be optimizing without evidence, which this phase's brief explicitly warns against.
