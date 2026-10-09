# EngineeringOS — Known Issues and Remediation

**Phase 6: Final Production Readiness & Acceptance Testing**
Every issue below was either reproduced live against a running instance or confirmed by direct code review (cited file:line). None is asserted from assumption. Severity follows: **Critical** (exploitable now, broad blast radius, or outright data/credential compromise), **High** (exploitable with some precondition, or a significant functional gap), **Medium** (real but bounded impact), **Low** (hardening/polish).

Issues marked **FIXED** were corrected and re-verified (live retest + full regression suite) during this same engagement. Issues marked **OPEN** are documented but intentionally left for your decision, per this audit's "ask before high-risk changes" instruction — none of them required a destructive or high-risk change to fix, but several (account lockout, dependency major-version bumps, JWT-revocation architecture) have a broader blast radius than a narrow guard addition and are left to you to schedule and scope.

---

## CRITICAL

### C-1. Privilege escalation via `POST /users/invite` — FIXED
- **Description:** Any user whose company role resolved to `project_manager` weight or above (6 of 12 roles) could invite a brand-new user and set their `company_role` directly to `super_admin`, with no approval step.
- **Severity:** Critical.
- **Evidence:** Live-reproduced — logged in as the demo `project_manager`, called the invite endpoint with `companyRole: 'super_admin'`, received `HTTP 201` with the new row's `company_role` confirmed as `super_admin` in the database. Root cause: `apps/api/src/modules/users/users.service.ts:95` inserted `dto.companyRole` uncapped.
- **Business impact:** Full takeover of a company's EngineeringOS account by any mid-level employee (or anyone who compromises their session), without needing the knowledge or consent of an actual admin.
- **Fix applied:** `UsersService.invite()` now rejects any requested `companyRole` whose weight exceeds the inviter's own role weight (`ForbiddenException`). Verified live (re-attempt now returns `403`) and via 5 new unit tests in `users.service.spec.ts`.
- **Verification criteria:** `users.service.spec.ts` "UsersService.invite -- role escalation cap" suite (5/5 passing); live retest documented in `ACCEPTANCE_TEST_MATRIX.md` (TC-SEC-01).
- **Owner:** Fixed this engagement; no further action required unless the business wants a different UX (e.g. an explicit "request escalation" flow instead of a flat `403`).

### C-2. `PATCH /projects/:id` had no authorization at all — FIXED
- **Description:** Any authenticated company user, down to the lowest-weight role (`client_representative`), could rename, re-phase, or rewrite any project's details, client/contractor/consultant fields, and branding, for any project in the company.
- **Severity:** Critical.
- **Evidence:** Live-reproduced — logged in as the demo `consultant`, successfully renamed the demo project and changed its status via `PATCH /projects/:id`, confirmed persisted in the database, then reverted.
- **Business impact:** Any employee could sabotage or misrepresent any project's core metadata, including fields that appear on official documents (RFI headers use project stakeholder names).
- **Fix applied:** Gated to `@RequireProjectPermission('manage_project_records')` (same permission already required to edit Documents/Drawings/Captures/BIM models). The branding-upload-URL route received the same gate.
- **Verification criteria:** Live retest confirms `403` for a non-privileged role and `200` for `super_admin`/a grant-holder/project_lead (TC-SEC-02).
- **Owner:** Fixed this engagement.

### C-3. Buildings/Levels/Locations module had zero authorization — FIXED
- **Description:** Every mutating route in `buildings.controller.ts` (create/update building, create level, create/update/archive location, pin-to-snag) had no authorization check at all; `BuildingsService` contained none either.
- **Severity:** Critical.
- **Evidence:** Code-reviewed (two independent passes); grepped for `ForbiddenException`/`companyRole`/`hasProjectPermission` across `buildings.service.ts` — zero hits before the fix.
- **Business impact:** Any company user could restructure a project's physical building/level/location hierarchy (the basis for floor-plan navigation and pinpoint locations) on any project.
- **Fix applied:** Gated to `@RequireProjectPermission('manage_project_records')`. Reads (`getLevels`/`getLocations`) and `convertToSnag` (which already enforces its own creator-or-admin check via `IssuesService.delete()`) deliberately left ungated.
- **Verification criteria:** Live retest confirms `403` for `project_manager` without a grant (TC-SEC-03).
- **Owner:** Fixed this engagement.

