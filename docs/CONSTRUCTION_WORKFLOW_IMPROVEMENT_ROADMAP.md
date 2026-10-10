# EngineeringOS — Construction Workflow Improvement Roadmap

**Phase 7: Continuous Improvement, AI Optimization & Product Growth**
Grounded in a direct inventory of `apps/api/src/modules/{risk,reports,progress-reports,issues,rfis,drawings,workforce}` on branch `claude/awesome-ride-6e1dzu`. The brief's suggested-enhancement list is checked item-by-item against what's actually implemented before proposing anything new — several items are already built and are explicitly marked as such, not re-proposed.

---

## Part 1 — What's already implemented (do not rebuild)

| Brief's suggestion | Status | Evidence |
|---|---|---|
| Risk trend dashboards | **ALREADY IMPLEMENTED** | `RiskService.getProjectRiskTrend()` (7/14/30/90-day real historical snapshots), `getRiskHeatmap()`, `getRiskClusters()`, `getRiskByDiscipline()`/`getRiskByLocation()`, `getExecutiveSummary()`, `getTopRisks()`/`getEmergingRisks()`, an AI-generated risk briefing (`generateAiBriefing()`), a full Risk Graph with relationship chains (`getRiskChain()`, `getProjectGraph()`) — this is a mature, already-built subsystem (`risk.service.ts`, 1000+ lines). |
| Overdue action notifications | **ALREADY IMPLEMENTED for Issues** | `apps/api/src/modules/issues/issue-warning.service.ts` — a scheduled cron (`@Cron`) scans overdue issues company-wide and auto-warns the assignee, with a 24-hour de-duplication window so the same issue isn't re-warned repeatedly. |
| Project/engineering team workload indicators | **PARTIALLY IMPLEMENTED** | `apps/api/src/modules/workforce/reports/reports.service.ts` has `getCompanySummary()`; `workforce/productivity/productivity.service.ts` has per-user `getMyScore()`/`getMyScoreForRange()`. What's missing: a per-project (not just per-company) "who on this project currently has the most open issues/RFIs assigned" view — see Feature 4 below. |
| Construction progress reporting and timeline comparisons | **ALREADY IMPLEMENTED** | `apps/api/src/modules/progress-reports/` — `generate()` produces planned-vs-actual by element/zone, with PDF export and shareable tokenized public links (`createShare()`). |
| Engineering department KPIs | **ALREADY IMPLEMENTED** | `apps/api/src/modules/reports/reports.service.ts`'s `getKpis()` — project-wide issue/RFI/snag/submittal counts with PDF export. |

## Part 2 — Real gaps, in priority order

For each: user problem, intended roles, required source data, proposed workflow, expected benefit, technical complexity, data/privacy risks, dependencies, acceptance criteria.

### Feature 1 (highest priority) — RFI aging and automated response-delay alerts

**User problem:** RFIs already track `due_date` and an `overdue` COUNT exists in `getKpis()`/the RFI list filters, and a user can manually click "Send reminder" — but unlike Issues, there is **no automated cron-based escalation** for an RFI that's gone stale. An RFI sitting unanswered past its due date is purely dependent on someone noticing it in a list view or manually reminding; nothing proactively surfaces it. This is a direct parity gap against the Issues module's already-working pattern.

**Intended roles:** whoever holds `manage_rfis` on the project (for the escalation notification), plus the RFI's original creator (for visibility).

**Required source data:** `rfis.due_date`, `rfis.status`, `rfis.assigned_to` — all already exist. No new data collection needed.

**Proposed workflow:** mirror `issue-warning.service.ts`'s exact pattern — a new `rfi-warning.service.ts` with its own `@Cron` handler, scanning RFIs where `due_date < NOW()` and `status NOT IN ('answered','closed','void')`, sending a notification via the existing `MessagingService` (already imported in `rfis.service.ts`), with the same 24-hour de-duplication approach to avoid spamming.

