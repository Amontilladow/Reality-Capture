# Workforce Intelligence™ — Implementation Plan

Companion to `workforce-intelligence-architecture.md`. Covers competitive
research, the product challenge, MVP/V1/V2/Future scope, and the
file-level blast radius of this work.

## Competitive capability vs. EngineeringOS opportunity

Capabilities below are the well-established, generally-known feature sets
of these categories of product (time tracking / activity monitoring /
insights platforms), not a claim about any vendor's current UI or pricing.
We are not copying any vendor's proprietary implementation — this is
pattern-level research to decide what's worth building, not a spec to
clone.

| Capability pattern (seen across DeskTime/Hubstaff/ActivTrak/Time
Doctor/Teramind/Viva Insights) | EngineeringOS opportunity |
|---|---|
| Active/idle time, app & URL tracking | Table stakes — needed as the raw signal, but not the product. Ship it as `activities`, never surface "active time %" as the headline metric. |
| Periodic or continuous screenshots | Deliberately **not** built (see Product Challenge). High employee-distrust cost, real legal exposure, and the brief explicitly makes it optional/configurable at most. |
| Productivity % = active time / total time, or a hardcoded "productive app" list | This is the thing to *not* copy. It's gameable (open Revit, go to lunch) and says nothing about output. Our differentiator is the Activity→Project→Task→Deliverable chain the brief lays out in §6 — no competitor in this category connects time to BIM/RFI/issue/submittal output, because none of them own that domain data. This is a real, defensible advantage specific to EngineeringOS. |
| Project/task time allocation via manual timers or manual tagging | We can do meaningfully better by *inferring* project context from what a competitor can't see: which BIM model is open, which project's RFI/issue is active in the same app session — confidence-scored, not asserted as fact (brief §12). |
| Manager leaderboards / employee ranking | Explicitly the wrong pattern per brief §16 ("avoid simplistic employee rankings") — skip entirely, at every tier. |
| Shift scheduling (preferences + assignment) and an absence request/approve calendar | Originally called out of scope in this row (clock-in/clock-out attendance, with its own labor-law compliance surface, genuinely still is). Built at explicit later product direction, scoped deliberately narrow to avoid that surface: no leave-balance accrual, no overtime/break-law logic, no payroll integration -- a preference grid, a per-date assigned-shift table, and a plain request/approve workflow. See migration `040_workforce_scheduling.sql`'s own header comment. |
| Per-app productivity classification (configurable) | Directly worth building — the brief's §11 application registry, seeded with construction/engineering tools (Revit, Navisworks, Bluebeam, Aconex, etc.) instead of generic office-suite categories a competitor ships. |
| Desktop + browser agent, offline queue | Necessary infrastructure, not a differentiator — build it competently (see architecture doc), don't over-invest relative to the intelligence layer above it. |
| "Insights"/AI narrative summaries | Valuable *once there's real output data to summarize* — premature before V1 has months of real activity + real issue/RFI throughput to correlate. Building it against thin data would produce exactly the "fabricated productivity metrics" the brief prohibits. |

## Challenging the product (brief §5)

**What is valuable:** the Activity→Project→Engineering-Output chain
(brief §6). It's the one thing this product can do that a bolt-on time
tracker cannot, because EngineeringOS already owns the issue/RFI/
submittal/BIM data. Everything else in this space is a commodity.

**What is unnecessary for this product to build itself:** attendance/
clock-in, leave management, payroll integration, generic office-app
productivity taxonomies. These are solved problems elsewhere; building
them here dilutes the differentiator and adds compliance surface (labor
law) unrelated to engineering output.

**What could create employee distrust (and should shape defaults):**
screenshots and keystroke logging (not built — see below), any
"productivity score" presented without its contributing factors,
manager-vs-employee visibility asymmetry with no employee self-view, and
silent monitoring-policy changes. Mitigations: factors always shown
alongside a score (brief §14), an employee self-view dashboard shipped in
MVP (not deferred to V2), and privacy-policy changes going through
`audit_log` like every other sensitive action in this codebase already
does.

**What could be misleading:** presenting `INFERRED` project attribution
or any AI output as `OBSERVED` fact. The data model and API respond to
this by carrying `confidence` and an `OBSERVED|INFERRED|RECOMMENDED` tag
as first-class fields, never optional decoration.