### C-4. Risk module had zero project-scoped authorization — FIXED
- **Description:** Every mutating route in `risk.controller.ts` (recalculate, human-assessment, matrix-override, override, status, owner) had no authorization check; `RiskService` scoped only by `companyId`.
- **Severity:** Critical.
- **Evidence:** Code-reviewed (two independent passes, zero hits for authorization checks before the fix).
- **Business impact:** Any company user could override risk scores, clear overrides, reassign risk owners, or change risk status on any project in the company — directly undermining the Risk Intelligence feature's credibility as a management reporting tool.
- **Fix applied:** All 9 mutating routes gated to `@RequireProjectPermission('manage_project_records')`. Reads left ungated.
- **Verification criteria:** Live retest confirms `403` for `project_manager` calling `recalculate` without a grant (TC-SEC-04).
- **Owner:** Fixed this engagement.

### C-5. `CREDENTIAL_ENCRYPTION_KEY` silently fell back to a hardcoded key — FIXED
- **Description:** `CredentialEncryptionService` derived its AES-256-GCM key from `CREDENTIAL_ENCRYPTION_KEY`; if unset, it fell back to the literal string `'dev-only-insecure-placeholder-key'`, committed in source, with only a warning logged. The variable was never declared in `render.yaml` and never documented in `.env.example`.
- **Severity:** Critical. Independently identified by two separate review passes in this engagement.
- **Evidence:** `apps/api/src/common/crypto/credential-encryption.service.ts` (pre-fix, line 39) and a full-file read of `render.yaml` confirming the variable's total absence.
- **Business impact:** Every connected Outlook/Gmail OAuth token and every BYO-AI provider API key in a production deployment that never had this variable set would be encrypted with a key visible to anyone with read access to the repository — functionally equivalent to not encrypting them at all. **If any production deployment has run without this variable set, every row currently in `email_integrations` and `user_ai_connections` must be treated as compromised** (see Owner note below).
- **Fix applied:** `app.config.ts` now requires `CREDENTIAL_ENCRYPTION_KEY` to be set to a string of at least 32 characters, mirroring the existing `JWT_ACCESS_SECRET`/`JWT_REFRESH_SECRET` pattern — the process refuses to start otherwise. The insecure fallback was removed from `CredentialEncryptionService` entirely. Added to `.env.example` (with "CHANGE THIS IN PRODUCTION" treatment) and to `render.yaml` (`generateValue: true`, API service only).
- **Verification criteria:** `credential-encryption.service.spec.ts` updated — asserts the service now throws rather than falling back (5/5 tests passing); full build/typecheck/lint/test suite green with the key set.
- **Owner action required:** **If EngineeringOS has ever been deployed to Render (or anywhere) without `CREDENTIAL_ENCRYPTION_KEY` explicitly set, you must treat every currently-stored Outlook/Gmail OAuth token and BYO-AI key as compromised**: force all affected users to disconnect and reconnect their email integrations and BYO AI providers after this fix deploys (the old rows, encrypted under the known fallback key, should be purged rather than migrated). I cannot determine from this environment whether a production deployment has actually run this way — this requires checking the live Render dashboard's environment variable history, which is outside what I can access from this sandbox.

---

## HIGH

