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

### H-1. Same-company cross-project access on issue/drawing sub-resources — FIXED (2026-10-29)
- **Description:** The 2026-10-09 audit found this in 2 modules (5 routes). A fresh full-codebase trace (2026-10-29) found the identical pattern in **8 modules**, not 2 — the original estimate was based on a partial read; three weeks of new feature work (QAQC, Site Drawing Hub, Risk Movement, RFI attachments) had also added fresh instances of the same gap. Every confirmed instance is now fixed.
- **Severity:** High.
- **Evidence (2026-10-29 fix, all with passing regression tests):**
  - **Issues** (`issues.controller.ts`/`issues.service.ts`): `getActivities`, `addActivity`, `getEvidence`, `addCapture`, `addAttachment` — fixed via a new `assertIssueInProject()` helper, mirroring `findOne()`'s existing correct pattern. 5 new H-1 regression tests in `issues.service.spec.ts` (56/56 passing).
  - **Drawings** (`drawings.controller.ts`/`drawings.service.ts`): `findOne` (**was handing back a live presigned S3 download URL for any drawing in the company**), `getFloorPlanData`, `linkCapture`, `unlinkCapture`, `createPin`, `getPins` — fixed via `project_id` added to `findOne`'s/`createPin`'s own queries plus a new `assertDrawingInProject()` helper. 4 new tests in `drawings.service.spec.ts` (26/26 passing).
  - **BIM** (`bim.controller.ts`/`bim.service.ts`): the shared `getModel()` helper (used by `getModelStatus`, `getModelViewerData` — **was handing back a live presigned Fragments model-file URL** — `getModelProvenance`, `getHierarchy`, `getElementStatusMap`), plus `getElement`, `getElementByGuid`, `getElementStatusHistory`, `linkCaptureToElement`, `getCapturesForElement`, `getZoneProgressHistory`. Also found and fixed a subtler instance: `updateElementStatus` already *took* a `projectId` parameter but never actually used it in either of its two queries — a user could change Project B's element status by supplying Project B's own `elementId` under Project A's URL, with no indication anything was wrong (the parameter was there, just silently unused). 5 new tests in `bim.service.spec.ts` (21/21 passing).
  - **QAQC** (`qaqc.controller.ts`/`qaqc.service.ts`): `addAttachment`, `getAttachments`, `deleteAttachment`, `linkCapture`, `getLinkedCaptures` — fixed via a new `assertQaqcInProject()` helper. 5 new tests (62/62 passing).
  - **Documents** (`documents.controller.ts`/`documents.service.ts`): `link()` had no project check at all (not even a stale company-only one) — could link an arbitrary capture/element/location/issue to any document in the company. Fixed. 1 new test (8/8 passing).
  - **Snagging, RFIs, Captures, Buildings**: fixed in parallel by a second pass over the same codebase this session — see each module's own commit for specifics. Snagging: `getActivities`/`addActivity`/`addAttachment` (16/16 passing, 6 new). RFIs: `addAttachment`/`getAttachments`/`deleteAttachment`/`getComments` (66/66 passing, 10 new). Captures: `createHotspot`/`updateHotspot`/`deleteHotspot` — `createHotspot` had no existence check *at all* before insert (14/14 passing, 6 new). Buildings: `updateBuilding`/`createLevel`/`getLevels`/`createLocation`/`getLocations`/`updateLocation`/`archiveLocation`, plus `convertPinToSnag` (same "parameter present but unused" pattern as BIM's `updateElementStatus` above) — this module is structurally different, since `locations` resolves to a project via *either* `level_id→building.project_id` *or* `drawing_id→drawing.project_id` (migration 005); fixed with three new helpers (16/16 passing, first spec file for this module).
  - **Confirmed NOT vulnerable, left untouched:** `issues.service.ts`'s own `findOne`/`update` (the original correct reference pattern), `getByElement`/`lookupProjectForIssue` (deliberately flat/cross-project lookups by design), `drawings.service.ts`'s `getUploadUrl`/`create` (already call `assertProjectBelongsToCompany`), and the new GIS Preparation module (`gis-prep.service.ts`) — built correctly from the start, with a `getRow(companyId, projectId, jobId)`-shaped helper throughout; it served as a second reference pattern for this fix.
