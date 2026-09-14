# Workforce Intelligence™ — Architecture

Status: Phase 2 (Architect) output for the Workforce Intelligence initiative.
Written after Phase 1 discovery against this repository as it actually
exists — not against an assumed "EngineeringOS ecosystem" of separate
microservices. See **Correcting the premise** below.

## Correcting the premise

The originating directive assumes EngineeringOS is already a multi-service
ecosystem with Identity, Projects, BIM, QA/QC, etc. as independent modules
alongside a new Workforce Intelligence product. That is not what this
repository contains.

This repo (`engineeringos-reality`, package name in `package.json`) **is**
one product: the EngineeringOS Reality Capture module. It is a monolith:

- `apps/api` — a single NestJS application that owns **everything**:
  auth, tenancy, RBAC, billing/subscriptions, projects, BIM orchestration,
  captures, issues, RFIs, submittals, transmittals, QA inspections,
  snagging, documents, drawings, timeline, notifications, internal
  messaging, chat, audit logging. There is no separate "Identity service"
  or "Projects service" to integrate with — they're TypeScript modules in
  one process, sharing one Postgres database.
- `apps/web` — one React SPA, all modules as routes inside one `AppShell`.
- `apps/ifc-service` — the one genuinely independent service in the repo
  (IFC parsing worker, talks to Postgres/S3/Redis directly, zero code
  dependency on `apps/api`). This is the actual precedent for "how do we
  add something that must stay independently deployable."
- `apps/ai-service` — Python FastAPI, called fire-and-forget from
  `apps/api` for AI ingestion/search.
- `packages/types` — shared TypeScript types, CJS-compiled, consumed by
  both `apps/api` and `apps/web` as a workspace package.

Given this, "Workforce Intelligence integrates with Identity/Projects/BIM/
QA-QC as existing EngineeringOS modules" concretely means: **new NestJS
modules inside `apps/api`, reusing its existing auth guards, tenancy
middleware, and RBAC decorators, referencing existing tables
(`users`, `projects`, `issues`, `rfis`, `submittals`, `bim_elements`) by
foreign key.** It does not mean calling out to other deployed services.

## Existing architecture (as found)

| Layer | Technology | Notes |
|---|---|---|
| Frontend | React 18 + TypeScript + Vite, React Router 6, TanStack Query, Zustand (auth store only), Tailwind | One `lib/<domain>.api.ts` per backend domain; `AppShell` layout for chrome'd routes, full-bleed routes for immersive viewers (360°, BIM) |
| Backend | NestJS (TypeScript), REST, prefix `/api/v1` | One module per domain under `apps/api/src/modules/*`, each with `*.module.ts` / `*.controller.ts` / `*.service.ts` / `dto/` |
| Database | PostgreSQL, single shared DB | `postgres` (porsager) driver, tagged-template SQL, camelCase row transform. Sequentially numbered raw-SQL migrations in `apps/api/src/database/migrations/`, tracked in `_migrations` |
| Multi-tenancy | Row-Level Security | Every tenant table has `company_id` + a `tenant_isolation` RLS policy. Enforced by `DatabaseService.withTenant(companyId, fn)`, which does `SET app.current_company_id` inside the transaction. A query run outside `withTenant` (or `withTransaction` for system-level work) sees nothing under RLS, by design — this is a DB-level backstop against an app-level tenancy bug, not just a convention. |
| Auth | JWT (access + refresh), `apps/api/src/modules/auth` | `JwtAuthGuard` populates `request.user: AuthenticatedUser` |
| RBAC | Weighted company roles + narrow per-project grants | See below |
| Billing gating | Per-plan `feature_flags` JSONB on `subscription_plans` | `@RequireFeature('bim')` / `@RequireFeature('ai')` today; `SubscriptionGuard` returns 402 if the company's plan lacks the flag |
| Background jobs | Redis + Bull | Used today for image-processing and IFC-processing queues; `ScheduleModule` (`@nestjs/schedule`) already in use for cron (`issue-warning.service.ts`) |
| Object storage | S3-compatible (MinIO dev / R2 prod) | `StorageService`, presigned upload URLs |
| Audit | Global `AuditInterceptor` + append-only `audit_log` table | Route-pattern → (action, resourceType) mapping, checksummed rows, `UPDATE`/`DELETE` revoked from `app_user` |

