# EngineeringOS — Incident and Recovery Runbook

**Phase 6: Final Production Readiness & Acceptance Testing**
Scenarios below are grounded in this engagement's code review and live testing, plus the Phase 2 restore test already on record (`docs/phase2-production-readiness.md`). Diagnostic steps reference real file paths and the real `/api/v1/health*` endpoints this codebase actually exposes — nothing here is generic boilerplate.

---

## 1. API is unresponsive / 5xx on everything

**Diagnostic steps:**
1. Check `GET /api/v1/health` — note its current gap (M-4): it returns HTTP 200 even if its internal DB check fails, so **read the response body**, not just the status code: `{"status":"degraded","services":{"database":"..."}}`.
2. Check `GET /api/v1/health/ready` instead — deep-checks DB + Redis + object storage in parallel, same body-inspection caveat applies.
3. On Render: check the `engineeringos-api` service's own logs and process status in the dashboard.
4. If the DB check fails specifically: see §2 below.
5. If Redis fails: check `engineeringos-redis`'s status; the app degrades (queue-dependent features like background image processing and webhook delivery stop) but HTTP requests not touching the queue should still mostly work — confirm by testing a read-only endpoint like `GET /api/v1/projects`.

**Recovery:**
- If a recent deploy caused this: redeploy the previous commit/image (Render's standard rollback — there is no scripted automated rollback, confirmed in `PRODUCTION_DEPLOYMENT_CHECKLIST.md`).
- If it's an infrastructure-side outage (Render platform issue): no action available from this codebase; monitor Render's own status page.

## 2. Database unreachable or connection pool exhausted

**Diagnostic steps:**
1. `GET /api/v1/health` body will show `"database":"..."` as something other than `"ok"`.
2. Check `engineeringos-db`'s status in the Render dashboard (is it the managed Postgres instance being restarted/under maintenance, or a real outage?).
3. Check for a connection-pool-exhaustion pattern specifically: review `apps/api/src/database/database.service.ts`'s pool configuration and recent connection-count metrics if Render exposes them.

**Recovery:**
- Managed Postgres restart/maintenance: wait it out; `/api/v1/health` will recover on its own once the DB is reachable again — no app restart needed (it reconnects, does not cache a permanent failure state, confirmed by code read of the health controller).
- Real data-loss scenario (corruption, accidental destructive query): **do not attempt a live fix.** Use the configured 3-day point-in-time recovery or the on-demand export (both confirmed configured in Phase 2's audit) via the Render dashboard's Postgres restore flow. This is a destructive-adjacent operation — get explicit approval before restoring over any data, per this engagement's own safety rules, and this applies doubly to a real incident on real customer data.

## 3. A user reports they were just deactivated but can still see data

**This is expected, not a bug, for up to 15 minutes** — see `KNOWN_ISSUES_AND_REMEDIATION.md` M-1. `JwtStrategy.validate()` does not re-check `is_active` per request; only refresh tokens are immediately revoked on deactivation. An already-issued access token remains valid for its remaining lifetime (`JWT_ACCESS_EXPIRES_IN`, default 15 minutes).

**Diagnostic steps:**
1. Confirm the user's `is_active` flag in the `users` table is actually `false` (if not, the deactivation itself didn't take — a real bug, escalate).
2. If `is_active` is correctly `false` and the complaint is simply "they could still do X minutes ago," this is the known, documented 15-minute window — no action needed beyond waiting it out.

**If this matters for an active security incident** (e.g. deactivating a user specifically to cut off a compromised account *right now*): there is currently no faster revocation path in this codebase. The fastest available mitigation is to also rotate `JWT_ACCESS_SECRET` (forces **every** user to re-authenticate, not just the one account — a blunt instrument, use only if the compromise is serious enough to justify logging everyone out).

## 4. Suspected credential compromise (API keys, OAuth tokens, BYO AI keys)

**Diagnostic steps:**
1. Determine scope: is this about the platform's own secrets (`JWT_ACCESS_SECRET`, `CREDENTIAL_ENCRYPTION_KEY`, `INTERNAL_SERVICE_SECRET`), or a specific user's connected Outlook/Gmail/BYO-AI credential?
2. If it's about whether `CREDENTIAL_ENCRYPTION_KEY` was ever left unset in production: this is C-5 in `KNOWN_ISSUES_AND_REMEDIATION.md`. **Resolved by cross-referencing git history against Render's own deploy log (2026-10-29 pass)** — see exact evidence and reasoning below. The Render dashboard's env-var change history itself was not directly queried (no tool access to it from this sandbox); the deploy-timeline method below is an independently sufficient substitute, since `generateValue: true` vars are provisioned at the deploy that first introduces them in `render.yaml`.
   - `CREDENTIAL_ENCRYPTION_KEY` was first added to `render.yaml` in commit `8f5be67` (2026-10-09T16:47:33Z).
   - `engineeringos-api`'s deploy log (`srv-d9jlh8741pts73ctb09g`, queried via the Render API) shows the deploy for commit `841d148fd4` (2026-10-08T18:17:58Z) succeeded (`status: deactivated`, i.e. it *was* live before being superseded) and remained the live build — every deploy attempt between it and 2026-10-15T05:06:09Z either failed (`update_failed`) or doesn't exist in the log — until commit `3026063191` (PR #57, which necessarily includes `8f5be67`) finally succeeded.
   - `841d148fd4` already contains commit `52dbbfb` (`user_ai_connections` / BYO AI, 2026-10-08), merged earlier the same day — so the table and its write path were live in that deploy.
   - **Conclusion: `user_ai_connections` ran in production from 2026-10-08T18:17:58Z to 2026-10-15T05:06:09Z (~6.3 days) with `CREDENTIAL_ENCRYPTION_KEY` unset**, meaning any row written in that window was encrypted with the old hardcoded fallback key (`'dev-only-insecure-placeholder-key'`, visible in git history) and must be treated as compromised.
   - `email_integrations` (Outlook/Gmail tokens, table created by commit `7f43335`, 2026-10-09T05:55:32Z) was never part of any deploy that predates `8f5be67`: the first deploy that could have carried it (PR #57, the same 2026-10-15T05:06:09Z deploy above) already included the fix. **No evidence this table was ever exposed.**
   - This sandbox has no production database credentials, so the exact row count in the exposure window (rather than its existence) was not and could not be counted here — that final check (`SELECT COUNT(*) FROM user_ai_connections WHERE created_at BETWEEN '2026-10-08 18:17:58' AND '2026-10-15 05:06:09'`) is the one remaining step, left for whoever has production DB access.

**Recovery:**
- Platform-wide secret rotation: generate a new value via the Render dashboard for the affected variable(s) and redeploy. For `JWT_ACCESS_SECRET`/`JWT_REFRESH_SECRET`: this logs out every user immediately (all existing tokens become unverifiable) — warn users first if possible.
- For `CREDENTIAL_ENCRYPTION_KEY` specifically: the 2026-10-29 deploy-history analysis above narrows this from "rotate the key and wipe both tables" to a precise, smaller action — **`CREDENTIAL_ENCRYPTION_KEY` has been correctly set (via `generateValue: true`) on every deploy since 2026-10-15T05:06:09Z, so rotating it now is not required on its own.** What's still needed: confirm with production DB access whether any `user_ai_connections` row has `created_at` or `updated_at` between `2026-10-08T18:17:58Z` and `2026-10-15T05:06:09Z` (the confirmed exposure window); if any exist, **delete those specific rows** (not the whole table, not `email_integrations`, which was never exposed per the analysis above) and prompt those users to reconnect their BYO AI provider. Do not attempt to re-encrypt them — they were encrypted under the old hardcoded fallback key, not the current one, and re-encryption would require trusting a key that was visible in the source repository.
- A single user's own connected account was compromised (not a platform secret): have them disconnect and reconnect via Settings → Email Integration / AI Provider — both disconnect flows are confirmed (code-verified this engagement) to issue a real `DELETE` against the stored token row, not just hide it in the UI.

## 5. Suspected unauthorized cross-company or cross-project data access

**Diagnostic steps:**
1. Check the audit log (`audit_log` table) for the affected resource — actor, action, timestamp are reliably recorded (though note M-7: no before/after diff is captured, only that an action happened).
2. Cross-reference the actor's `company_id` against the resource's actual `company_id` to confirm whether this is a genuine cross-tenant leak (should be structurally impossible per this engagement's testing — see `ACCEPTANCE_TEST_MATRIX.md` TC-SEC-06/07/08) or a same-company cross-project access (a known, documented gap — H-1 in `KNOWN_ISSUES_AND_REMEDIATION.md`, on issue activities/evidence/attachments and drawing lookup specifically).
3. If it's a genuine cross-company leak not matching any known gap: **this is a new, serious finding** — stop and escalate immediately (see §7), do not attempt a quiet fix.

**Recovery:**
- Known same-company cross-project gap (H-1): no live exploit mitigation exists today beyond restricting which users are added to sensitive projects' membership lists as a practical (not technical) mitigation, until the underlying routes are fixed.
- Genuine new cross-tenant leak: treat as a security incident — see §7.

## 6. AI Assistant failures

**Diagnostic steps:**
1. Check server logs for `[ProviderFactory]` or `[AiService]` warnings — a "No AI provider configured" warning at boot means no API key is set at all (expected in this sandbox; should not be the case in a properly configured production deployment — see `PRODUCTION_DEPLOYMENT_CHECKLIST.md`).
2. A user-facing "temporarily unavailable" message is the expected, generic wrapper around any provider failure (timeout, rate limit, model unavailable) — confirmed by code review this never leaks the raw provider error or any credential to the client.
3. For a BYO-AI-specific failure: check for a server-side "BYO provider resolution failed, falling back to RealityCapture AI" warning log — this is expected graceful-degradation behavior (the user silently gets the platform's own AI instead), not an error requiring action unless it happens for every BYO user (which would suggest a systemic decrypt failure, possibly related to a `CREDENTIAL_ENCRYPTION_KEY` rotation — see §4).

**Recovery:**
- Platform provider outage (e.g. Anthropic/Gemini/OpenAI down): no action available from this codebase; the app already degrades gracefully (generic error to users, no crash, no data corruption). Wait for the provider to recover.
- Systemic BYO decrypt failures: almost certainly a `CREDENTIAL_ENCRYPTION_KEY` mismatch (see §4) — do not attempt to "fix" individual rows; the key is wrong or was rotated without clearing old data.

## 7. Escalation

- **Any suspected genuine cross-tenant data leak, credential compromise, or active exploitation of a known-critical finding** (C-1 through C-5 in `KNOWN_ISSUES_AND_REMEDIATION.md`, even post-fix, in case the fix itself has a gap): stop, do not attempt a live fix under pressure, and escalate to whoever owns production access decisions for this deployment.
- **Any destructive recovery action** (database restore, mass credential rotation, bulk row deletion as in §4's `CREDENTIAL_ENCRYPTION_KEY` rotation path): requires explicit sign-off from the account/platform owner before execution, per this engagement's own safety rules — this runbook describes the correct recovery procedure, it does not pre-authorize anyone to execute it unilaterally.
- **Recovery Time Objective / Recovery Point Objective:** no formally agreed RTO/RPO exists in any document reviewed this engagement. The only concrete data point on record is the 3-day PITR window (so RPO is bounded at a maximum of ~3 days of data loss in the worst case, likely much less in practice given continuous PITR) and the Phase 2 restore test's own timing (not reproduced in this engagement — see `docs/phase2-production-readiness.md` for whatever duration was recorded there). **Recommend formally setting and documenting an RTO/RPO target as a follow-up**, since none currently exists to hold the team accountable to.
