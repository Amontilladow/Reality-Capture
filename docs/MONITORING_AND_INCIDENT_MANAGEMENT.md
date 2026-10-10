# EngineeringOS — Monitoring and Incident Management

**Phase 7: Continuous Improvement, AI Optimization & Product Growth**
Every finding below is verified against the actual code and deployment config (`render.yaml`), not assumed from prior phases. This phase does not add any new paid monitoring service — every proposal below is explicitly flagged as needing approval before any cost is incurred.

---

## 1. Current state: logs exist, but are ephemeral and unaggregated

**Confirmed by reading `main.ts` and `render.yaml`:**
- Logging uses NestJS's built-in `Logger` throughout, with no configurable log level anywhere in the codebase (`grep` for `LOG_LEVEL`/`logLevel` across `src/` returns nothing) — the application always logs at the framework default, with no environment-based quieting for production.
- `render.yaml` has no log-drain, log-shipping, or external-aggregation configuration of any kind. Render's own platform log retention applies (logs are not held indefinitely and are not searchable/alertable beyond whatever Render's own dashboard offers) — there is no first-party log aggregation (e.g. a self-hosted ELK/Loki stack or a paid service like Datadog/Sentry) anywhere in this deployment.
- **Confirmed: zero APM** (Application Performance Monitoring) — no Sentry, Datadog, New Relic, or any APM SDK/dependency exists anywhere in `apps/api` or `apps/web`'s `package.json`, confirmed by searching for each by name.
- **Confirmed: zero `/metrics` endpoint** — no Prometheus client, no metrics route, nothing exposing request counts, latencies, or error rates in a machine-readable form.

**Practical effect:** any incident investigation today depends entirely on manually reading Render's raw log stream for the relevant time window — there is no dashboard, no saved query, no alert that fires on an error-rate spike, and no historical trend view.

## 2. CONFIRMED real gap: authentication failures leave literally zero trace

This is the most actionable finding in this document.

- `AuditInterceptor` (`audit.interceptor.ts:130`) explicitly skips unauthenticated requests, with the comment `// unauthenticated mutation — skip (auth failures logged separately)`.
- **That comment is false.** Verified by reading every file in `modules/auth/` and `common/guards/jwt-auth.guard.ts`: there is no logging of a failed login attempt, an invalid/expired JWT, or any auth rejection anywhere in this codebase. `AuthService` has exactly two `logger.error()` calls, for an unrelated DB write failure and an unrelated email-send failure — neither is an auth-failure log.
- **Consequence:** a brute-force password-guessing attempt against `/auth/login`, or a script probing endpoints with invalid/expired tokens, produces **no record anywhere** — not in `audit_log` (deliberately skipped), not in application logs (never written), not in any alert (none exist to fire). The only thing that would eventually stop a brute-force attempt is `ThrottlerGuard`'s rate limiting (confirmed to exist in the guard chain from Phase 6's audit) — but even a rate-limited flood of failed logins generates zero visibility that it happened.

**Recommendation (safe, not yet implemented — flagged for approval since it touches a security-sensitive path and should be reviewed, not silently added):** add a single `logger.warn()` call in `AuthService.login()`'s failure branch and in `JwtAuthGuard` on token-validation failure, logging (at minimum) the attempted email/username, source IP, and timestamp — explicitly **never** the attempted password. This is a small, contained change but touches authentication code, so it's listed here as a recommendation for your approval rather than applied unilaterally in this pass, consistent with "fix only clearly-safe defects, flag the rest."

## 3. Third-party integration failures: generic, not differentiated