### RBAC — the exact mechanism to reuse

There is **no** string-permission system like `workforce.view` /
`workforce.manage` in this codebase today. There are two real mechanisms,
and Workforce Intelligence should extend both rather than invent a third:

1. **`CompanyRole` weight hierarchy** (`packages/types/src/user.types.ts`):
   11 roles (`super_admin` → `client_representative`), each with an integer
   weight. `@Roles(...roles)` + `RolesGuard` compares the caller's weight
   against `Math.min(...requiredRoles.map(weight))` — i.e. "at least as
   senior as the least senior role listed." This is the right tool for
   "who can configure workforce monitoring policy company-wide" and "who
   can see roll-ups across the whole company/department" (`manage`,
   `manage_devices`, `manage_rules`, `manage_privacy`, `manage_settings`
   from the directive's permission list all map to a minimum company role,
   not a bespoke permission).
2. **`project_permission_grants`** (migration 024): a narrow, revocable,
   per-project, per-user grant of one named capability
   (`manage_team` / `manage_issues` / `manage_project_records` /
   `manage_rfis`), checked by `ProjectPermissionGuard` +
   `@RequireProjectPermission(...)`. A project's own `project_lead` gets
   these implicitly; anyone else needs an explicit grant. This is the right
   tool for "can this specific engineering/project manager see workforce
   data scoped to this one project" (`view_project` from the directive's
   list) without making it a company-wide role change.

Employee self-view (`view_own`) needs no new permission at all — it's just
"no `@Roles()`/`@RequireProjectPermission()` decorator, service filters by
`user.id`," the same pattern already used for e.g. an issue's `myIssues`
filter.

**Decision:** add `manage_devices`, `manage_rules`, `manage_privacy` as new
`project_permission_enum` values only if workforce configuration needs to
be delegated per-project; for the MVP, gate all workforce *configuration*
(application registry, privacy settings) at the `company_admin` weight via
`@Roles()`, and gate workforce *data access* by a mix of self-scoping
(employee), project membership (project_lead/manager), and company role
(department-head roll-ups). This avoids a second RBAC system entirely,
which section 24 of the brief explicitly requires.

### Multi-tenancy fit

Workforce tables are ordinary tenant tables: `company_id` column +
`tenant_isolation` RLS policy, exactly like every table in migration `001`.
No new tenancy pattern needed.

### Subscription/billing fit

Workforce Intelligence should be its own paid tier feature, gated the same
way `bim` and `ai` are gated today: add a `"workforce": false` key to the
`feature_flags` JSONB on `subscription_plans` (default off on all existing
tiers, enabled via a data migration only on the tiers the business wants),
and put `@RequireFeature('workforce')` on every workforce controller.

## Existing modules relevant to "Engineering Output" attribution

These are the real, queryable data sources for turning activity into
"what did this time produce" (brief §13), found in the migrations:

- `issues` / `issue_activities` (defects, punch items, clashes, safety,
  status transitions, `closed_by`/`closed_at`)
- `rfis` (with workflow fields — migration `028_rfi_workflow.sql`)
- `submittals`
- `qa_inspections`
- `snag_items` / `snag_activities`
- `bim_models` / `bim_elements` (drawings/models "modified", via
  `updated_at` and `bim_models.version`)
- `drawings` (revision field, `is_current`)
- `documents`

All of these already carry `created_by` / `assigned_to` / `closed_by` /
`uploaded_by` user references and `company_id`/`project_id`. Workforce
Intelligence's "Engineering Output" layer is read-only aggregation queries
against these existing tables joined by `user_id` + `project_id` + a date
range — **no schema changes to any existing module are required** to build
the v1 output-attribution view in the MVP/V1 sense (counts of
created/closed/resolved per user per project per period). Deeper
attribution (e.g., which specific Revit session produced which drawing
revision) needs the desktop agent's file-path/model-context signal, which
is V2, not MVP.

## Reality Capture — explicit non-interference