**What could become technically expensive:** raw activity telemetry at
real scale (brief §26 — 100k+ employees). Mitigated by the append-only/
partitionable schema (see data model doc) and by *not* building
screenshot storage, which is the single biggest storage/egress cost
center in this product category and the one with the least defensible
ROI here.

**What could become impossible to scale operationally, not just
technically:** a scoring formula that isn't versioned. If "productivity
score" changes meaning silently between releases, every historical
report becomes incomparable and every manager conversation built on last
month's number is retroactively wrong. Solved by `model_version` on
`productivity_scores` (recalculable, never mutated in place).

**What could create privacy/legal concerns:** cross-border employee
monitoring (UAE/GCC and other jurisdictions have disclosure/consent
requirements this document does not attempt to satisfy), screenshot/
keystroke capture, and browsing history for personal use during a work
session. Flagged for legal review before any production rollout collects
real employee data — engineering readiness is not the same as compliance
readiness here, and this plan does not claim the latter.

**What could be gamed:** app-open-but-idle ("mouse jiggler"), superficial
task status changes with no real output. The brief's own answer (§18) —
activity + project + task + engineering output + quality, never a single
signal — is the right one; there is no MVP anti-gaming feature beyond
that multi-signal design (see architecture doc's Risks section).

**What should NOT be built (this pass or possibly ever):** screenshots,
keystroke logging, browser history capture, employee rankings/
leaderboards, a bespoke second RBAC/permission-string system, a second AI
integration path (reuse `apps/ai-service`), a fully separate deployed
service for Workforce Intelligence before there's a concrete reason
`apps/api` can't serve the load.

**What should be postponed:** the desktop agent binary itself (V1), rich
file-path/BIM-context project inference (V1/V2), manager/dept-head/PM
dashboards beyond employee self-view (V1), AI insights (V2), external
integrations — Aconex/Procore/ACC/M365/Teams/Outlook/P6 (V2/Future,
adapter architecture only for now).

## MVP / V1 / V2 / Future

**MVP (this implementation pass):**
- Schema: `devices`, `application_registry`, `activities`,
  `activity_project_links` (attribution + confidence + evidence),
  `productivity_scores`, `workforce_privacy_settings`.
- API: device registration, batched idempotent activity ingestion,
  application registry CRUD (company_admin+), own-activity summary,
  a v1 explainable productivity calculation (utilization + engineering-app
  share, from real ingested data only — never fabricated).
- Per-app productivity classification (productive/neutral/unproductive/
  unclassified) is now wired end-to-end: newly-seen apps auto-register as
  `unclassified` on ingest, an admin screen classifies them, and the
  resulting productive/neutral/unproductive/unclassified time split is
  surfaced as an additional, transparent breakdown next to the v1 score —
  deliberately *not* blended into `score` itself, per this doc's own
  warning above against copying "productivity % = active/total time" as
  the headline metric. It's shown as one more factor, never a ranking.
- The `apps/browser-extension` package (Manifest V3, no bundler) closes the
  "URL tracking" half of the "active/idle time, app & URL tracking" row
  above: it reports the active tab's *hostname only* (never full URL,
  path, or page content) for the same domain-level productivity
  classification, and needed zero backend changes since `platform: 'web'`
  and `source: 'browser_extension'` were already valid, unused values in
  the original MVP schema. Same "Private Time" control as the desktop
  agent applies to it for free (same `'PRIVATE'` activity type, same
  server-side force-redaction).
- A Google Calendar integration (OAuth connect/disconnect + a live
  "today's events" read) exists, scoped deliberately narrow: it does not
  write calendar events into `activities` or factor them into scoring.
  Real credentials to a live Google account were never available to test
  against in the environment this was built in -- see migration 041's
  header comment and `google-calendar-client.ts`'s own comment for what
  is and isn't verified. Writing calendar events into `activities` (real
  idempotency/dedup design needed) is an explicit, deferred follow-on.
- RBAC: reuses `@Roles()` / `@RequireProjectPermission()` /
  `@RequireFeature()` exactly as designed in the architecture doc.
- Frontend: employee self-view page (today/this-week activity breakdown,
  project attribution list with confidence, productivity factors).
- No desktop agent binary — ingestion proven via the API contract +
  seed data, per the architecture doc's explicit reasoning.
- No screenshots, no keystroke logging, no AI layer, no manager/dept
  dashboards, no external integrations.

**V1:**
- Real desktop agent (Electron), offline queue, per-device auth tokens,
  code signing and auto-update.
