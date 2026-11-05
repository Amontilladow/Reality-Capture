# EngineeringOS: Performance and Infrastructure Optimization

**Phase 7: Continuous Improvement, AI Optimization & Product Growth**
Every finding below was checked directly against the current codebase and, where noted, a real local build/test run, rather than carried over from prior-phase documentation. The document separates **measured** facts from **code-level observations** (true of the code as written, not load-tested) and from **estimates**. It proposes no premature caching, no new microservices and no framework swaps; every recommendation ties back to a specific, confirmed finding.

---

## 1. Background job queues (Bull/Redis)

Three queues exist: `image-processing` (captures), `ifc-processing` (BIM models), `webhook-delivery`. All three retry with exponential backoff (`attempts: 3, backoff: { type: 'exponential', delay: 5000 }`) — confirmed by reading each module's `BullModule.registerQueue()` call.

| Queue | Completed-job cleanup | Failed-job cleanup |
|---|---|---|
| `ifc-processing` (`bim.module.ts`) | Capped at last 100 (`removeOnComplete: 100`) | Capped at last 100 (`removeOnFail: 100`) |
| `webhook-delivery` (`webhooks.module.ts`) | Capped at last 100 | Capped at last 100 |
| `image-processing` (`captures.service.ts`'s per-job `.add()` call) | Removed immediately (`removeOnComplete: true`) | **Never removed** (`removeOnFail: false`) |

**Confirmed, narrow finding:** unlike the other two queues, `image-processing` never prunes failed jobs. A completed job is cleaned up immediately, which bounds growth on the success path, but a permanently failed job (corrupted upload, unsupported format after 3 retries) stays in Redis forever. On the project's free-tier Redis plan, failed jobs piling up over time are a real, if slow-growing, memory risk. The caps aren't missing entirely (completed jobs are capped tightly); the gap is only on the failure path.

**Implemented this phase:** changed `removeOnFail: false` to `removeOnFail: 100` in `captures.service.ts`, matching the other two queues. It is a one-line change with no behavioral risk: failed job *records* help with debugging but aren't needed forever, and 100 is plenty for triage.

## 2. Unbounded query: `drawings.service.ts findAll()`

**Confirmed by reading the code** (`drawings.service.ts:90-105`): this query has no `LIMIT`/`OFFSET` and no pagination parameters. It returns every current drawing for a project in one response, with a `LEFT JOIN`+`GROUP BY` for linked-capture counts. For a project with a very large drawing set, both the result set and the join are unbounded: response size and query cost grow linearly with the number of drawings, with no ceiling.

**No other `findAll`-style method in the codebase showed this gap** during this review. Most list endpoints already take pagination parameters (e.g. the Issues/RFI list endpoints), so this looks like a one-off oversight in this file rather than a repo-wide pattern.

**Implemented this phase, scoped down from the original plan:** true pagination (`limit`/`offset` query params, a `{ rows, total }` response shape) would change this method's return shape, its controller route, and every frontend caller that currently consumes a plain array. That is new scope, not a low-risk fix, so it wasn't done. Instead, the query itself now has a `LIMIT 500`, with **no change to the response shape or any caller**. That bounds the worst case without touching the API contract. Real cursor/offset pagination is still a valid follow-on if a project ever exceeds 500 current drawings, but it isn't needed today and is on the roadmap rather than Task #130's safe-fix list.

## 3. Misleading comment: `SubscriptionGuard`

**Confirmed by reading the code** (`subscription.guard.ts:29`): the comment says "single query, cached in Redis in production," but the method directly below it is a plain `this.db.query` with no Redis, no cache client, and no conditional "in production" branch anywhere in the file. The comment describes a caching behavior that does not exist in the code.

This guard runs on every request to a feature-gated route (`@RequireFeature(...)`), so it is a hot path. But there's no measured evidence that the query is slow. It's a two-table join on primary-key-indexed columns and is probably sub-millisecond; that is an inference from the query shape, not a measurement, since no APM/latency instrumentation exists (see `MONITORING_AND_INCIDENT_MANAGEMENT.md`).

**Implemented this phase:** the comment now describes what the code does (the false "cached in Redis" claim was removed). This is a documentation-only fix with no behavior change. **Real caching was deliberately not added.** No measured latency problem justifies it, and a subscription-status cache carries real staleness risk: a downgraded or cancelled company could keep feature access past its actual expiry. That risk isn't worth taking without evidence that caching is needed.

## 4. N+1-shaped sequential loop: `RiskService.recalculateProject()`

**Confirmed by reading the code** (`risk.service.ts:107-116`): the full-project "Refresh analysis" action iterates every risk-worthy graph node and calls `recalculateForNode()` sequentially, one at a time (`for (const node of nodes) { await this.recalculateForNode(...) }`), where each call does its own DB round-trips (signal lookup, exposure computation, upsert). For a project with hundreds of risk-worthy nodes (RFIs + issues + snags + drawings + QA inspections + submittals combined), this means hundreds of sequential round-trips for one user action.

**The exposure is narrow, not a general request-path problem:** this endpoint (`POST .../risk/recalculate`) is gated behind `@RequireProjectPermission('manage_project_records')`. It isn't called on every page load, only when an authorized user explicitly runs "refresh analysis". The incremental path (`recalculateForEntity()`, used by the automatic RFI/Issue/Snag event hooks) touches one node per call, so it doesn't have this shape at all.

**There is no measured timing** for a full recalculation on a realistically sized project. That needs a project with a known node count and a wall-clock measurement, and this environment has no seeded large-project fixture to run it on. **Recommendation: do not optimize without that measurement.** Batching into fewer round trips is possible but adds real complexity: the per-node logic has node-type-specific branches and a careful upsert that must not override an existing human assessment or matrix override (see the `CASE` logic in `risk.service.ts`'s upsert, which batching would have to preserve exactly). Measure first. It is on the roadmap as P2, not on Task #130's safe-fix list.

## 5. Dead dependencies in `apps/api/package.json`

**Confirmed via package.json and grep for actual usage:**

| Package | Confirmed usage in `src/` |
|---|---|
| `drizzle-orm` | None found |
| `drizzle-kit` | None found |
| `pg` | None found. The actual Postgres client used everywhere is the `postgres` package (`postgres.js`), confirmed in `database.module.ts` |
| `crypto` | None found. Node's built-in `crypto` module is used directly (no import needed at all); this npm package name shadows a Node builtin and serves no purpose here |

These appear to be leftovers from an earlier, since-replaced data-access approach (the current `DatabaseService`/`postgres.js` pattern is what's actually wired in everywhere). Keeping them costs: slightly slower `npm install`/CI, slightly larger `node_modules` in any Docker build context, and (for the `crypto` package specifically) genuine confusion risk for a future engineer who might `import 'crypto'` expecting the Node builtin and get this unrelated npm package instead.

**Recommendation (safe, low-risk):** remove all four from `apps/api/package.json`'s dependencies and run `npm install` to regenerate the lockfile, then re-run the full test suite and build to confirm nothing actually depended on them silently. Flagged in Task #130.

## 6. Frontend bundle: confirmed code-splitting gap

**Confirmed by reading `App.tsx` and `IssuesPage.tsx` directly:**
- `BimViewerPage`, `BimModelsPage`, `Viewer360`, `FloorPlanViewer`, and `BuildLensTimelinePage` are already route-level `lazy()`-loaded (`App.tsx:46-54`). That was done in a prior phase and is still correct; no further BIM/viewer splitting work is needed.
- `IssuesPage` is **not** lazy-loaded (`App.tsx:19` is a static `import`), and it statically imports the full `xlsx` library at module scope (`IssuesPage.tsx:4`) for its Excel-export feature. `xlsx` is a well-known large dependency. The practical effect: every user who loads the app at all pays for `xlsx` in their initial bundle, whether or not they ever touch Issues or export to Excel, and whether or not `IssuesPage` itself is ever visited.

**Implemented and measured this phase:** `IssuesPage.tsx`'s module-level `import * as XLSX from 'xlsx'` was changed to `const XLSX = await import('xlsx')` inside `exportIssuesToExcel()` itself. Nothing changes for users; the export button behaves the same. Two real `vite build` runs, before and after the change, measured:

| | Before | After |
|---|---|---|
| Main (eager) bundle | 3,059.75 kB raw / 895.36 kB gzip | 2,772.67 kB raw / 798.57 kB gzip |
| `xlsx` | (bundled into main chunk, not separable) | own chunk: 429.03 kB raw / 143.08 kB gzip, loaded only on export click |

**Measured result: every user's initial page load is ~287 kB raw / ~97 kB gzip (≈11% of the main bundle) lighter**, and the `xlsx` cost now only applies to users who export to Excel. `npx tsc -b` was clean before and after, and the full frontend build succeeded both times. Making `IssuesPage` itself route-lazy (it's still eagerly imported in `App.tsx`) is a reasonable follow-on, but it needs a `Suspense` boundary consistent with the existing lazy routes. It wasn't done in this pass because the `xlsx` fix alone captures most of the measurable gain at almost no risk.

## 7. Database connection pool: unconfigured, using library defaults

**Confirmed by reading `database.module.ts`:** the `postgres()` client is constructed with host/port/database/credentials/SSL options only. No `max` (pool size), `idle_timeout`, or `connect_timeout` option is set. This means the connection pool runs at `postgres.js`'s built-in default (10 connections per instance) rather than a deliberately-chosen value.

**This is not necessarily wrong.** 10 is a reasonable default for a moderate-traffic API, but it is **unverified against this app's actual concurrency needs**, because no production traffic or connection-saturation metrics exist to check it against (see `MONITORING_AND_INCIDENT_MANAGEMENT.md` for the broader lack of APM). **Recommendation: do not change this speculatively.** Without evidence of connection exhaustion (errors/timeouts under load) or idle-connection waste, changing the pool size is a guess. Watch it and leave it alone until real traffic data exists, in line with this phase's "measure before optimizing" rule.

## 8. Storage tiering: not implemented, not recommended now

Confirmed: no cold/archival storage tier exists anywhere in the codebase (a search for `storageTier`/`storage_tier`/archival-related code returned nothing). All capture/document/BIM files live in one storage class regardless of age or access frequency. **Not recommended as a near-term item.** Tiering saves real money in a mature, large deployment with a lot of aged data, but there's no measured storage-cost or access-pattern data today to justify it, and it adds real complexity: a tiering policy, a migration path for existing objects, and slower retrieval for tiered-down files. Noted for awareness, not actioned.

## 9. Index coverage: spot-checked, looks solid

42 of this project's migration files contain explicit `CREATE INDEX` statements, so indexes have been added consistently as the schema grew. A systematic missing-index audit against live query plans wasn't possible in this pass (no `EXPLAIN ANALYZE` access to production-sized data). This is a code-level observation (indexes exist on the columns that matter for the query shapes seen in the code), not an audit against real data.

## 10. Priority ranking of the above (highest value first)

1. **`image-processing` queue's missing `removeOnFail` cap (§1)**: a one-line fix that removes a slow-growing but real memory risk on a constrained Redis plan.
2. **`xlsx` dynamic import (§6)**: an effectively one-line fix that cuts every user's initial page-load bytes. Of everything on this list, it is the improvement users will notice most widely.
3. **Dead dependency removal (§5)**: no runtime effect, but it shortens install/build time and removes a confusing `crypto` package-name collision.
4. **`drawings.service.ts` pagination (§2)**: protects against a real, not yet triggered, unbounded-response risk as projects accumulate drawings.
5. **`SubscriptionGuard` comment fix (§3)**: no functional change, but it stops a future engineer from trusting a caching behavior that isn't there.

Items 6-9 (recalculation batching, connection pool tuning, storage tiering, further bundle splitting) are left as "measure first" or "not needed yet". Implementing any of them now would be optimizing without evidence, which this phase's brief warns against.