**Expected business benefit:** reduces RFI response-delay risk (a real construction-contract concern — RFI turnaround time is often contractually time-bound) without requiring any new UI; reuses the exact proven pattern Issues already has.

**Technical complexity:** Low. This is near-identical in shape to existing, tested code (`issue-warning.service.ts` + its passing test suite can serve as the template).

**Data/privacy risks:** None beyond what the existing Issues warning cron already carries (it's a system-level cron reading across companies via `withSystemBypass`, exactly as Issues' warning cron already does safely).

**Dependencies:** None new — reuses `MessagingService`, the existing cron infrastructure (`@nestjs/schedule`, already in `app.module.ts`).

**Acceptance criteria:** an RFI with a past due date and status not in `answered/closed/void` generates exactly one notification per 24-hour window to its assignee; a test suite mirroring `issue-warning.service.spec.ts`'s structure passes.

### Feature 2 — Drawing submission and approval cycle analysis

**User problem:** `drawings` has a `revision` field, but nothing tracks **how long a drawing revision actually sits before being superseded or approved** — there's no concept of a drawing review/approval workflow state at all today (confirmed: no `status`/`approval_status` column on `drawings`, no approval-cycle timestamps). Construction teams commonly want to know "which drawings are bottlenecked in review" but the platform currently has no data model to answer that.

**Intended roles:** Technical Director, Engineering Manager, BIM Manager (whoever reviews/approves drawings in practice today — likely currently tracked outside the platform, e.g. in email or a separate system).

**Required source data:** **does not exist yet.** This would need a new `drawing_status` or similar column, and submission/review timestamps — a genuine schema addition, not a read-side analytics feature like Feature 1.

**Proposed workflow:** (proposed, not designed in detail here, since it requires a product decision on the actual desired approval states first) add a simple status field to drawings (e.g., `draft` → `submitted_for_review` → `approved`/`rejected`), timestamp each transition, then build a cycle-time report off that data once it exists.

**Expected business benefit:** real operational value if drawing approval delays are a known pain point for this platform's customers — but this needs to be validated with actual users before building, not assumed.

**Technical complexity:** Medium — new migration, new status-transition endpoints with their own authorization, a new report view.

**Data/privacy risks:** Low — this is internal workflow metadata, not sensitive content.

**Dependencies:** A product decision on the actual approval states wanted (this audit does not assume what they should be).

**Acceptance criteria:** not yet defined — this feature needs a scoping conversation before an acceptance criteria can be written honestly. **Recommend: validate with 2-3 real customer construction teams whether this is actually a pain point before building it**, per this brief's own instruction not to add every proposed feature automatically.

### Feature 3 — Recurring coordination problems / repeated-defect detection

**User problem:** confirmed via code search — **zero pattern-detection or recurrence-analysis exists anywhere in this codebase today.** Each Issue/Snag is tracked individually; nothing groups "we've had 5 similar MEP clash issues on Level 3 this month" into a visible pattern a Technical Director could act on (e.g., "stop and re-coordinate before continuing").

**Intended roles:** Technical Director, Engineering Manager, BIM Coordinator.

**Required source data:** `issues.discipline`, `issues.location_id`/`building_id`/`level_id`, `issues.issue_type`, `issues.created_at` — all already exist and are already queryable.

**Proposed workflow:** a new read-only report (no new data collection needed) that groups open+closed Issues by `(discipline, location, issue_type)` over a rolling window (e.g., 30/90 days) and surfaces any combination appearing above a configurable threshold (e.g., 3+ times) as a "recurring pattern" callout. This is pure aggregation over existing data — no prediction, no AI judgment call about causation, just a count-based surfacing of what's already true in the data.

**Expected business benefit:** genuinely high — recurring defects in the same discipline/location are a classic sign of a systemic coordination problem (bad shop drawing, miscommunicated spec) rather than isolated incidents, and currently nothing in the platform surfaces this pattern to anyone.

**Technical complexity:** Low-Medium — a single new aggregation query plus a small UI card; no new tables, no new write paths.

