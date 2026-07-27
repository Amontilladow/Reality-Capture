# EngineeringOS — TECHNICAL_DECISIONS.md

Every significant decision made across this project's sessions, with
reasoning. Treat these as settled unless a verified problem emerges.

---

## Architecture: standalone `apps/ifc-service`, not embedded in `apps/api`

**Decision:** IFC processing runs as its own independently-deployable
NestJS app, communicating with `apps/api` only via a shared Redis/Bull
queue and the shared Postgres database — zero code coupling.

**Why:** Explicitly directed (not just proposed) partway through the IFC
engine work. Reasoning that held up: independent deployability/scaling
for a CPU/memory-heavy, bursty workload; blast-radius isolation (a crash
in geometry parsing doesn't take down the API); clean dependency-graph
separation (browser-oriented `three.js`-adjacent packages don't need to
be anywhere near the rest of the API's dependencies).

**Rejected alternative:** embedding IFC processing as an in-process Bull
processor inside `apps/api` (the way the older `image-processing` queue
for captures already works). Rejected once independent deployability was
made an explicit requirement.

---

## Library choice: `web-ifc` + `@thatopen/fragments`, not IfcOpenShell or `ifc-lite-core`

**Decision:** documented in full in `IFC_ARCHITECTURE_PROPOSAL.md`,
approved before any implementation began.

**Why `web-ifc` over IfcOpenShell:**
- Stack fit — pure WASM, runs natively in the same Node/NestJS process
  as everything else; IfcOpenShell is Python, would need a cross-service
  call through `apps/ai-service` for a core, synchronous-feeling flow.
- License — MPL-2.0 (permissive, file-level) vs. LGPL (more legal-review
  friction for a closed-source commercial SaaS).
- Performance — faster on large files in independent benchmarks and
  IfcOpenShell's own documented issues; this was explicitly a
  requirement given real construction BIM models routinely exceed
  several hundred MB.
- IfcOpenShell remains the stronger choice for a hypothetical future
  need to *author* (write back) IFC files — this decision doesn't
  foreclose adding it later for that specific purpose.

**Why not `ifc-lite-core` (Rust/WASM, newer entrant):** compelling
benchmark numbers, but too new/unproven for a v1.0 launch (recent project,
small install base, API could still change). Flagged as worth
re-evaluating in a future quality pass, not adopted now.

**Why Bull (`@nestjs/bull`), not BullMQ:** the platform already had a
working Bull-based queue (`image-processing` for captures). Reusing the
same library guarantees producer (`apps/api`) and consumer
(`apps/ifc-service`) share the exact same Redis job format with zero
compatibility risk. Switching only the new queue to BullMQ would have
meant two different queue libraries in the same platform for no
functional benefit.

---

## Resumability design: stage-level, not element-level

**Decision:** the IFC pipeline is broken into ordered stages; each
stage's DB writes happen in one transaction that clears prior output for
that model and sets a `stage_completion` flag atomically. Retries skip
stages already marked complete, but re-run an entire stage from scratch
if it didn't finish.

**Why:** true element-level checkpointing (resuming mid-stage from the
exact last-processed element) would need a persisted cursor and much more
complex state management, for uncertain benefit at current model sizes.
Stage-level resume is safe (idempotent — each stage clears its own prior
output before re-writing) and dramatically simpler to reason about and
verify. Documented explicitly as a real, honest limitation rather than
overclaiming finer granularity — see `KNOWN_ISSUES.md`.

**Rejected alternative:** element-level/batch-level checkpointing within
a stage. Not rejected permanently — flagged as a legitimate future
enhancement once/if very large models make whole-stage-redo too costly.

---

## Database: single shared Postgres, row-level security by `company_id`

**Decision:** both `apps/api` and `apps/ifc-service` connect to the same
Postgres database directly (not through each other), both implementing
their own `withTenant()` helper that sets
`current_setting('app.current_company_id')` per transaction, matching
the existing RLS pattern already established before the IFC engine work
began.

**Why:** consistency with the existing tenancy model; avoids introducing
a second, different multi-tenancy mechanism for the new service.

**Note:** `apps/ifc-service`'s `DatabaseService` is a deliberate,
independent re-implementation of the same pattern, not an import of
`apps/api`'s version — preserves the "zero code coupling" architecture
decision above at the cost of some duplication. Accepted tradeoff.

---

## `bim_element_relationships` stores GUIDs, not foreign keys

**Decision:** relationship edges (aggregates, contained-in-structure,
voids, fills) are stored as `relating_guid`/`related_guid` text columns,
not foreign keys to `bim_elements.id`.

**Why:** either side of a relationship can be a spatial node or an
element, and GUIDs are the stable IFC-native identity that both share.
This also decoupled relationship-writing from needing every element's
database UUID to already exist, which mattered for how the pipeline
stages are ordered (relationships can be written in a stage that doesn't
depend on the properties-extraction stage having populated an in-memory
element-UUID map).

---

## `apps/web` build config: explicit `commonjsOptions.include` for workspace packages

**Decision:** `apps/web/vite.config.ts` explicitly includes
`packages/types` in Rollup's CJS-to-ESM conversion, rather than changing
`packages/types` to ship ESM output or changing its module system.

**Why:** the root cause is that Vite/Rollup's default `commonjsOptions`
only processes `node_modules/**`, not pnpm-workspace-symlinked packages —
this is a generic Vite/monorepo interaction, not specific to this
package's module format. Fixing it at the Vite-config level is the
smallest, most targeted fix and doesn't risk breaking `apps/api`/
`apps/ifc-service` (both Node/CommonJS consumers of the same package,
which work correctly as-is).

**Rejected alternative:** converting `packages/types` to dual CJS+ESM
output, or changing the workspace to hoist/install it as a real
`node_modules` package instead of a symlink. Both are larger, riskier
changes for the same outcome.

---

## Security: JWT auth + RBAC, unchanged this phase

No new security decisions were made in the BIM engine/viewer work — it
reuses the existing `JwtAuthGuard`/`RolesGuard` pattern (guard order
matters: Throttler → Jwt → Roles, established in an earlier session) and
the existing tenancy/RLS model. Presigned S3 URLs (both upload and
Fragments download) expire after a configured interval
(`S3_PRESIGN_EXPIRES_IN`, default 3600s) — no new exposure introduced.

---

## Testing philosophy: empirical verification over assumption, applied consistently

Not a single decision but a running practice worth recording: every
non-trivial third-party API used this phase (`web-ifc`, `@thatopen/
fragments`, `@thatopen/components`) was verified against the actual
installed `.d.ts` files and small real test scripts *before* being used
in production code, rather than assumed from training data or general
familiarity with similar libraries. This caught several real, subtle
issues before they ever ran in the full pipeline (e.g., the `ModelIdMap`
type duplication, the exact shape of web-ifc's property/quantity
objects). Recommend continuing this practice for any new third-party
library introduced in future work, especially fast-moving ones like the
ThatOpen ecosystem.
