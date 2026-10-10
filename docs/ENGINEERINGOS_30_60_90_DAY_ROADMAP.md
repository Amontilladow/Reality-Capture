# EngineeringOS — 30/60/90-Day Roadmap

**Phase 7: Continuous Improvement, AI Optimization & Product Growth**
Synthesizes every finding across this phase's documents into a single prioritized plan. Every task states its business justification, effort, dependencies, running cost, regression risk, success metric, acceptance criteria, and whether it needs your approval before starting. Nothing here is built by virtue of being listed — P0/P1 items marked "no approval needed" are small, safe, zero-cost code changes consistent with this engagement's "fix only clearly-safe defects" rule; everything else is a proposal.

---

## First 5 actions (do these first)

1. **Add structured auth-failure logging** (P0, §1 below) — closes a confirmed real security-visibility gap, zero cost, needs your sign-off only because it touches auth code.
2. **Decide the BYO-AI-fallback policy** (P0, §1) — a product decision already fully scoped in `AI_USAGE_AND_COST_POLICY.md` §5; the fix itself is small once decided.
3. **Add a company deactivation endpoint** (P0, §1) — closes a confirmed operational gap (no way to cut off a company today).
4. **Build the self-service company registration frontend form** (P1, §2) — the backend already works; this is the single highest commercial-leverage item for the least backend risk.
5. **Build RFI aging alerts** (P1, §2) — the highest-value construction-workflow feature identified, mirrors an existing cron pattern exactly, zero new schema.

---

## P0 — Critical (security, reliability, data integrity)

### P0-1: Structured auth-failure logging
- **Justification:** confirmed zero visibility today into failed logins or invalid-token attempts (`MONITORING_AND_INCIDENT_MANAGEMENT.md` §2) — an existing code comment claiming this is handled is false.
- **Effort:** small (a few `logger.warn()` calls in `AuthService.login()` and `JwtAuthGuard`).
- **Dependencies:** none.
- **Running cost:** $0.
- **Regression risk:** low — logging-only, no behavior change.
- **Success metric:** a failed login attempt produces a log line with email/IP/timestamp (never the attempted password).
- **Acceptance criteria:** verified by a new test asserting the log call fires on a failed login.
- **Approval needed:** yes — touches authentication code, should be reviewed before merge even though it's additive-only.

### P0-2: Decide and implement the BYO-AI-fallback policy
- **Justification:** confirmed silent fallback to the platform's own paid provider on any BYO error, with no approval/spend gate (`AI_USAGE_AND_COST_POLICY.md` §5) — directly contradicts this engagement's own mandatory rule on provider fallback approval.
- **Effort:** small once a decision is made (Option A: fail the request instead of silently falling back, when a BYO connection is configured).
- **Dependencies:** your decision between Option A/B/C in `AI_USAGE_AND_COST_POLICY.md` §5.
- **Running cost:** $0 (Option A actually prevents unapproved spend; Option B would need new schema).
- **Regression risk:** low for Option A (changes error behavior only for an edge case — a BYO user whose own provider is down).
- **Success metric:** zero platform-provider spend attributable to a BYO user's own outage, going forward.
- **Acceptance criteria:** new test confirming a BYO-configured user gets a clear error, not a silent platform-provider answer, when their connection fails.
- **Approval needed:** yes — this is the decision itself, not a side detail.

### P0-3: Company deactivation endpoint
- **Justification:** confirmed zero way to deactivate a company today despite `is_active` being fully enforced everywhere it's checked (`SAAS_COMMERCIAL_READINESS.md` §5) — a real operational/security gap (no way to cut off a company that should no longer have access).
- **Effort:** small — one new platform-operator-only endpoint plus a service method.
- **Dependencies:** none.
- **Running cost:** $0.
- **Regression risk:** low — new endpoint, no change to existing paths; must be restricted to a platform-operator role, never company-admin-accessible.
- **Success metric:** a deactivated company's users are immediately locked out (already true once `is_active=false`, since `TenancyGuard`/`AuthService` already check it).
- **Acceptance criteria:** new test confirming the endpoint sets `is_active=false` and a subsequent request from that company is rejected.
- **Approval needed:** yes — a destructive-feeling capability (even though reversible) that should be reviewed, and access-restricted correctly, before shipping.