- **Business impact:** was — a user who is a member of Project A (but not Project B, both in the same company) could view/comment on/attach files to/mutate Project B's issue, drawing, BIM, QAQC, document, snag, RFI, capture, and building/location sub-resources, by guessing or enumerating a UUID; two routes (`drawings.findOne`, `bim.getModelViewerData`) additionally handed back a live, usable presigned download URL to the underlying file. Not a cross-company leak (RLS/`company_id` scoping held everywhere, confirmed throughout this fix). Now closed.
- **Total new regression tests added this pass: 60+**, across 9 modules, all passing alongside the full existing suite (987/987 API tests green after this fix, plus the full monorepo `typecheck`/`build`/`lint`).
- **Verification criteria:** met — a user who is a project_lead/grant-holder on Project A only now receives `404` (`NotFoundException`, never leaking whether the resource exists in another project) when calling any of the above routes with a Project B resource ID; the matching positive test (the resource's real project succeeds) passes alongside each negative one.

### H-2. Fine-grained project permissions are unreachable for anyone but company_admin — OPEN
- See `ROLE_PERMISSION_MATRIX.md` §4.0 for full detail. `grantPermission()` refuses any target whose company role isn't literally `company_admin`; the only way to give any other role project-level permissions is to make them `project_lead`, which bundles all six permissions. Fails closed (over-restrictive), not a security hole, but a real functional gap against the "configurable Team & Permissions" story.
- **Owner/decision needed:** whether to (a) relax the target-role restriction on `grantPermission()` (the endpoint is already `super_admin`-only, so the extra restriction on the target may be unnecessary), or (b) design narrower project roles between `viewer` and `project_lead`. Either is a product decision, not a narrow bug fix, so left open.

### H-3. Dependency vulnerabilities — PARTIALLY FIXED (2026-10-29 re-audit)
- **Re-audited fresh** (`pnpm audit --prod --json`, plus `pip-audit` against `apps/ai-service` and `apps/adm-gis-prep`) — the 2026-10-09 numbers were stale; three weeks of new feature work (Site Drawing Hub, GIS Preparation, Risk redesign, etc.) shifted the count to 3 critical / 93 high / 58 moderate / 7 low before this pass, now reduced by the fixes below.
- **`drizzle-orm`: already resolved, no action needed.** Confirmed absent from every `package.json` in the repo as of this re-audit — it was removed at some point after 2026-10-09; the "dead weight pulling in a vulnerable expo/React Native tree" finding no longer applies.
- **FIXED this pass — safe, in-range/narrow-scope, no behavior change:**
  - `axios` ^1.7.7 → resolved to `1.21.0` (`pnpm update axios -r --latest=false`) — moderate/high findings (ReDoS, prototype pollution, SSRF-via-redirect) patched at `>=1.20.0`, fully within the existing `^1.7.7` semver range across `apps/api`/`apps/web`/`apps/mobile`. No code change needed.
  - `proxy-addr` (transitive, via `express` → `@nestjs/platform-express`, both direct `apps/api` deps) `2.0.7` → `2.0.8` via a new `pnpm-workspace.yaml` `overrides` entry — **critical**, IP spoofing via an IPv4-mapped IPv6 trust subnet, directly reachable in the deployed API which runs behind Render's reverse proxy with `trust proxy` enabled; a spoofed `X-Forwarded-For` could defeat the per-IP rate limiter (M-2/M-5 below). A single patch-version bump, not a breaking change.
  - Full `pnpm typecheck`/`pnpm test` (987/987)/`pnpm build`/`pnpm lint` all green after both changes.
- **OPEN — needs its own dedicated upgrade-and-regression pass, not applied this pass (all are major-or-equivalent version jumps with real behavior-change risk):**
  - `sharp` (`apps/api`, processes **untrusted uploaded images** server-side) `0.33.5` installed, needs `>=0.35.5` (three minor versions in the pre-1.0 line, where pre-1.0 minor bumps are conventionally breaking).
  - `nodemailer` (`apps/api`) `6.10.1` installed; every patched version for its current findings is in the 7.x–10.x range (no fix exists within 6.x) — this is a multi-major-version jump touching real email-sending behavior.
  - `xlsx` (`apps/web`, SheetJS — processes user-uploaded/exported spreadsheets) `0.18.5` installed, needs `>=0.20.2` — outside the declared `^0.18.5` range (0.x caret only allows patch bumps), so this also needs a `package.json` range change, not just a lockfile update.
  - `tar` / `shell-quote` (both **critical**, but confirmed via `pnpm why` to be deep transitive deps of `@expo/cli`/`react-native`'s own build tooling in `apps/mobile` only — not part of the app bundle shipped to a device, not reachable from any deployed production surface). Lower real-world urgency than the three above despite the "critical" label; still worth a `pnpm-workspace.yaml` override if/when `apps/mobile`'s Expo SDK is next upgraded, since forcing them standalone risks breaking the Expo CLI's own internal assumptions about its bundled tool versions.
  - **`apps/ai-service` (Python, newly audited — not covered by the 2026-10-09 pass at all, since this audit predates that service's current dependency set):** resolved via an isolated venv with each pinned version installed `--no-deps` (full dependency-tree resolution timed out repeatedly in this sandbox; `download.pytorch.org` is also outside this sandbox's network allowlist, so `torch==2.3.1+cpu` itself could not be installed/audited here at all — flagged as **unverified**, not clean).
    - `Pillow` (processes uploaded images via the OCR pipeline) `10.3.0` installed — dozens of CVEs/PYSEC advisories (out-of-bounds writes, decompression bombs, RCE-adjacent memory corruption via crafted PSD/PDF/TIFF files), fix requires `>=13.0.0` (three major versions ahead).
    - `python-multipart` (handles untrusted multipart file uploads, `routers/gis_prep.py`) `0.0.9` installed — multiple DoS and a path-traversal advisory, fix requires `>=0.0.31`.
    - `sentence-transformers` (the AI service's embedding/semantic-search engine) `2.7.0` installed — **PYSEC-2026-4164, "a security control bypass vulnerability that allows attackers to achieve arbitrary code execution by exploiting a logic [flaw]"** (summary as reported by the advisory; exact trigger conditions not independently verified against this codebase's actual usage in this pass) — fix requires `>=5.6.0` (three major versions ahead).
    - `python-dotenv` `1.0.1` installed — low severity (local symlink attack on `.env` rewriting via `set_key()`/`unset_key()`, neither of which this codebase appears to call at runtime), fix at `>=1.2.2`.
  - **`apps/adm-gis-prep` (Python, newly audited): clean.** `pip-audit -r requirements.txt` — zero known vulnerabilities across all 11 pinned packages (`ezdxf`, `shapely`, `pyproj`, `pydantic`, `PyYAML`, `Jinja2`, `fastapi`, `uvicorn`, `python-multipart`, `pytest`, `httpx` — note this module pins a *different*, already-patched `python-multipart` version than `ai-service` does).
- **Owner/decision needed:** schedule the sharp/nodemailer/xlsx/sentence-transformers/Pillow/python-multipart upgrades as their own dedicated pass(es) — each needs real regression testing of the behavior it touches (image processing, email sending, spreadsheet import/export, AI embeddings, file uploads) before shipping, consistent with this engagement's own "ask before a breaking change" instruction. Prioritize `sentence-transformers` and `Pillow`/`python-multipart` given they process attacker-reachable input directly.
- **Verification criteria (once the above are scheduled and applied):** `pnpm audit --prod` and `pip-audit` on both Python services show 0 critical/high on the packages named above; existing regression suites (`image-processing.processor.spec.ts` for sharp, AI-service's own test suite for sentence-transformers/Pillow/python-multipart) still pass after each bump.

### H-4. Google Calendar integration stores OAuth tokens in plaintext — FIXED (2026-10-29)
- **Description:** Confirmed real by direct code read this pass (the 2026-10-09 audit had only cross-referenced an in-repo comment, not independently verified it): `access_token`/`refresh_token` were inserted and read as plain strings in `calendar-integration.service.ts`, with zero calls to `CredentialEncryptionService` — unlike `email-token-store.service.ts`, which has used AES-256-GCM encryption from the start.
- **Severity:** High if Google Calendar integration is in active use.
- **Fix applied:** Migration `077_encrypt_calendar_tokens.sql` adds nullable `access_token_ciphertext`/`_iv`/`_auth_tag` and `refresh_token_ciphertext`/`_iv`/`_auth_tag` columns to `workforce_calendar_integrations`, and relaxes the old plaintext columns to nullable. Purely additive — no existing row is touched, re-encrypted, or has data removed, so this is safe to deploy with zero downtime/data-loss risk. `CalendarIntegrationService` now encrypts on every write (`handleCallback`'s initial connect, `ensureFreshAccessToken`'s refresh) via `CredentialEncryptionService` (the same service `email-token-store.service.ts` uses), and decrypts transparently on read (`getIntegrationRow`) with a legacy-plaintext fallback: **the presence or absence of the ciphertext columns themselves is the version marker** — no separate flag column needed. A still-legacy row is read correctly (plaintext fallback) and is then **opportunistically migrated the next time it refreshes** (`ensureFreshAccessToken` re-encrypts both tokens and clears the plaintext columns for that row) — no forced backfill script, no destructive migration.
- **Tests:** `calendar-integration.service.spec.ts` — initial authorization (asserts the INSERT carries only encrypted columns, never the raw plaintext token values, in its bound parameters), token refresh (asserts the same for the UPDATE), legacy-row read (a plaintext-only row is still usable), legacy-row-to-encrypted migration on refresh, decrypt failure handling (a tampered ciphertext throws without leaking token data in the error), and a malformed-row failure case. All passing.
- **Key errors:** not separately tested at this layer — `CredentialEncryptionService` itself refuses to construct without a real ≥32-char `CREDENTIAL_ENCRYPTION_KEY` (`app.config.ts`'s `requireStrongSecret()`, exercised by `credential-encryption.service.spec.ts`), so the whole process fails to boot before this service could ever be instantiated with a bad key.
- **Migration/rollback plan:** the schema migration is additive-only and auto-runs via the existing `preDeployCommand` on the next deploy, like every other migration in this app — no separate manual step. Rollback, if ever needed, is the existing "redeploy a prior image" story (no scripted down-migration exists for any migration in this repo); since nothing is destructive, a rollback to pre-077 code would simply ignore the new columns (the old columns are still there and still populated for any row that hasn't refreshed yet). A **separate, later, explicitly-approved** migration can drop the now-unused plaintext columns once production confirms every row has naturally rotated — deliberately not done in this pass.
- **Not run against production:** this migration has not been deployed; it ships as part of this engagement's topic-branch PR, same as every other change here, and will only reach production once that PR is reviewed and merged by the repository owner.

---

## MEDIUM

### M-1. Deactivating a user does not revoke their live access token — FIXED (2026-10-29)
- **Description:** Reproduced (by code trace, not a live call — no running instance in this sandbox): `DELETE /users/:id` responded "User deactivated and all sessions revoked" and correctly revoked refresh tokens, but `JwtStrategy.validate()` performed no database/cache lookup at all — confirmed by direct read of `jwt.strategy.ts` as it stood before this fix.
- **Severity:** Medium (bounded by the access-token TTL).
- **Fix applied:** per the 2026-10-09 audit's own recommended option, a new `SessionRevocationService` (`apps/api/src/modules/auth/session-revocation.service.ts`) adds a cheap Redis deny-list check — a single `EXISTS` read per request, not a DB round trip — mirroring `AiUsageService`'s own existing Redis client pattern (same `redis.host`/`port`/`password` config). `UsersService.deactivate()` now calls `denyFutureAccess(userId)` right after revoking refresh tokens, setting a short-TTL key (`jwt.accessExpiresIn` + a 60s clock-skew margin, read via the `ms` package already used elsewhere in this codebase). `JwtStrategy.validate()` checks `isDenied(payload.sub)` and throws `UnauthorizedException` if set. The deny-list entry expires on its own once any pre-existing token would have expired anyway, so it never needs manual cleanup. On a Redis outage, `isDenied()` fails **open** (deliberately) rather than locking every user in the app out on a transient infra blip — documented in the service's own comment as the intentional trade-off.
- **Tests:** `session-revocation.service.spec.ts` (TTL calculation for two different configured lifetimes, normal allow/deny reads, fail-open on a Redis error), `jwt.strategy.spec.ts` (rejects a denied user even with a valid signature/expiry, allows a non-denied user, rejects a structurally invalid payload before ever checking the deny-list), `users.service.spec.ts` (`deactivate()` calls `denyFutureAccess` with the right user id on success, never calls it when the user wasn't found). All passing.
- **User-facing message:** left unchanged (`'User deactivated and all sessions revoked.'`) — it's now actually true, rather than aspirational.
- **Not yet done:** this fix was not deployed or exercised against a live Redis instance in this sandbox (no live infrastructure available here) — verified via unit tests with a mocked `ioredis` client only, consistent with how every other Redis-backed service in this codebase (`AiUsageService`) is tested.

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
