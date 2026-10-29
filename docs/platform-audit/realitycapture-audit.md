# RealityCapture Platform Audit — Baseline (Phase 1)

**Date:** 2026-10-29
**Scope:** Phase 1 reconnaissance for the EngineeringOS/RealityCapture platform audit. Evidence-based; every claim below is backed by a specific file/line the investigating session read directly (commands quoted where useful for reproducibility).

## 0. Critical premise correction

The audit brief this report answers was written assuming a **Firebase/Firestore + Next.js** stack (Firebase Authentication, Firestore security rules, `NEXT_PUBLIC_*` env vars, Firebase action URLs/authorized domains). **That stack does not exist in this repository.** Confirmed by direct search:

```
grep -rli "firebase\|firestore" apps/ packages/ --include="*.ts" --include="*.tsx" --include="*.json"   -> 0 matches
grep -rl "next.config\|NEXT_PUBLIC" apps/                                                                  -> 0 matches
```

The actual stack is:

| Layer | Technology | Evidence |
|---|---|---|
| Backend | NestJS (`@nestjs/common`, `@nestjs/jwt`, `@nestjs/passport`, `@nestjs/schedule`, `@nestjs/bull`) | `apps/api/package.json` |
| Frontend | Vite + React 18 + React Router | `apps/web/package.json` |
| Database | PostgreSQL with Row-Level Security (RLS), accessed via `postgres.js` tagged templates | `apps/api/src/database/*`, every `*.service.ts`'s `DatabaseService.withTenant()` calls |
| Auth | Custom JWT (access + refresh), `@nestjs/passport` + `passport-jwt` strategy, bcrypt/argon2 password hashing | `apps/api/src/modules/auth/*` |
| Email | Generic SMTP via `nodemailer`, one provider-agnostic transport | `apps/api/src/modules/email/email.service.ts` |
| Deployment | Render (Blueprint, `render.yaml`), Docker-based services, Postgres + Redis managed instances | `render.yaml` |
| Desktop agent | Standalone Node.js background process (`apps/agent`) for authorized workstation monitoring | `apps/agent/src/*` |

Every subsequent phase of the original brief that assumes Firebase-specific mechanics (action URLs, authorized-domains list, Firestore rules, Firebase Auth email templates) has been re-grounded against what's actually here. Where the brief's *intent* still applies (e.g. "investigate why email delivery isn't working," "determine what workforce screenshots means") the investigation below answers it against the real implementation.

## 1. Email system — what exists today

**There is exactly one email-sending capability in the entire backend: password-reset emails.** (`apps/api/src/modules/email/email.service.ts`, 61 lines, single public method `sendPasswordResetEmail`.)

- Transport: `nodemailer.createTransport()` against generic SMTP vars (`SMTP_HOST`/`SMTP_PORT`/`SMTP_USER`/`SMTP_PASSWORD`/`SMTP_FROM`), provider-agnostic by design (the code comment explicitly says it doesn't care whether that's Gmail, SES, or any other SMTP-speaking provider).
- `isConfigured()` lazily checks all four vars are present before attempting a send; `EmailService.sendPasswordResetEmail` throws plainly if not configured, rather than silently no-opping.
- Caller behavior (`AuthService.forgotPassword()`, `apps/api/src/modules/auth/auth.service.ts:300`): on `EmailService` throwing, the error is caught, logged, and the method **still returns success to the caller** — this is deliberate email-enumeration protection (confirmed via `render.yaml`'s own comment on the `SMTP_*` vars), not a bug.

**There is no email-verification / "prove you own this address" flow anywhere in this codebase.** Account creation (`AuthService.selfSignup`, `auth.service.ts:214`) is gated entirely by a company-level `signup_code` (checked against `companies.signup_code`), not by an email domain allowlist or a verification challenge. There is no `email_verified` column, no `EmailVerificationService`, no verification-token table. **This is the single most important finding for Phases 2–3 of the original brief: there is no existing email-verification flow to "repair." Building one is new work, not a bug fix.**

### Confirmed root cause of "email delivery not working"

`render.yaml`'s own comments on the `engineeringos-api` service's `SMTP_*` env vars read (verbatim, already in the repo):

> "Filled in manually in the Render dashboard once a provider/account is actually chosen... until then, EmailService.sendPasswordResetEmail() throws... and 'Forgot password' falls back to being delivered only via Manage Members > Reset password (admin-assisted)."

All four `SMTP_*` vars are declared with `sync: false` (Render Blueprint placeholders a human must fill in by hand) and, per this comment, have never actually been filled in. **Root cause: no SMTP/transactional-email provider has ever been configured for production. This is an account-setup/external-dependency gap, not a code defect.** There is no DNS/SPF/DKIM/DMARC configuration to audit yet either, because no sending domain has been chosen — that work is downstream of picking a provider.

This is a genuine blocker per the brief's own autonomy rule #17 ("if an external service requires a new account... stop and clearly explain the action needed from me"): I cannot create a transactional-email-provider account on your behalf. See `api-evaluation.md` for the provider comparison and the exact next step.

### Password-reset token design (already solid, no defect found)

`AuthService`'s shared reset-token helper (`auth.service.ts:272` onward) issues an opaque, single-use, 1-hour-expiring token, used identically by the self-service `forgotPassword()`/`resetPassword()` pair and by `UsersService.adminResetPassword()` (the admin-assisted fallback that hands the link to an admin directly when SMTP isn't configured). No replay/guessing weakness found in the code read. This part does not need repair.

