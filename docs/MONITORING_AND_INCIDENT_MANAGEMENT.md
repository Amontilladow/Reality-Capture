# EngineeringOS: Monitoring and Incident Management

**Phase 7: Continuous Improvement, AI Optimization & Product Growth**
Every finding below was checked against the actual code and deployment config (`render.yaml`), not carried over from prior phases. This phase adds no new paid monitoring service, and every proposal below needs approval before any cost is incurred.

---

## 1. Current state: logs exist, but are ephemeral and unaggregated

**Confirmed by reading `main.ts` and `render.yaml`:**
- Logging uses NestJS's built-in `Logger` throughout, with no configurable log level anywhere in the codebase (`grep` for `LOG_LEVEL`/`logLevel` across `src/` returns nothing). The application always logs at the framework default, with no environment-based quieting for production.
- `render.yaml` has no log-drain, log-shipping, or external-aggregation configuration. Render's own platform log retention applies: logs are not kept indefinitely and can't be searched or alerted on beyond what Render's dashboard offers. There is no first-party log aggregation (e.g. a self-hosted ELK/Loki stack or a paid service like Datadog/Sentry) anywhere in this deployment.
- **Confirmed: no APM** (application performance monitoring). No Sentry, Datadog, New Relic, or other APM SDK/dependency appears in `apps/api` or `apps/web`'s `package.json`; each was searched for by name.
- **Confirmed: no `/metrics` endpoint.** No Prometheus client, no metrics route, nothing that exposes request counts, latencies, or error rates in machine-readable form.

**Practical effect:** investigating an incident today means reading Render's raw log stream for the relevant time window by hand. There is no dashboard, no saved query, no alert on an error-rate spike, and no historical trend view.

## 2. CONFIRMED real gap: authentication failures leave literally zero trace

This is the most actionable finding in this document.

- `AuditInterceptor` (`audit.interceptor.ts:130`) explicitly skips unauthenticated requests, with the comment `// unauthenticated mutation — skip (auth failures logged separately)`.
- **That comment is false.** Verified by reading every file in `modules/auth/` and `common/guards/jwt-auth.guard.ts`: there is no logging of a failed login attempt, an invalid/expired JWT, or any auth rejection anywhere in this codebase. `AuthService` has exactly two `logger.error()` calls, for an unrelated DB write failure and an unrelated email-send failure. Neither is an auth-failure log.
- **Consequence:** a brute-force password-guessing attempt against `/auth/login`, or a script probing endpoints with invalid/expired tokens, leaves **no record anywhere**: not in `audit_log` (deliberately skipped), not in application logs (never written), and not in any alert (none exist). The only thing that would eventually stop a brute-force attempt is `ThrottlerGuard`'s rate limiting (confirmed in the guard chain during Phase 6's audit), but even a rate-limited flood of failed logins leaves no sign that it happened.

**Recommendation (safe, not yet implemented, needs approval because it touches a security-sensitive path):** add a single `logger.warn()` call in `AuthService.login()`'s failure branch and in `JwtAuthGuard` on token-validation failure. Log at least the attempted email/username, source IP, and timestamp, and **never** the attempted password. The change is small, but it touches authentication code, so it is listed here for your approval instead of being applied in this pass, following the rule "fix only clearly safe defects, flag the rest."

## 3. Third-party integration failures: generic, not differentiated