Per the brief's non-negotiable §22/§29: Reality Capture (captures, 360
timeline/BuildLens, hotspots, drawings) is untouched by this work. No
files under `apps/api/src/modules/captures`, `drawings`, `timeline`, or
`apps/web/src/pages/{CapturesPage,BuildLens*,Viewer360,FloorPlanViewer}`
are modified. Workforce Intelligence does not consume or publish Reality
Capture events in the MVP — there is no concrete use case yet ("an
engineer captured 12 photos" is not meaningfully different from "an
engineer used the Captures app for 40 minutes," which the activity model
already covers generically). If a future need appears (e.g., attributing
capture-upload time to a project automatically), it should be a new,
additive read of the existing `captures` table by `captured_by`/
`project_id`/`created_at` — never a change to Reality Capture's own code
path.

## Proposed Workforce Intelligence architecture

### Module boundary

```
apps/api/src/modules/workforce/
  workforce.module.ts
  devices/            -- device registration, heartbeat, revocation
  applications/        -- configurable application registry (CRUD)
  activities/           -- raw telemetry ingestion (idempotent, immutable)
  attribution/          -- project/task attribution + confidence scoring
  productivity/         -- derived, versioned, explainable scoring engine
  privacy/               -- per-company monitoring-level configuration
```

One module, several controllers — matching how `apps/api` already groups
related sub-resources (e.g. `bim/` holds models + hierarchy + elements
under one module rather than four).

### Independent-deployability boundary (the "could this be its own SaaS"
test, brief §33)

Workforce Intelligence is designed so the *data model and business logic*
have no dependency on Reality Capture's domain tables — only on the
platform primitives every module already depends on: `companies`,
`users`, `projects`, `project_members`. Its foreign keys into
project-specific "output" tables (`issues`, `rfis`, etc.) are one-directional
reads for the Engineering Output aggregation feature only; nothing in
Reality Capture ever reads a workforce table. Concretely:

- If Reality Capture's issue/RFI/BIM tables disappeared, Workforce
  Intelligence's core loop (device → activity → project attribution →
  time → productivity score → dashboard) still functions; only the
  "Engineering Output" panel would show zeros.
- If Workforce Intelligence's tables disappeared, no Reality Capture
  feature breaks (there are no inbound foreign keys from `issues`,
  `captures`, etc. into workforce tables).