## 2. Workforce screenshots — which of the brief's options (A/B/C/D) already exists

The brief asks us to determine this before building anything. Answer, with evidence:

**Option B — screenshots of an authorized employee's own workstation — already exists, is mature, and is in active use.** It is not a dashboard-URL screenshot (Option A) and not construction-site photography (Option C — that's the separate, unrelated `captures` module). There is no API to research or select here; this would be rebuilding a working feature in violation of rule #3.

Evidence:
- `apps/agent/` is a dedicated, standalone background desktop process (`screenshot-cycle.ts`, `activity-tracker.ts`, `enroll.ts`, `native.ts`, `queue.ts`) that enrolls a device under an authenticated user and runs a local capture loop.
- `apps/api/src/modules/workforce/screenshots/` is the backend half: `getUploadUrl` (presigned S3/R2 PUT), `record` (persists the captured screenshot's metadata), `listForUser` (RBAC-gated viewing, keyed on `callerCompanyRole`), `cleanupExpiredScreenshots`/`cleanupCompany` (retention-window deletion, default appears to be 90 days per the code comment at `screenshots.service.ts:79`).
- A company-level **on/off toggle already exists** and is wired end-to-end: `apps/web/src/pages/WorkforcePage.tsx` has an "Enable periodic screenshot capture" checkbox bound to `settings.screenshotEnabled`, calling a mutation that the backend enforces via `assertScreenshotsEnabled()` (`screenshots.service.ts:103`) — a 403 if the company has it off, which the agent treats as an expected, quiet, non-error outcome (`screenshot-cycle.ts`'s `'skipped-disabled'` result).
- Viewing is already RBAC-gated and already has an honest empty state in the UI ("No screenshots captured in this range yet" vs. a distinct "screenshots off" message) — `WorkforcePage.tsx`'s `ScreenshotsPanel`.
- A retention-cleanup job already runs on a schedule (confirmed indirectly: earlier test runs in this session observed `[ScreenshotsService] Workforce screenshot retention cleanup failed` / `cross-company retention scan failed` log lines fired by the service's own scheduled job during unrelated test runs, confirming a live cron entry point exists, not just the cleanup *method*).

### Confirmed gaps against the brief's checklist (real, but narrow — enhancement, not a rebuild)

| Requirement in brief | Status | Evidence |
|---|---|---|
| Configurable interval (60/120 min, admin-settable) | **Gap.** Hardcoded to 90 minutes, set once at device enrollment (`apps/agent/src/enroll.ts:44`), never read from any server-side company setting. Changing it today means manually editing a local config file on every enrolled device. | `apps/agent/src/config.ts:18`, `enroll.ts:44` |
| Visible last/next capture timestamp, success/failure state | **Gap.** The admin view (`WorkforcePage.tsx`) shows the on/off toggle and the screenshot thumbnails themselves, but no "last captured at" / "next capture due" / per-device health indicator. | `WorkforcePage.tsx` (no such field found) |
| Retry policy for transient failures | **Already handled, deliberately simple.** A failed cycle just logs and waits for the next scheduled cycle (`screenshot-cycle.ts`'s own comment: "there is no retry queue for screenshots... a missed screenshot every ~90 minutes is not the kind of data loss the offline-first activity queue exists to prevent"). This is a considered design choice, not an oversight — I'm not flagging it as a defect. |
| Audit log for capture events | **Partially present.** Screenshot rows themselves are an implicit audit trail (who, when, where stored); a dedicated audit-log entry per capture event was not found and would need confirming against the broader `audit.interceptor.ts` pattern used elsewhere in the app. |
| Start/stop/pause controls | **Start/stop exists** (the company-level enable toggle). **Pause** (temporary, time-boxed suspension) does not exist as a distinct state. |

**Scheduling-reliability note** (the brief's own warning about browser timers applies in spirit, adapted to the real architecture): the capture loop is a plain `setInterval` inside the agent's own long-running Node process (`apps/agent/src/index.ts:71`), not a server-side cron. It is more durable than a browser tab (survives navigation, doesn't die on a page reload) but still depends on the desktop agent process staying alive and the machine not sleeping — the same durability caveat the brief raises, just for a native process instead of a tab.

## 3. Live clock (Asia/Dubai)

**Does not exist.** No match for `Asia/Dubai`, `LiveClock`, or any timezone-aware clock component anywhere in `apps/web/src`. This is pure new, additive, unblocked work — no external dependency, no security-sensitive decision. Implemented as part of this same pass; see `implementation-report.md`.

## 4. Disposable-email / email-quality detection

**Does not exist.** No disposable-domain list, no MX-check call, no `mailcheck`/`disify`/equivalent integration anywhere in `apps/api/src`. New work, gated on the same provider decision as the email-verification flow (see §1 and `api-evaluation.md`) — there's limited value building disposable-domain detection ahead of deciding whether/how account email-verification will work at all, since the brief's own required policy (§3 of the original brief) explicitly chains disposable-detection into the verification flow ("prevent known disposable domains... then require ownership verification").

## 5. Secrets / committed-credential spot check

Quick pass, not the full Phase 7 audit:

```
git ls-files | grep -E "\.env$|\.env\.|secret"   ->  only .env.production.example (a placeholder file, correctly named)
grep VITE_ in apps/web for key/secret/password/token patterns  ->  no matches
```

No committed `.env` files, no secret-looking `VITE_*` client-side vars found in this pass. A full Phase 7 sweep (webhook signature validation, rate-limiting coverage, audit-trail completeness across all modules) was out of scope for this baseline and should be a separate, explicitly-scoped follow-up given its size — see the backlog.

## 6. What currently works / broken / incomplete / unverifiable (summary table)

| Area | Status | Root cause if broken | Safest corrective action |
|---|---|---|---|
| Password-reset email sending (code) | **Works** | — | None needed |
| Password-reset email delivery (production) | **Blocked** | No SMTP provider account ever configured (`SMTP_*` unset in Render) | Pick and configure a provider — external decision, see `api-evaluation.md` |
| Account email-ownership verification | **Does not exist** | Never built; signup uses a company signup-code model instead | New feature, scope to confirm with you before building (changes the signup UX) |
| Disposable-email detection | **Does not exist** | Never built | New feature, naturally sequenced after the verification-flow decision |
| Live Abu Dhabi clock | **Did not exist** → **implemented this pass** | — | See implementation report |
| Workforce screenshot capture (core) | **Works** | — | None needed |
| Workforce screenshot interval configurability | **Incomplete** | Hardcoded client-side default, no admin control | Small, scoped enhancement — see backlog |
| Workforce screenshot status visibility (last/next capture, health) | **Incomplete** | Never built | Small, scoped enhancement — see backlog |
| Secrets hygiene (spot check only) | **No issues found in this pass** | — | Full Phase 7 sweep still recommended as a follow-up |

## 7. Not verified in this pass (explicitly, per the brief's own rule against fabricating verification)

- DNS/SPF/DKIM/DMARC — moot until a sending domain/provider is chosen.
- Actual production delivery of any email (no provider is configured, so there is nothing to test delivery of).
- Full Firestore-style security-rule audit — doesn't apply; the real analogue (Postgres RLS policies + NestJS guards) was spot-checked extensively in this repository's prior security-audit pass (`docs/KNOWN_ISSUES_AND_REMEDIATION.md`), not re-verified line-by-line in this session.
- Whether the retention-cleanup cron is actually registered on a schedule vs. only callable on demand — inferred from log evidence in an unrelated test run, not independently confirmed by reading the module's cron registration directly.