- **Outlook/Gmail OAuth:** confirmed (Phase 6's integration review, re-checked this phase) that connection/send failures for either provider are caught and logged, but without a structured field distinguishing which provider or failure stage (token refresh vs. send vs. malformed response) produced the error — an engineer reading the log has to parse the free-text message to know what actually happened.
- **The AI client's vector-store dependency (Qdrant/embeddings):** `ai-client.service.ts`'s `logDown()` helper logs `AI service call failed (${context})` for every failure path (delete, generic calls) — a single generic warning shape regardless of which underlying call failed. This means a Qdrant outage, a network timeout, and a malformed embeddings response are all visually indistinguishable in the log stream without reading the surrounding code.

**This is a logging-detail gap, not a missing-handling gap** — every one of these paths already degrades gracefully (the code's own comment confirms "never surface a 500 for an AI outage"), so there's no reliability bug here, just reduced diagnosability when something does go wrong.

## 4. What alerting exists today: none

No alerting mechanism of any kind exists — no email/Slack/PagerDuty integration tied to an error condition, no uptime check, no "X errors in Y minutes" rule. The only thing resembling monitoring is the GitHub Actions post-deploy health-check workflow (confirmed in Phase 6's review — `.github/workflows/post-deploy-health-check.yml`), which checks that the app is reachable immediately after a deploy, not an ongoing monitor.

## 5. Proposed, not built: minimal monitoring additions

Consistent with "actionable alerts with configurable thresholds" and no new paid service without approval:

| Proposal | What it would need | Cost |
|---|---|---|
| Structured auth-failure logging (§2) | Code change only | $0 — flagged for approval, not a cost question |
| Differentiated third-party failure logging (§3) | Code change only (add a `provider`/`stage` field to existing log calls) | $0 |
| A `/health` deep-check endpoint (DB + Redis reachability, not just "process is up") | Small code addition; Render's existing health-check workflow could point at it | $0 |
| Real APM (Sentry or similar) | A new paid service/subscription | **Needs explicit cost approval** — typical SaaS APM pricing is usage/seat-based; no number is quoted here since no plan has been chosen or approved |
| Log aggregation/search (e.g. a hosted log service) | A new paid service, or a self-hosted stack (itself a new maintenance burden) | **Needs explicit cost approval** |

**Recommendation:** the two $0 code-only items (auth-failure logging, differentiated third-party failure logging) are the highest-value, lowest-cost next step and are flagged in the roadmap as P0/P1 candidates. The paid options are explicitly not recommended without a demonstrated incident that existing visibility failed to catch — speculative APM spend isn't justified by anything measured in this pass.

## 6. Incident severity, escalation, and recovery — process, not code

No formal incident-response process exists in this codebase (this is expected — it's an organizational process, not something code implements). Proposed classification, consistent with industry-standard severity framing and this platform's actual blast-radius shape (multi-tenant, RLS-isolated):

| Severity | Definition | Example | Target response |
|---|---|---|---|
| **SEV1** | Platform-wide outage, or any cross-tenant data exposure | API fully down; a tenancy-isolation bypass confirmed in production | Immediate — all available engineering attention |
| **SEV2** | Single company/feature significantly degraded, no data exposure | AI assistant down platform-wide; one company's uploads failing | Same business day |
| **SEV3** | Isolated, workaround exists | One user's export feature erroring | Next business day |
| **SEV4** | Cosmetic / minor | A UI label is wrong | Normal backlog |

**Recovery runbook reference:** `docs/INCIDENT_AND_RECOVERY_RUNBOOK.md` (written in Phase 6) already covers backup/restore procedures and known-issue remediation steps — this document doesn't duplicate that; it adds the monitoring/visibility layer that runbook assumes exists when deciding "is this actually happening."

**Post-incident review:** proposed practice (not a new system) — for any SEV1/SEV2, a short written note covering what happened, how it was detected (or *should* have been detected, if visibility was the gap — directly relevant given §2's finding), what fixed it, and one concrete follow-up action. This is a process convention to adopt, not a feature to build.

## 7. Monitoring must never record sensitive content

Explicit design constraint for any future monitoring work (per this phase's own mandatory rule): any new logging, alerting, or APM integration must **never** record credentials, OAuth/API tokens, full request/response bodies containing project content (RFI text, issue descriptions, document contents), or unnecessary PII beyond what's needed to identify *that* an auth failure or error occurred (user id/email, not full user profile data). The auth-failure logging proposed in §2 is deliberately scoped to exclude the attempted password for exactly this reason. Any third-party APM/log-aggregation tool evaluated in the future must be checked against this constraint before adoption, not after.

## 8. Summary

| Area | Status |
|---|---|
| Logs exist | Yes, but ephemeral, unaggregated, no configurable level |
| Auth failures logged | **No — confirmed false claim in existing code comment, genuine gap** |
| Third-party failures logged | Yes, but generically (not differentiated by provider/stage) |
| APM | None |
| `/metrics` endpoint | None |
| Alerting | None |
| Incident severity framework | Proposed in this document, not previously formalized |
| New recurring cost from this document | **$0** — every proposal needing spend is explicitly flagged as pending approval, nothing was purchased or provisioned |