---

## P1 — High-value, measurable

### P1-1: Self-service company registration frontend
- **Justification:** the backend (`POST /company/register`) already works end-to-end but has zero frontend form (`SAAS_COMMERCIAL_READINESS.md` §1) — the single cheapest path to new self-service signups.
- **Effort:** medium — a registration form + validation + routing, no backend change.
- **Dependencies:** none.
- **Running cost:** $0.
- **Regression risk:** low — new page, doesn't touch existing flows.
- **Success metric:** number of self-service signups per week (currently unmeasurable — zero exist, since the form doesn't exist).
- **Acceptance criteria:** a new company can sign up through the UI without any manual/API intervention.
- **Approval needed:** no for the build itself; recommend a quick design check-in since it's a new user-facing page.

### P1-2: Stand up a staging environment
- **Justification:** confirmed zero staging environment — every merge to `main` goes straight to production (`RELEASE_MANAGEMENT.md` §1,§3) — the single highest-leverage reliability gap identified this phase.
- **Effort:** medium — a second Render environment + database, gated manual promotion.
- **Dependencies:** none technically, but needs your approval for the new infrastructure cost.
- **Running cost:** **a new recurring cost** (a second running web service + database instance) — not quoted here since no specific tier has been chosen; needs explicit approval per this engagement's cost-approval rule.
- **Regression risk:** none to existing production (additive infrastructure).
- **Success metric:** percentage of deploys validated in staging before reaching production (0% today).
- **Acceptance criteria:** a deploy can be promoted from staging to production as a distinct, deliberate step.
- **Approval needed:** **yes — this is the one item in this entire roadmap with a real new recurring dollar cost.**

### P1-3: Wire storage-quota enforcement into upload paths
- **Justification:** the check (`checkLimit('storage', ...)`) is fully written but never called (`SAAS_COMMERCIAL_READINESS.md` §4) — a company can exceed its plan's storage allotment indefinitely today.
- **Effort:** small — call the existing method from the capture/document/BIM upload services, mirroring the existing project/user-limit pattern.
- **Dependencies:** none.
- **Running cost:** $0.
- **Regression risk:** medium-low — changes user-facing behavior (uploads can now be rejected for quota); needs a heads-up, not a silent ship.
- **Success metric:** a company at its storage limit receives a clear rejection instead of unlimited overage.
- **Acceptance criteria:** new test confirming an upload is rejected once `storage_used_bytes + size > max_storage_bytes`.
- **Approval needed:** yes — user-facing behavior change.

### P1-4: RFI aging alerts (construction workflow)
- **Justification:** highest-priority new feature identified in `CONSTRUCTION_WORKFLOW_IMPROVEMENT_ROADMAP.md` — mirrors the existing `issue-warning.service.ts` cron pattern exactly, zero new schema needed.
- **Effort:** small-medium — one new cron job + notification, following an established pattern.
- **Dependencies:** none.
- **Running cost:** $0.
- **Regression risk:** low — additive, no existing behavior changes.
- **Success metric:** number of RFIs flagged before breaching their response-time expectation, vs. after (currently zero are flagged proactively).
- **Acceptance criteria:** per the full spec in `CONSTRUCTION_WORKFLOW_IMPROVEMENT_ROADMAP.md`'s Feature 1.
- **Approval needed:** no for the build (follows an established, already-approved pattern); confirm scope matches the roadmap doc first.

### P1-5: Versioned AI evaluation dataset + harness
- **Justification:** no repeatable way to check AI correctness/safety across model or prompt changes exists today (`AI_EVALUATION_FRAMEWORK.md` §3).
- **Effort:** small — mostly a JSON file + a Jest suite for the free (no-provider-call) cases.
- **Dependencies:** none.
- **Running cost:** near-$0 — only the live-provider subset costs tokens, against existing quota.
- **Regression risk:** none — new test infrastructure only.
- **Success metric:** domain-guard classification pass rate against the versioned dataset, trackable release over release.
- **Acceptance criteria:** dataset + harness exist and run in CI for the free cases.
- **Approval needed:** no.

---

## P2 — Valuable follow-on

| Item | Source | One-line justification |
|---|---|---|
| Recurring-defect pattern detection | `CONSTRUCTION_WORKFLOW...md` Feature 3 | Zero new schema, pure aggregation |
| Project-level team workload view | `CONSTRUCTION_WORKFLOW...md` Feature 4 | Zero new schema |
| Product feedback system (`product_feedback` table + UI) | `PRODUCT_FEEDBACK_AND_GOVERNANCE.md` | Currently zero way for a user to report a bug in-product |
| Company settings admin UI (write side) | `SAAS_COMMERCIAL_READINESS.md` §2 | Read side (risk matrix) already works; needs a form |
| Per-company custom limit overrides, wired or removed | `SAAS_COMMERCIAL_READINESS.md` §3 | Dead schema — decide to use it or drop it |
| Differentiated third-party failure logging | `MONITORING_AND_INCIDENT_MANAGEMENT.md` §3 | Diagnosability improvement, not a reliability bug |
| `product_events` table (analytics Layer 2) | `PRODUCT_ANALYTICS_AND_ADOPTION.md` | Needed for real adoption/completion-rate measurement |
| Drawing approval-cycle tracking | `CONSTRUCTION_WORKFLOW...md` Feature 2 | Needs a schema/product decision first |
| Document revision bottleneck detection | `CONSTRUCTION_WORKFLOW...md` Feature 5 | Lower priority than Feature 2 |
| Full-company data export | `SAAS_COMMERCIAL_READINESS.md` §6 | Trust/compliance value, no current customer request |

## P3 — Optional experiments (not recommended without a demonstrated need)

| Item | Why it's P3, not higher |
|---|---|
| RAG from authorized documents | Real new infrastructure + ongoing embedding cost; no demonstrated gap in current tool-based AI answers |
| AI model tiering | No measured cost/latency problem to optimize against yet |
| AI response caching | No measured repeated-question pattern to justify it; real staleness risk |
| Storage tiering (cold/archival) | No measured storage-cost problem yet; real complexity |
| Full E2E browser test suite | Valuable but substantial new tooling investment; current unit/integration coverage (594 tests) is a solid floor |
| Feature-flag system for staged rollout | Worth adopting for the *next* substantial feature, not worth building ahead of having one |

---

## Success metrics — what's measured vs. unavailable

Per this phase's own rule: labeled explicitly, nothing invented.

| Metric | Status |
|---|---|
| Frontend main bundle size (before/after `xlsx` fix) | **Measured this phase**: 895.36kB → 798.57kB gzip |
| Full test suite pass rate | **Measured this phase**: 594/594, 60/60 suites, both before and after all changes |
| `ai_usage_log` token-count completeness | **Was 0% (NULL on every row) before this phase's fix; 100% from this point forward** — no historical cost data exists before the fix, and none is invented here |
| Self-service signup volume | **Unavailable** — the feature (P1-1) doesn't exist yet to measure |
| Production incident count/MTTR | **Unavailable** — no incident tracking/APM exists yet (see `MONITORING_AND_INCIDENT_MANAGEMENT.md`) |
| AI response correctness/citation accuracy | **Unavailable** — no evaluation dataset exists yet (P1-5 creates the means to measure this going forward, not a retroactive number) |
| Storage-quota breach frequency | **Unavailable** — enforcement doesn't run yet (P1-3), so there's nothing to have measured |

No metric in this roadmap was estimated or invented where real data didn't exist — each unavailable row says so plainly rather than guessing a plausible-sounding number.