### H-1. Same-company cross-project access on issue/drawing sub-resources — OPEN
- **Description:** Several sub-resource routes scope only by `company_id`, not by the specific project named in the URL: issue activities (get/post), issue evidence, issue capture-attachment, issue attachments, and drawing lookup-by-id (which also hands back a live presigned S3 read URL to the file).
- **Severity:** High.
- **Evidence:** Code-reviewed by the security-audit pass; citations: `issues.controller.ts:189-214,287-295` / `issues.service.ts:465-513,573-609,1010-1019`; `drawings.controller.ts:44-47` / `drawings.service.ts:108-124`.
- **Business impact:** A user who is a member of Project A (but not Project B, both in the same company) can view/comment on/attach files to Project B's issues and retrieve Project B's drawing files, by guessing or enumerating a UUID. Not a cross-company leak (RLS/`company_id` scoping holds everywhere), but a horizontal privilege gap within one company — relevant to multi-client general contractors running confidential, separately-staffed projects under one company account.
- **Recommended fix:** For each route, fetch the resource's actual `project_id` first and compare it to the URL's `:projectId` (or add `@RequireProjectPermission` keyed off the resource's derived project), consistent with how `issues.controller.ts`'s `update()` route already does it correctly.
- **Owner/decision needed:** Left open because it touches 5+ call sites across 2 modules and the fix pattern (derive-then-compare) deserves its own focused pass and test coverage rather than a rushed edit alongside everything else in this audit. Recommend scheduling as the next engineering priority after this report lands.
- **Verification criteria (once fixed):** a user who is a project_lead/grant-holder on Project A only should receive `403`/`404` (not the real data) when calling any of the 5 routes above with a Project B resource ID.

### H-2. Fine-grained project permissions are unreachable for anyone but company_admin — OPEN
- See `ROLE_PERMISSION_MATRIX.md` §4.0 for full detail. `grantPermission()` refuses any target whose company role isn't literally `company_admin`; the only way to give any other role project-level permissions is to make them `project_lead`, which bundles all six permissions. Fails closed (over-restrictive), not a security hole, but a real functional gap against the "configurable Team & Permissions" story.
- **Owner/decision needed:** whether to (a) relax the target-role restriction on `grantPermission()` (the endpoint is already `super_admin`-only, so the extra restriction on the target may be unnecessary), or (b) design narrower project roles between `viewer` and `project_lead`. Either is a product decision, not a narrow bug fix, so left open.

### H-3. Dependency vulnerabilities — OPEN
- **Description:** `pnpm audit --prod` reports 3 critical / 87 high / 47 moderate / 6 low findings. Of the directly-declared (not transitive) dependencies, `sharp` (^0.33.4 — processes **untrusted uploaded images** server-side during capture-rendition generation), `axios` (^1.7.7), and `nodemailer` (^6.9.13) are all below their patched versions. `drizzle-orm` (^0.30.10) is declared but never imported anywhere in `apps/api/src` — appears to be dead weight pulling in a large, vulnerable `expo`/React Native transitive tree.
- **Severity:** High (sharp specifically, since it processes attacker-controlled input); Medium for axios/nodemailer; Low for the unused drizzle-orm tree.
- **Evidence:** `pnpm audit --prod --json` output, captured by the security-audit review pass.
- **Recommended fix:** `pnpm why axios`, `pnpm why nodemailer`, `pnpm why sharp`, `pnpm why drizzle-orm` to confirm direct-vs-transitive status precisely, then upgrade all three direct packages (sharp ≥0.35.5 as the priority) and remove or upgrade drizzle-orm.
- **Owner/decision needed:** left open because a dependency major/minor bump needs its own test pass (sharp especially touches real image-processing behavior) rather than a blind version bump folded into this audit. Recommend scheduling promptly given `sharp`'s exposure to untrusted input.
- **Verification criteria:** `pnpm audit --prod` shows 0 critical/high on the four packages named above; full capture-upload regression test (existing `image-processing.processor.spec.ts` plus a manual upload-and-process smoke test) still passes after the bump.

### H-4. Google Calendar integration stores OAuth tokens in plaintext — OPEN
- **Description:** Unlike the Outlook/Gmail email integration (which uses `CredentialEncryptionService`, AES-256-GCM), the Google Calendar integration (`apps/api/src/modules/workforce/calendar-integration/`) stores its OAuth tokens in plaintext. This is flagged by an in-repo comment in `credential-encryption.service.ts` itself as a known, not-yet-addressed gap.
- **Severity:** High if Google Calendar integration is in active use; the data at risk (a user's Google Calendar access token) is lower-sensitivity than an email mailbox or an AI provider key, but still a real credential.
- **Evidence:** In-repo comment cross-referenced by the security-audit review; not independently re-verified against the calendar-integration module's current source in this pass (flagged for follow-up, not confirmed exploited).
- **Recommended fix:** Migrate `calendar-integration` to use `CredentialEncryptionService`, the same way `email-token-store.service.ts` does.
- **Owner/decision needed:** left open — needs its own dedicated code read and a migration plan for any already-stored plaintext tokens (same "treat as needing rotation" caveat as C-5 applies here too, pending a direct read of that module).

---

## MEDIUM

### M-1. Deactivating a user does not revoke their live access token — OPEN
- **Description:** `DELETE /users/:id` responds "User deactivated and all sessions revoked" and correctly revokes refresh tokens, but `JwtStrategy.validate()` performs no database lookup — an already-issued access token remains valid for its full remaining 15-minute lifetime after deactivation.
- **Severity:** Medium (bounded by the 15-minute access-token TTL).
- **Evidence:** Live-reproduced — deactivated the demo `consultant`, then successfully used their pre-existing access token against a protected route afterward.
- **Recommended fix:** either accept the 15-minute window as a documented residual risk (and correct the user-facing message to not claim immediate revocation), or add a cheap deny-list check (Redis, short TTL) to the JWT validation path for just-deactivated user IDs.
- **Owner/decision needed:** a global per-request DB/Redis check has a performance trade-off across every endpoint — left as a decision for you rather than applied unilaterally.

### M-2. No account lockout on repeated failed logins — OPEN
- **Description:** `/auth/login` is throttled at 10 attempts/minute **per IP** (confirmed working correctly live), but there is no per-account lockout. A distributed attacker (rotating source IPs) can brute-force one known email address indefinitely.
- **Severity:** Medium (mitigated by an 8-character minimum password requirement, but not eliminated).
- **Evidence:** Code-reviewed; grepped for `lockout`/`login_attempts`/`failed_login` across `apps/api/src` — no matches.
- **Recommended fix:** add a per-email failed-attempt counter with exponential backoff/temporary lock, independent of source IP.
- **Owner/decision needed:** a new auth-flow feature, not a narrow bug fix — left open.

### M-3. Rate-limit coverage gap on bulk-export/upload-URL issuance — OPEN
- **Description:** Only `/auth/*` (10/min) and the AI assistant (20/min) have per-route throttle overrides; everything else, including CPU-heavy bulk PDF/XLS export and presigned-upload-URL issuance, falls back to the global 100 req/min-per-IP default.
- **Severity:** Medium.
- **Recommended fix:** add `@Throttle` overrides to the heavier report-generation/bulk-export endpoints.
- **Owner/decision needed:** left open as a tuning task, not urgent given the global default still applies.

### M-4. `/api/v1/health` always returns HTTP 200, even when its own DB check fails — OPEN
- **Description:** The handler checks DB connectivity and includes `status: "degraded"` in the response body on failure, but never sets a non-200 status code. Render's native health-check/auto-restart mechanism (configured to this exact path) only inspects the HTTP status, so a live DB outage between deploys would not trigger Render's own remediation — only the separate, push-triggered GitHub Actions post-deploy check (which correctly inspects the body) would catch it, and only right after a deploy.
- **Severity:** Medium — an operational monitoring gap, not a security issue.
- **Recommended fix:** return a non-200 status (e.g. 503) from `/health` when `dbOk` is false, or point Render's `healthCheckPath` at `/health/ready` instead (already deep-checked, already consumed correctly by the GH Actions workflow).
- **Owner/decision needed:** a one-line change, but changing what a production health check does warrants your sign-off before being applied.

### M-5. Global default rate limit (100 req/min) is per-IP, not per-user — OPEN
- **Description:** Confirmed live during performance testing: synthetic load from one source IP tripped the global 100/min throttle almost immediately regardless of concurrency level, which is the correct behavior for abuse prevention from a single actor — but it means many real users behind one shared office/NAT IP (common for a construction company's office) could collectively exhaust that budget under entirely legitimate simultaneous use.
- **Severity:** Medium, dependent on customer network topology.
- **Recommended fix:** consider a per-user throttle layered on top of the existing per-IP one for authenticated routes.
- **Owner/decision needed:** a capacity-planning/policy question, not a narrow bug — left open.

### M-6. No file-content (magic-byte) validation on uploads — OPEN
- **Description:** File type is validated against an allowlist of the **client-declared** MIME type only; no server-side inspection of actual file bytes.
- **Severity:** Low-Medium — meaningfully mitigated by the allowlists themselves excluding any script-executable type (no `text/html`, `image/svg+xml`) and by storage keys never embedding client filenames.
- **Recommended fix:** add a magic-byte check (e.g. the `file-type` npm package) at registration time.
- **Owner/decision needed:** left open as hardening, not urgent given the existing mitigations.

### M-7. Audit log never records a before/after diff — OPEN
- **Description:** `audit_log.changes` is hard-coded to `null` on every row; the column exists but nothing populates it.
- **Severity:** Medium (reduces forensic value of the audit trail for disputes/incident investigation, but actor/action/resource/timestamp are all captured).
- **Recommended fix:** capture before-state on mutating routes where practical.
- **Owner/decision needed:** a feature addition, left open.

### M-8. Hard-delete vs. soft-delete behavior is inconsistent and undocumented — OPEN
- **Description:** Issues, RFIs, submittals, transmittals, snags, and captures (plus their attachments) are hard-deleted with no undo path. Projects use a `status != 'archived'` soft-delete convention. Documents and companies have no delete endpoint at all.
- **Severity:** Medium (real data-loss risk on the hard-deleted record types if a user deletes something by mistake).
- **Recommended fix:** at minimum, document this plainly for support staff; consider soft-delete for the hard-deleted record types if accidental-deletion reports become common.
- **Owner/decision needed:** left open — a product decision about data retention, not a narrow bug.

### M-9. Stripe billing is non-functional in production (placeholder keys) — OPEN
- **Description:** `render.yaml` sets `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET` to literal `sk_test_placeholder`/`whsec_placeholder` values, not `sync: false`. Any live billing/webhook call will be rejected by Stripe outright.
- **Severity:** Medium — functional gap, not a security issue (the placeholders are obviously fake, not a credential-exposure risk).
- **Owner action required:** set real Stripe keys via the Render dashboard before billing needs to go live. Flagged, not applied, since it requires your actual Stripe account credentials.

### M-10. AI Assistant Gateway's own API key is not configured in `render.yaml` — OPEN (carried over from Phase 2)
- **Description:** Re-confirmed still true: `engineeringos-api`'s `render.yaml` block has no `GEMINI_API_KEY`/`ANTHROPIC_API_KEY`/`AI_PROVIDER` entry. The user-facing AI Assistant (distinct from the separate `ai-service` used for semantic search) is non-functional in production until one of these is set.
- **Owner action required:** set a real provider API key via the Render dashboard.

---

## LOW

### L-1. Weak password policy — OPEN
8-character minimum, no complexity requirement, across reset/signup/accept-invitation flows. Combined with M-2 (no account lockout), modestly weakens resistance to credential-stuffing. Recommend a minimum-entropy check or a common-password denylist.

### L-2. Weight-based `@Roles()` resolution silently widens access beyond named roles — OPEN
Documented behavior, not a bug, but a maintenance risk: `@Roles('company_admin','engineering_manager','project_manager')` actually admits `technical_director`/`bim_manager` too (by weight), though neither is named. Worth a comment convention (already present in some places) reminding future editors to check weight, not just the literal list.

### L-3. BYO-AI "test connection" echoes raw vendor error text to the browser — OPEN
Scoped to the user's own BYO credential test (never the platform's own key, never the key itself) — low risk, but unfiltered vendor SDK error strings reach the client instead of a RealityCapture-controlled generic message.

### L-4. Duplicate migration number `052` — OPEN
Two unrelated files (`052_app_user_rls_enforcement.sql`, `052_risk_matrix.sql`) share a sequence number; `run-migrations.ts` sorts alphabetically so today's ordering is stable and non-conflicting, but this is a numbering-scheme defect worth fixing before it causes a real collision.

### L-5. Large web bundle chunks — OPEN
Production build emits several chunks over 500KB (notably `BimViewerPage` at 5.4MB/919KB gzipped and the main `index.js` at 3MB/895KB gzipped). Not measured against real-world network conditions in this sandbox; recommend code-splitting via `manualChunks` for routes not needed on first load (BIM viewer, 360 viewer).

### L-6. No structured logging / error-monitoring (APM) integration — OPEN
Confirmed: no Sentry/Datadog/equivalent anywhere in the codebase. Logging is console-only via NestJS's default `Logger`. A plain, stated gap — not a defect, but worth deciding on before relying on production logs for incident response.