**Data/privacy risks:** None beyond existing Issues data already being queried for other reports.

**Dependencies:** None new.

**Acceptance criteria:** given a project with ≥3 issues sharing the same discipline+location+type within a configurable rolling window, the report surfaces that combination with a count and links to the underlying issues; a project with no such pattern shows none (no false positives on normal variation — threshold should default conservatively, e.g. 3+, not 2+).

**Caveat, directly per the brief's own instruction:** this is pattern **surfacing**, not prediction. It must never be presented as "this WILL happen again" — only "this HAS happened N times in this window," a factual count, not a forecast.

### Feature 4 — Project-level team workload view

**User problem:** `workforce/reports`/`workforce/productivity` give company-wide and per-user views, but there's no project-scoped "who on THIS project currently has the most open issues/RFIs assigned to them" view — useful for a Project Manager trying to rebalance assignments on one active project, who shouldn't need to go through a company-wide workforce report to find it.

**Intended roles:** Project Manager, Technical Director, whoever holds `manage_team` on the project.

**Required source data:** `issues.assigned_to`, `rfis.assigned_to`, `snag_items` assignee — all already exist.

**Proposed workflow:** a simple project-scoped aggregation: count of open Issues + open RFIs + open Snags per assignee, for members of this one project. No new data collection.

**Expected business benefit:** Medium — a convenience/visibility feature more than a transformative one, but low-cost to build given the data already exists.

**Technical complexity:** Low — a single new aggregation query, reusing patterns already in `reports.service.ts`'s `getKpis()`.

**Data/privacy risks:** None beyond what's already visible in each individual module's own assignee filters — this just aggregates data a project member can already see piecemeal.

**Dependencies:** None new.

**Acceptance criteria:** for a given project, returns each assigned member's open-item count across Issues/RFIs/Snags, sorted descending; a member with zero open items doesn't appear (avoid a noisy all-zero list).

### Feature 5 (lower priority, longer-term) — Document revision and approval bottleneck detection

**User problem:** similar to Feature 2 but for the general `documents` module (specifications, method statements, etc.) rather than drawings specifically. Same underlying gap: no workflow-state/timestamp model exists to measure "how long did this document sit in review."

**Status:** not designed in detail here for the same reason as Feature 2 — needs a product decision on the desired states before a technical design makes sense. Lower priority than Feature 2 (drawings) since drawings are typically the more contractually time-sensitive document type on a construction project.

## Part 3 — What was explicitly NOT recommended, and why

- **Predictive delay/cost forecasting** (the brief's own example of something to be cautious about): **not recommended** at this time. This platform has real historical risk-score and progress data, but nothing has been validated as a predictor of actual project delays or cost overruns — building a "forecast" feature on unvalidated data would misrepresent confidence the platform doesn't have. If this is wanted later, it requires a dedicated validation study against real historical project outcomes first, not a direct build.
- **Document revision bottleneck detection for every document type at once**: scoped down to drawings first (Feature 2) rather than building a generic system across documents+drawings+submittals simultaneously, to keep the first version small and validate the underlying workflow-state model before generalizing it.

## Part 4 — Recommended build order

1. **Feature 1 (RFI aging alerts)** — lowest complexity, highest confidence of value (direct parity with an already-proven pattern), zero new schema.
2. **Feature 3 (recurring defect detection)** — low-medium complexity, genuinely novel value, zero new schema.
3. **Feature 4 (project-level team workload)** — low complexity, moderate value, zero new schema.
4. **Feature 2 (drawing approval cycle)** — defer until validated with real customers; needs a schema decision.
5. **Feature 5 (document approval cycle)** — defer further; same reasoning as Feature 2, lower priority.

Features 1, 3, and 4 share a key property worth naming explicitly: **none require a new database table or a new write path** — they're all read-side aggregations over data the platform already collects for other purposes. That makes them genuinely low-risk, and they are the three carried into the 30/60/90-day roadmap's P1 tier (see `ENGINEERINGOS_30_60_90_DAY_ROADMAP.md`).