- **Outlook/Gmail OAuth:** confirmed (Phase 6's integration review, re-checked this phase) that connection/send failures for either provider are caught and logged, but with no structured field saying which provider or which stage failed (token refresh vs. send vs. malformed response). An engineer reading the log has to parse the free-text message to find out what happened.
- **The AI client's vector-store dependency (Qdrant/embeddings):** `ai-client.service.ts`'s `logDown()` helper logs `AI service call failed (${context})` for every failure path (delete, generic calls), the same generic warning whichever underlying call failed. A Qdrant outage, a network timeout, and a malformed embeddings response all look the same in the log stream unless you read the surrounding code.

**This is a gap in logging detail, not in error handling.** Every one of these paths already degrades gracefully (the code's own comment says "never surface a 500 for an AI outage"), so there's no reliability bug here, only less to go on when something does go wrong.

## 4. What alerting exists today: none

No alerting mechanism exists: no email/Slack/PagerDuty integration tied to an error condition, no uptime check, no "X errors in Y minutes" rule. The only thing resembling monitoring is the GitHub Actions post-deploy health-check workflow (`.github/workflows/post-deploy-health-check.yml`, confirmed in Phase 6's review), which checks that the app is reachable right after a deploy. It is not an ongoing monitor.

## 5. Proposed, not built: minimal monitoring additions

Consistent with "actionable alerts with configurable thresholds" and no new paid service without approval:

| Proposal | What it would need | Cost |
|---|---|---|
| Structured auth-failure logging (§2) | Code change only | $0. Needs approval, but not for cost reasons |
| Differentiated third-party failure logging (§3) | Code change only (add a `provider`/`stage` field to existing log calls) | $0 |
| A `/health` deep-check endpoint (DB + Redis reachability, not just "process is up") | Small code addition; Render's existing health-check workflow could point at it | $0 |
| Real APM (Sentry or similar) | A new paid service/subscription | **Needs explicit cost approval.** Typical SaaS APM pricing is usage/seat-based; no number is quoted here since no plan has been chosen or approved |
| Log aggregation/search (e.g. a hosted log service) | A new paid service, or a self-hosted stack (itself a new maintenance burden) | **Needs explicit cost approval** |

**Recommendation:** the two $0 code-only items (auth-failure logging, differentiated third-party failure logging) give the most value for the least cost and are in the roadmap as P0/P1 candidates. The paid options are not recommended until an incident shows that existing visibility missed something; nothing measured in this pass justifies speculative APM spend.

## 6. Incident severity, escalation, and recovery: process, not code

No formal incident-response process exists in this codebase. That is expected, since it's an organizational process, not something code implements. The proposed classification below follows common industry severity levels and this platform's actual blast radius (multi-tenant, RLS-isolated):

| Severity | Definition | Example | Target response |
|---|---|---|---|
| **SEV1** | Platform-wide outage, or any cross-tenant data exposure | API fully down; a tenancy-isolation bypass confirmed in production | Immediate; all available engineering attention |
| **SEV2** | Single company/feature significantly degraded, no data exposure | AI assistant down platform-wide; one company's uploads failing | Same business day |
| **SEV3** | Isolated, workaround exists | One user's export feature erroring | Next business day |
| **SEV4** | Cosmetic / minor | A UI label is wrong | Normal backlog |

**Recovery runbook reference:** `docs/INCIDENT_AND_RECOVERY_RUNBOOK.md` (written in Phase 6) already covers backup/restore procedures and known-issue remediation steps. This document doesn't repeat them; it adds the monitoring/visibility layer that the runbook assumes exists when deciding whether an incident is really happening.

**Post-incident review:** a proposed practice, not a new system. For any SEV1/SEV2, write a short note covering what happened, how it was detected (or *should* have been, if visibility was the gap, which §2's finding makes likely), what fixed it, and one concrete follow-up action.

## 7. Monitoring must never record sensitive content

Explicit design constraint for any future monitoring work (per this phase's own mandatory rule): any new logging, alerting, or APM integration must **never** record credentials, OAuth/API tokens, full request/response bodies containing project content (RFI text, issue descriptions, document contents), or unnecessary PII beyond what's needed to identify *that* an auth failure or error occurred (user id/email, not full user profile data). The auth-failure logging proposed in §2 is deliberately scoped to exclude the attempted password for exactly this reason. Any third-party APM/log-aggregation tool evaluated in the future must be checked against this constraint before adoption, not after.

## 8. Summary

| Area | Status |
|---|---|
| Logs exist | Yes, but ephemeral, unaggregated, no configurable level |
| Auth failures logged | **No. The existing code comment claiming otherwise is false; this is a real gap** |
| Third-party failures logged | Yes, but generically (not differentiated by provider/stage) |
| APM | None |
| `/metrics` endpoint | None |
| Alerting | None |
| Incident severity framework | Proposed in this document, not previously formalized |
| New recurring cost from this document | **$0.** Every proposal that needs spend is pending approval; nothing was purchased or provisioned |
