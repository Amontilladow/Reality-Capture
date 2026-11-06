# EngineeringOS: Product Analytics and Adoption

**Phase 7: Continuous Improvement, AI Optimization & Product Growth**
Based on a direct read of `apps/api/src/common/interceptors/audit.interceptor.ts` and `apps/api/src/modules/ai/ai-usage.service.ts`. The platform already has two production, RLS-protected, company/project-scoped event tables (`audit_log`, `ai_usage_log`) that cover a good part of what's being asked for here. **The core design principle of this document: extend what exists and duplicate nothing.** No third-party analytics SaaS (PostHog, Mixpanel, Segment, Amplitude) is proposed. Everything here runs on the existing Postgres instance at no new recurring cost.

---

## 1. What's already captured (verified, not estimated)

`audit_log` (migration `001_initial_schema.sql`, `AuditInterceptor` applied globally to every mutating request) already records, per event: `company_id`, `project_id`, `user_id`/`user_email`/`user_name`, `action`, `resource_type`/`resource_id`, `ip_address`, `user_agent`, `occurred_at`. Confirmed events already covered via `ROUTE_MAP`:

- `auth.login` / `auth.logout`
- `project.created` / `project.updated`
- `issue.created` / `issue.updated`
- `document.uploaded`
- `building.created` / `level.created` / `location.created`
- `bim.model_uploaded`
- `user.invited`
- `capture.created` / `capture.updated`
- Access-control changes (`project_member.added/removed`, `project_permission.granted/revoked`, `snag_item.verified`)

`ai_usage_log` (migration `062_ai_usage_log.sql`) already records every AI Assistant request: `company_id`/`project_id`/`user_id`/`user_role`, `status` (allowed/blocked/error), `category`, `provider`, `model`, `input_tokens`/`output_tokens`, `latency_ms`, `block_reason`/`error_message`. This already satisfies the brief's "AI assistant requests, failures, and successful responses" requirement with no new work.

**Conclusion: company/project creation, drawing/document uploads, issue creation, BIM activity, and AI assistant usage are already analytics-ready today.** This document's job is to (a) show admins this existing data in a useful form, and (b) fill the specific gaps below, without rebuilding what exists.

## 2. Real gaps (verified by grep, not assumed)