This mirrors the `apps/ifc-service` precedent — the codebase's own proof
that "shares the DB and RLS pattern, zero code coupling" is a viable
extraction boundary here. Workforce Intelligence starts as modules inside
`apps/api` (fastest to ship, reuses the auth/RBAC/tenancy machinery
directly, matches brief §1's "native module" requirement), with the same
extraction seam `apps/ifc-service` demonstrates available later: its own
NestJS app, own copy of `DatabaseService`/tenancy, same Postgres, same
`_migrations` numbering discipline, communicating with `apps/api` only via
the shared DB (and a queue, once there's an async workload that needs
one — activity ingestion doesn't, at MVP volumes).

**Rejected alternative:** standing up Workforce Intelligence as a separate
service from day one. Rejected because (a) it would need to reimplement
auth/JWT verification, tenancy RLS wiring, and RBAC from scratch or call
back into `apps/api` for every request (network hop for what is currently
an in-process guard check), and (b) `apps/ifc-service` already shows the
codebase's chosen pattern for "logically independent, physically
integrated for now" — there's no reason to invent a second pattern before
the first one is proven necessary to break.

### Data flow

```
Desktop Agent (design only in MVP -- see below)
      │ HTTPS, batched, idempotent
      ▼
apps/api: POST /api/v1/workforce/activities/ingest
      │ writes immutable raw rows
      ▼
activities  (raw telemetry, RLS-scoped, append-mostly)
      │ read by
      ▼
productivity.service  (versioned, recalculable aggregation)
      │ writes
      ▼
productivity_scores  (derived, deletable/recomputable, never the source of truth)
      │ read by
      ▼
apps/web: WorkforcePage (employee self-view, MVP) → manager/dept views (V1/V2)
```

Raw vs. derived is a hard separation (brief §19): `activities` rows are
never mutated by the scoring engine, and `productivity_scores` carries a
`model_version` so re-running a changed formula is a `DELETE ... WHERE
model_version = ?` + re-insert, never an in-place UPDATE of history.

### Desktop Agent — designed, not built, in this pass

Building and code-signing an actual Windows/macOS agent is a separate,
multi-week engineering effort (native packaging, OS-level idle/active-app
APIs, auto-update, code signing certificates) that cannot be responsibly
produced or verified inside this repository/session. What *is* delivered
here is the contract the agent must speak — the ingestion API, the
activity/device schema, and the offline-queue design below — so that
building the agent is a contained, well-specified follow-up (see the
implementation plan's V1 phase) rather than an open-ended one. This is a
deliberate MVP boundary, not an oversight: brief §25's own MVP definition
("Employee → Device → Application Activity → Project Context → Time →
Basic Productivity Intelligence → Dashboard") only requires *that
activity data exists and flows through the pipeline*, not that a specific
client produced it. For MVP, activity rows can come from a seed/demo
script exercising the same ingestion API a real agent would call —
proving the pipeline end-to-end without shipping unverified endpoint
software.

Design for the eventual agent:

- **Stack**: TypeScript (Electron or a lighter cross-platform shell) —
  matches the rest of the org's stack, and Electron's `powerMonitor` +
  active-window libraries cover the Windows/macOS active-app/idle
  signals needed.
- **Signal set (configurable, off by default beyond the minimum)**:
  active application name + window title category (not full title, to
  avoid capturing document contents in the title bar), idle/active state
  (via OS idle-time API, not synthetic), domain (browser extension,
  optional, off by default), heartbeat, agent version, device
  fingerprint (hashed, not raw hardware IDs). Screenshots and keystroke
  logging are **not** built, and are represented in the schema (see the
  data model doc's `workforce_privacy_settings.screenshot_enabled`)
  purely as a policy switch a company could one day opt into with
  its own dedicated capture pipeline and explicit consent flow — no
  code path for actually capturing a screenshot exists in this MVP.
- **Offline-first queue**: local encrypted append-only log (SQLite or
  flat file with OS keychain-backed encryption key), flushed via the
  batched `/activities/ingest` endpoint on a timer + on reconnect.
  Each queued activity carries a client-generated UUID
  (`clientEventId`) — the server's ingestion endpoint upserts on
  `(deviceId, clientEventId)` so a retried batch after a dropped
  connection is a no-op, not a duplicate (brief §30's "duplicate
  events" test target).
- **Auth**: per-device long-lived token (not the user's own JWT) issued
  at enrollment, revocable independently of the user's account
  (device compromise ≠ account compromise). Schema includes `devices`
  for this; MVP issues a device row but authenticates ingestion calls
  with the enrolling user's normal JWT for simplicity, with device-token
  auth flagged as a V1 hardening item (see implementation plan).

### AI layer

Not built in MVP. The brief's AI questions (§15) require a corpus of
real productivity-score history and engineering-output data that won't
exist until V1 activity volume accumulates; building an "AI insights"
feature against zero real data would mean fabricating plausible-sounding
output, which the brief explicitly forbids (§13 "DO NOT fabricate
productivity metrics"). Deferred to V2, reusing `apps/ai-service`'s
existing ingestion pattern (fire-and-forget calls from `apps/api`) rather
than inventing a second AI integration path.

## Risks and constraints

- **Trust/legal risk dominates technical risk.** Employee monitoring
  software has real UAE/GCC and general employment-law disclosure
  requirements this document does not and cannot resolve (brief §17
  explicitly excludes legal advice) — flagged for the Product
  Owner/legal review before any real device ships activity data for
  real employees, independent of engineering readiness.
- **Volume growth of `activities`.** Even at MVP scope, one heartbeat +
  app-switch event per few seconds per employee is a high-write table.
  The schema uses append-only inserts with an index on
  `(company_id, user_id, started_at)` and a monthly-partition-ready
  design (not partitioned at MVP scale, but the `started_at`-keyed shape
  means partitioning is a later `ALTER`, not a redesign) — see the data
  model doc.
- **Project-attribution confidence is genuinely hard.** File-path/BIM-
  model/document-metadata signals (brief §12, mechanisms 3-6) need the
  desktop agent's file-system visibility, which doesn't exist until the
  agent does. MVP ships only mechanisms 1 (manual selection) and 2 (task/
  active-project context) with honest confidence scores; the richer
  signals are V1/V2 and must not be faked with a hardcoded high
  confidence in the meantime.
- **Anti-gaming has no MVP answer beyond design intent.** Mouse-jiggler
  detection etc. is explicitly out of scope for MVP; the schema's
  `confidence` and multi-signal design (activity + project context + task
  + output) is the intended long-term defense, not a feature to build now.