- Manager and Project Manager dashboards (team workload, planned vs.
  actual project effort).
- Engineering Output aggregation view (reads existing `issues`/`rfis`/
  `submittals`/`qa_inspections`/`bim_models` tables by user/project/period
  — no schema changes to those modules).
- Richer project-attribution signals (active BIM model, active document).
- `workforce_privacy_settings` UI + audit-logged policy changes.

**V2:**
- AI insights layer (via `apps/ai-service`), with mandatory
  OBSERVED/INFERRED/RECOMMENDED labeling.
- Department-head dashboards, capacity/staffing indicators.
- Anti-gaming heuristics beyond multi-signal design (e.g. idle-vs-active
  app-focus consistency checks).
- Optional, explicitly-consented, separately-architected screenshot
  capability — only if a real customer need and legal sign-off exist by
  then. Not assumed.

**Future:**
- Extraction to an independent `apps/workforce-service`, mirroring
  `apps/ifc-service`'s pattern, if/when Workforce Intelligence needs to
  ship as a standalone SaaS product.
- External adapters: Aconex, Procore, ACC, Microsoft 365/Teams/Outlook,
  Primavera P6 — architecture allows these as read-only context providers
  for project attribution, none implemented now.

## Files/modules that will change

- New: `apps/api/src/database/migrations/037_workforce_intelligence.sql`
- New: `apps/api/src/modules/workforce/**`
- Edited: `apps/api/src/app.module.ts` (register `WorkforceModule`)
- New: `packages/types/src/workforce.types.ts`
- Edited: `packages/types/src/index.ts` (barrel export)
- New: `apps/web/src/lib/workforce.api.ts`
- New: `apps/web/src/pages/WorkforcePage.tsx`
- Edited: `apps/web/src/App.tsx` (route registration)
- Edited: navigation component that lists project routes (adds a
  "Workforce" entry) — located and updated during implementation, not
  redesigned.
- New: `docs/workforce-intelligence-*.md` (this set of documents)
- Edited (additive only): `apps/api/src/common/interceptors/audit.interceptor.ts`
  — four new `ROUTE_MAP` entries for workforce mutations, the same pattern
  every existing module already uses to register its own routes there. No
  guard/RBAC/audit *logic* in this file changes.

## Files/modules that must NOT change

- Everything under `apps/api/src/modules/captures`, `drawings`,
  `timeline`, `bim`, `documents`, `issues`, `rfis`, `submittals`,
  `transmittals`, `qa`, `snagging`, `chat`, `messaging`,
  `notifications`, `ai-client`, `auth`, `tenancy`, `subscription`
  (except the additive `feature_flags` data migration described in the
  architecture doc — no code change to `SubscriptionGuard` itself).
- `apps/ifc-service`, `apps/ai-service` — untouched.
- `apps/web/src/pages/{CapturesPage,BuildLens*,Viewer360,FloorPlanViewer,
  BimModelsPage,BimViewerPage,IssuesPage,RfisPage,RfiDetailPage,
  SnaggingPage,QaInspectionsPage,SubmittalsPage,TransmittalsPage,
  DocumentsPage,MessagesPage,AssistantPage,ReportsPage}` — untouched.
- Any existing migration file (001–036) — never edited in place; only new,
  additive migrations.
- `apps/api/src/common/guards/*`, `apps/api/src/common/decorators/*` — the
  RBAC/tenancy/feature-flag machinery is reused as-is, not modified,
  unless a new `project_permission_enum` value is added in a later phase
  (not required for MVP).

## Testing plan (MVP scope)

- Tenant isolation: an activity/device row created under company A is
  invisible to a request authenticated as company B (mirrors existing
  RLS tests elsewhere in the suite).
- Idempotent ingestion: submitting the same `(deviceId, clientEventId)`
  batch twice yields one row, not two.
- Project-attribution confidence: manual selection yields confidence 1.0
  with `OBSERVED` evidence; no-context activity yields low/no confidence
  rather than a fabricated guess.
- Productivity calculation: given a fixed set of activity rows, the v1
  formula produces the expected score and returns its contributing
  factors (not just a number).
- Authorization: an employee cannot read another employee's activity via
  the "own summary" endpoint; a `company_admin` can manage the
  application registry, a lower-weight role cannot.
- Existing suite: `pnpm --filter api test` run after changes, confirming
  zero regressions in modules this work does not touch.