| Requested event | Status | Evidence |
|---|---|---|
| RFI creation, response, closure | **GAP** | No `rfis`-matching pattern anywhere in `ROUTE_MAP`. These currently fall through to the generic URL-derived fallback, which the code's own comment admits produces "unreadable labels." |
| Issue/snag **closure** specifically (not just creation) | **PARTIAL GAP** | Issue creation is captured; issue/snag status-change-to-closed is not distinctly labeled (falls into the generic `issue.updated` bucket, indistinguishable from any other edit). Snag creation isn't captured at all (only `snag_item.verified` is). |
| Issue/snag/RFI **assignment** | **GAP** | Assignment happens via the same generic update endpoints; not distinctly tracked. |
| Help Centre usage (article views, searches, unresolved queries) | **GAP: no backend trace exists at all.** | `grep -rln "help.*article\|HelpCentre\|help-centre" apps/api/src/modules/` → zero matches. The 132-article Help Centre (built in Phase 4) is purely static frontend content (`apps/web/src/content/help/*.ts`) with no backend interaction logged anywhere. |
| Onboarding completion | **GAP (partial)** | `onboardingCompleted` is stored (a `PATCH /users/:id` preference flag, confirmed in Phase 6's permission-matrix review), but this route isn't in `ROUTE_MAP` either, so it's not distinctly labeled. |
| Use of reports/dashboards | **GAP** | These are `GET` requests; `AuditInterceptor` only fires on `POST`/`PUT`/`PATCH`/`DELETE` by design (to keep routine read traffic out of the audit trail). That's reasonable for an *audit* log, but it means no dashboard/report **view** data exists anywhere today. |
| Workflow completion rates / delays (not just counts) | **GAP** | Both `audit_log` and `ai_usage_log` record individual point-in-time events; nothing today computes a derived "time from RFI created to RFI answered" or "% of started onboarding flows that finish". This requires a query layer on top of existing data, not new collection. |

## 3. Design: three layers, reusing what exists

### Layer 1: Extend `audit_log`'s `ROUTE_MAP` (near-zero cost, no schema change)
Add RFI lifecycle entries (`rfi.created`, `rfi.responded`, `rfi.closed`) and snag-creation (`snag_item.created`) to the existing `ROUTE_MAP` in `audit.interceptor.ts`, exactly matching the pattern already used for Issues. It is a code-only change: no migration, no new table, no new write path, and it reuses infrastructure already running in production. **Classified as safe to implement in this engagement** (see §7).

### Layer 2: A new, minimal `product_events` table for what has no mutating-request shape
Views, searches, and "I didn't find what I needed" signals aren't `POST`/`PATCH` requests, so `AuditInterceptor` cannot capture them. They need a new, deliberately small table:

```sql
CREATE TABLE IF NOT EXISTS product_events (
  id            BIGSERIAL PRIMARY KEY,
  company_id    UUID NOT NULL REFERENCES companies(id),
  project_id    UUID REFERENCES projects(id),
  user_id       UUID NOT NULL REFERENCES users(id),
  user_role     VARCHAR(30) NOT NULL,
  event_name    VARCHAR(60) NOT NULL,   -- e.g. 'help_article_viewed', 'help_search', 'help_search_no_results', 'report_viewed', 'onboarding_step_completed'
  event_target  VARCHAR(255),           -- e.g. the article slug, the report type, the onboarding step name -- never free text, never confidential content
  metadata      JSONB,                  -- small, structured, non-sensitive only (see data-minimization rule below)
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_product_events_company_time ON product_events(company_id, created_at DESC);
CREATE INDEX idx_product_events_event_time   ON product_events(event_name, created_at DESC);
-- Same tenant_isolation RLS policy pattern as every other company-scoped table.
```

This table is proposed, not yet implemented in this engagement. It is a schema change (new migration), and under this brief's own rules that counts as "substantial new functionality" that needs your sign-off before it's built, even though it adds no cost or third-party dependency. See §7 for what WAS implemented without asking (Layer 1 above) versus what's proposed here for your decision.

### Layer 3: Derived/aggregate views, computed from Layers 1+2 (no new collection, read-side only)
Once Layers 1-2 exist, workflow-completion metrics are plain SQL aggregation over timestamps already collected, with no new tracking:
- RFI response time: `rfi.responded.occurred_at - rfi.created.occurred_at`, grouped by project/discipline.
- Onboarding completion rate: `COUNT(DISTINCT user_id WHERE event_name='onboarding_step_completed' AND event_target='final') / COUNT(DISTINCT user_id WHERE event_name='onboarding_step_completed' AND event_target='first')`.
- Help Centre "struggle" signal: `help_search_no_results` events grouped by search term. This answers "which features are users struggling to discover," with no new infrastructure.

## 4. Privacy, data minimization, and retention

- **Company/project boundary enforcement:** the same as `audit_log`'s existing pattern. Every row is scoped by `company_id` (and `project_id` where applicable), behind the same RLS `tenant_isolation` policy already proven in production. An admin querying analytics only ever sees their own company's data, enforced at the database layer as well as the application layer.
- **Data minimization, concretely:** `product_events.event_target` is restricted to a closed set of short identifiers (an article slug, a report-type enum, an onboarding-step name), never free-text search queries verbatim (a search query could contain a project name, a client name, or other confidential content a user typed). **Recommendation: log only a normalized/bucketed form of search terms** (e.g. the matched article's category, not the raw query string) for the "no results" signal, to avoid ever storing what a user typed.
- **No confidential engineering content:** nothing in this design touches issue descriptions, RFI questions/answers, document contents, or any field containing actual project engineering information. It records only that an action happened, by whom, when, and which static resource (an article slug, a report type) was involved.
- **No unnecessary personal information:** `user_id` is already a foreign key the platform uses everywhere for authorization; no new PII field is introduced. `ip_address`/`user_agent` (already on `audit_log`) are deliberately NOT copied onto the new `product_events` table. They're useful for security audit trails but not needed for adoption analytics, and leaving them out is a deliberate data-minimization choice.
- **Configurable retention:** neither `audit_log` nor `ai_usage_log` has any retention/purge policy today (confirmed: no `DELETE FROM audit_log`/`ai_usage_log` exists anywhere in the codebase, so both tables grow forever). **Recommendation:** add a configurable retention window, e.g. a scheduled job deleting `product_events` rows older than N months, with N configurable per company and a default like 13 months (enough for year-over-year comparison without indefinite accumulation). `audit_log`/`ai_usage_log` need the same fix, not just the new table. That part is not fixed in this engagement, because it affects existing tables with existing data and needs your sign-off.

## 5. What this gives administrators

Once Layers 1-3 exist, a company admin can see (scoped to their own company only):
- Adoption funnel: invited users → accepted invitation → completed onboarding → created first project artifact (issue/RFI/document).
- Feature discovery gaps: which Help Centre articles get the most "no results" searches near them (signals a missing article or a mis-worded one) and which modules have near-zero usage despite being available to the company's plan.
- Workflow health: median RFI response time, median issue time-to-close, by project and by discipline. A Technical Director can act on this, unlike page-view counts.
- AI Assistant adoption: already available today via `ai_usage_log`: request volume, block rate (how often the domain guard rejects an off-topic question), by role.

## 6. What this deliberately does NOT do

- No dashboard for watching individual users (e.g. no "show me everything User X clicked today"). Aggregated/cohort views only, in line with the data-minimization principle above.
- No cross-company benchmarking visible to any single company (a company only ever sees its own aggregates, same RLS boundary as every other company-scoped table).
- No heatmaps, session replay, or client-side behavior-capture library. Those are invasive and depend on third parties, which this design avoids by staying on the existing first-party Postgres infrastructure.

## 7. Implementation status in this engagement

- **Layer 1 (RFI/Snag `ROUTE_MAP` additions):** implemented this engagement; see the companion code change and `PRODUCTION_READINESS_REPORT.md`-style verification in the Phase 7 commit. Zero schema change, reuses existing `audit_log` infrastructure exactly as designed above.
- **Layer 2 (new `product_events` table) and Layer 3 (aggregate views/admin UI):** **proposed, not implemented.** They need a new table (schema change) and a new admin-facing surface (UI work). The scope is bounded, but it goes beyond this engagement's "safe, no new infrastructure" bar for implementing without approval. Recommended as a P1 item in `ENGINEERINGOS_30_60_90_DAY_ROADMAP.md`, pending your approval.
