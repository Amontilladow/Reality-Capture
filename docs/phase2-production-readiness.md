# Phase 2 — Production Deployment & Scalability

Tracks the brief's 16 sections against evidence actually gathered in this
repo and in the live Render workspace. Status values: **VERIFIED**
(checked against real config/code/live state), **PARTIAL** (some evidence,
gaps noted), **GAP — SAFE FIX AVAILABLE** (identified, fixable without
touching data/schema/contracts), **BLOCKED — NEEDS MY ACTION** (requires
dashboard access, a credential, or a decision only the account owner can
make), **NOT STARTED**.

This file is a living document — update it in place as each section is
actually investigated or acted on. Do not mark anything VERIFIED without
the evidence that earned it.

**Prior audit found and cross-referenced**: `engineering-review/` in this
repo contains an existing, detailed technical audit
(`CURRENT_STATUS.md`, verification date 2026-09-28, with a 2026-09-30
addendum; `LAUNCH_READINESS.md`; `NEXT_STEPS.md`) — this is the "previous
audit" the brief's Section 1 refers to, found by inspecting the
repository per that section's own fallback instruction. It predates the
current `main` tip by about ten days (PRs #52–#54 all landed after it).
Where this document's own independent verification (done against the
current tip) confirms, extends, or supersedes a claim from that prior
audit, it says so explicitly below rather than silently repeating or
silently overriding it.

## 1. Current deployment configuration — VERIFIED (read-only review complete)

Live Render workspace (`tea-d9jkl43tqb8s73aishng`) inspected directly via
the Render API and cross-checked against `render.yaml` (HEAD `080d6e8`,
which already contains the Phase 1 UI/UX merge):

| Service | Type | Plan | Region | Status |
|---|---|---|---|---|
| `engineeringos-api` | web_service (Docker) | starter | oregon | live, latest deploy `080d6e8` succeeded |
| `engineeringos-web` | static_site | starter | oregon | live, latest deploy `080d6e8` succeeded |
| `engineeringos-ifc-service` | background_worker (Docker) | starter | oregon | live, latest deploy `080d6e8` succeeded |
| `engineeringos-ai-service` | private_service (Docker) | starter | oregon | live, latest deploy `080d6e8` succeeded |
| `engineeringos-qdrant` | private_service (image) | starter | oregon | live (unchanged since initial deploy) |
| `engineeringos-db` | managed Postgres 16 | basic-256mb | oregon | available, 15GB disk, no HA, no read replicas |
| `engineeringos-redis` | key-value | free | oregon | — |

All 5 deployable services are confirmed live on the current `main` tip. No
custom domain is configured anywhere — both public-facing services
(`engineeringos-api`, `engineeringos-web`) are still on default
`*.onrender.com` subdomains. Per the brief, **no domain will be purchased
without explicit approval.**

**Deploy history finding (evidence, not a new claim):** the deploy for
commit `52dbbfb` (PR #52) shows Render status `update_failed` for
`engineeringos-api` — this is the live confirmation of the crash PR #53's
commit message describes ("the latest deploy crashed at startup... in
production today"). The follow-up commit `841d148` (PR #53, the
non-fatal-boot fix) deployed successfully. This is direct evidence that a
missing/misconfigured AI provider key can take the *entire* API down on
boot if the lazy-fail guard from PR #53 is ever regressed — worth keeping
in mind for Section 9.

**CI/CD gap (confirmed by reading `.github/workflows/ci.yml` in full):**
there is no staging environment, no smoke-test step, and no deploy step in
CI at all. Render's own auto-deploy-on-push-to-`main` is the *only*
deployment mechanism — every merged PR goes straight to the one production
environment with no pre-production verification beyond CI's lint/
typecheck/test/build gates. See Section 13.

## 2. Production architecture — VERIFIED (not Firebase-based)

The brief's template assumes a Firebase/Firestore stack. Grepped the
entire repository (`firebase`, `firestore`, case-insensitive) — **zero
matches**. This application has never used Firebase; confirming that
explicitly rather than assuming it, per the brief's own Section 1
instruction. The actual stack, reconfirmed against current code:

- **Frontend**: React + Vite SPA (`apps/web`), served as a Render
  static site with a `/* → /index.html` SPA rewrite rule.
- **Backend/API**: NestJS on Node 22 (`apps/api`), Docker, Render
  web_service.
- **Auth**: self-hosted JWT (access + refresh), `@nestjs/passport` +
  `@nestjs/jwt` + `argon2` password hashing — not Firebase Auth.
- **Database**: self-hosted PostgreSQL 16 (Render managed), accessed via
  a narrowly-scoped `app_user` role under Row-Level Security — not
  Firestore.
- **File/media storage**: S3-compatible object storage (Cloudflare R2 per
  an existing render.yaml comment), presigned upload/download URLs — not
  Firebase Storage.
- **AI/RAG**: a separate Python FastAPI service (`apps/ai-service`) +
  Qdrant vector DB, both Render private_services with no public exposure.

**Actual request flow** (verified against `render.yaml` + code, not
assumed):

```
Browser (engineeringos-web.onrender.com, static SPA)
  → HTTPS → engineeringos-api.onrender.com (NestJS, public web_service)
       → JWT verified (JwtAuthGuard) → TenancyGuard/RolesGuard/
         ProjectPermissionGuard authorize the request
       → PostgreSQL (engineeringos-db, private network only,
         ipAllowList: [] — not reachable from the public internet)
       → S3-compatible storage (presigned URLs issued by the API;
         the browser uploads/downloads directly, bytes never
         transit the API server)
       → engineeringos-ai-service (private_service, no public
         exposure — only engineeringos-api can reach it, over
         Render's private network, with a shared internal secret
         header the AI service checks on every request)
            → engineeringos-qdrant (private_service, no public
              exposure, reachable only from engineeringos-ai-service)
```

Private operations are correctly **not** exposed to unauthorized clients:
`engineeringos-ai-service` and `engineeringos-qdrant` are Render
`private_service`s (no public URL at all), and `engineeringos-db`/
`engineeringos-redis` both have `ipAllowList: []` (private-network-only).
This is already the correct shape — no change needed here.

Since the actual architecture has no Firebase/Firestore/Cloud-Run
components, Section 2's "evaluate Firebase App Hosting / Cloud Run /
Firestore / Firebase Auth / Firebase Storage" items are **not
applicable** — introducing any of them now would mean migrating a working
database and auth system for no demonstrated benefit, which the brief
itself says not to do without justification. No such migration is
proposed.

## 3. Environment separation — PARTIAL

No dev/staging/production separation exists at the infrastructure level —
`render.yaml` defines exactly one set of services, all tracking `main`.
Introducing a second environment means either a second Render Blueprint
(duplicate services, a second database) or Render's preview-environment
feature — both have real monthly cost implications (new `starter`-plan
services, a new Postgres instance) and are explicitly gated: **the brief
says not to introduce paid services or incur expenses without approval,
so this is not something to build without your sign-off on the cost.**
Documenting the concrete options and their cost is a pending task, not yet
written up.

Secrets hygiene (verified): no `.env`/`.env.local` files are tracked in
git (only `.env.example` templates, which contain variable names and
placeholder/dev-only values, never real secrets — `git log --all` shows
no history of a real `.env` ever being committed either). This already
satisfies the brief's "never commit production secrets" and "environment
variable template with names/descriptions only" requirements; the four
existing `.env.example` files (`apps/api`, `apps/web`, `apps/ai-service`,
`apps/ifc-service`) were spot-checked and are accurate and current.

## 4. Domain & access — BLOCKED, awaiting your decision

No custom domain exists. **Will not purchase one without approval.** If
you want one, I need: the domain registrar/DNS provider you want to use,
and confirmation to proceed (there is a cost). Once you approve, this is a
DNS-only change (CNAME to the Render service) — reversible, no app-code
impact.

CORS, secure cookies, and security headers were verified in Section 9
below — all already correct for the current (no-custom-domain) setup, and
need no change when/if a domain is added beyond updating `ALLOWED_ORIGINS`/
`API_URL`/`FRONTEND_URL` to the new hostnames.

## 5. Authentication and authorization — VERIFIED (code-level review against current `main`)

Re-verified directly against the current `main` tip rather than trusting
the earlier RBAC audit's conclusions to still hold:

- **Guard chain** (`app.module.ts`, `APP_GUARD` providers, in order):
  `ThrottlerGuard → JwtAuthGuard → PendingApprovalGuard → TenancyGuard →
  RolesGuard → ProjectPermissionGuard → SiteRoleRestrictionGuard`.
  Unchanged from the prior audit — confirmed present and in this order on
  the current tip.
- **Login/password reset**: `AuthService.login()` and `.refresh()` both
  check `user.isActive` **and** `company.isActive` before issuing tokens
  (`auth.service.ts` lines 42, 106) — a disabled user or a deactivated
  company is rejected, not just hidden in the UI.
- **Session handling / expired sessions**: access tokens are short-lived
  (`JWT_ACCESS_EXPIRES_IN=15m`); `JwtStrategy.validate()` is intentionally
  stateless (signature + payload shape only, no DB round-trip per
  request — the standard JWT tradeoff for request latency). The real
  consequence, stated precisely rather than glossed over: **disabling a
  user does not revoke their already-issued access token instantly** — it
  keeps working for up to its remaining 15-minute lifetime. It *is* caught
  within that same window: the client must refresh to keep working, and
  `refresh()`'s `isActive`/`companyActive` check catches it there. So the
  real bound is "≤15 minutes," not instant — worth knowing, not a defect
  given the access-token lifetime is already short, but not something to
  describe as immediate revocation either.
- **Unauthorized requests**: `JwtAuthGuard` rejects anything without a
  valid bearer token before any handler runs; `TenancyGuard` re-checks
  `company.is_active` **on every single request** (not just at login),
  via `DatabaseService.withSystemBypass()` (see Section 11 below for a
  real historical incident involving this exact mechanism, already
  resolved).
- **Cross-org/cross-project ID manipulation (IDOR)**: checked directly in
  `issues.service.ts` as a representative sample. Two independent layers,
  not one: (1) every query explicitly filters `WHERE ... company_id =
  ${companyId} AND project_id = ${projectId}` using the *server-derived*
  JWT company ID, never a client-supplied one; (2) underneath that, every
  such query additionally runs inside `DatabaseService.withTenant()`,
  which sets a per-transaction Postgres GUC (`app.current_company_id`)
  that Row-Level Security policies (migration 052,
  `FORCE ROW LEVEL SECURITY`) enforce at the database layer regardless of
  the application-level filter. A request supplying another company's
  `projectId`/`issueId` in the URL returns zero rows at the database
  level even if the application-level `WHERE` clause were ever
  accidentally dropped in a future change — defense in depth, not a
  single point of failure.
- **Organization/project membership and role-based permissions**: the
  `ProjectAuthorizationService.hasProjectPermission()` consolidation (from
  the earlier RBAC phases) is unchanged on the current tip and still the
  single place project-scoped access is decided.

## 6. Multi-user and multi-tenant readiness — VERIFIED (isolation), PARTIAL (concurrency)

- **Organization isolation**: see Section 5's IDOR finding above — RLS +
  explicit `company_id` filters together. No cross-tenant leakage path
  found in the code reviewed.
- **Record ownership / audit history**: every mutation already runs
  through a global `AuditInterceptor` (confirmed registered in
  `app.module.ts`) that writes to `audit_log`, with semantic action labels
  for access-control changes specifically (RBAC Phase 6, earlier work).
- **Concurrent updates**: no optimistic-locking/version-column mechanism
  was found (e.g. no `updated_at`-based conflict check on `UPDATE`). For
  this app's actual usage pattern — one person editing one issue/RFI/snag
  status at a time, not simultaneous collaborative editing of the same
  field — last-write-wins is a reasonable default, but it is a real gap
  if two people ever do edit the same record at the same moment (one
  update silently overwrites the other with no warning). Not fixed here:
  it would touch update logic across many modules, which is a larger,
  separately-considered change, not a "smallest safe fix." Flagged for
  your awareness, not blocking.
- **File access isolation**: see Section 8 — storage keys are
  server-derived from the authenticated company/project, not
  client-suppliable.
- No multi-tenancy assumptions were introduced and no schema migration is
  proposed here, per the brief's explicit instruction.

## 7. Capacity and performance — PARTIAL, NO LOAD TEST RUN

- `engineeringos-db`: Postgres 16, `basic-256mb` plan, 15GB disk, no
  high-availability, no read replicas. This is Render's lowest real
  Postgres tier above "free" — a reasonable starting point for 100 users
  but with a visible ceiling (connection limits and RAM scale with plan).
- **Current baseline metrics** (via Render's own metrics API, ~1 hour
  sampled): `engineeringos-api` CPU usage ~0.1–0.3% of its 0.5 vCPU limit,
  memory ~100–109MB of its 512MB limit; `engineeringos-db` CPU ~0.7–1.2%,
  memory ~70–80MB, active connections steady at 1–3. **This reflects
  near-zero real traffic right now, not a tested capacity ceiling** — it
  says the app is idling comfortably, not that it can handle 100
  concurrent users, which has never been tested.
- **Pagination**: a shared `PaginationQuery` type is used consistently
  across 20+ service files (issues, RFIs, snagging, submittals,
  transmittals, QA, documents, captures, notifications, messaging, etc.).
  Spot-checked `issues.service.ts.findAll()`: default page size 20,
  **server-side clamped to a hard max of 100** (`Math.min(query.perPage ??
  20, 100)`) — a client cannot request an unbounded page size. This
  already satisfies the brief's "use pagination... avoid loading every
  record into the browser at once."
- No load test has been run against production or any other environment.
  **Per the brief, no aggressive load test will be run against production
  without explicit approval**, and a safe, low-traffic read-only probe
  against production has also not been run yet — that would need your
  go-ahead before it's attempted even at low intensity.
- No concurrency-level claim is made here, consistent with the brief.

## 8. File / media upload handling — VERIFIED (code-level review)

Reviewed `apps/api/src/modules/storage/storage.service.ts` and every
caller of its size-check helper:

- **Auth required / authorized per org+project**: storage keys are built
  server-side as `{companyId}/{type}/{projectId}/{uuid}.{ext}`
  (`generateKey()`) from the authenticated user's own company/project
  context, never from client-supplied values — consistent with the
  tenancy model reviewed in earlier RBAC work.
- **Private by default**: all reads go through `getReadUrl()`, a
  presigned `GetObjectCommand` URL, not a public bucket path. No public
  ACL or public bucket policy is set anywhere in the code.
- **Expiring links**: presigned upload URLs expire in 15 minutes
  (`getUploadUrl`); presigned read URLs default to `S3_PRESIGN_EXPIRES_IN`
  (3600s / 1 hour in `render.yaml`), both bounded, not indefinite.
- **Size validation is real, not just client-side**: the presigned PUT
  itself can't safely enforce `Content-Length` (documented in code —
  signing it breaks the upload if the actual byte count differs even
  slightly), so every upload path performs a server-side
  `HeadObjectCommand` (`getObjectSize()`) against the *actual* stored
  object after upload and rejects it if it exceeds the type's limit
  (5 MB, `ATTACHMENT_MAX_SIZE`). Confirmed this check exists in all 9
  callers: issues, RFIs, snagging, drawings, documents, projects
  (branding), captures, BIM models, and workforce screenshots. A
  rejected/oversized object is then deleted (`deleteIfExists`) rather
  than left orphaned.
- **File type validation**: an extension allow-list
  (`ATTACHMENT_ALLOWED_EXTENSIONS`: pdf/jpg/jpeg/png/xls/xlsx/doc/docx/zip)
  is enforced for attachment uploads.
- **Large files don't exhaust server memory**: uploads/downloads for
  user-facing attachments go directly browser ↔ S3-compatible storage via
  presigned URLs — API server bytes are never in the path for those. The
  one server-side `download()`/`upload()` path exists only for internal
  worker use (image-rendition generation), not general user traffic.
- Deletion/retention behavior is implemented per-module (e.g. issue/RFI/
  snag attachment removal calls `storage.delete()`) but a documented
  *retention policy* (how long old captures/attachments are kept) was not
  found — flagged as a gap, not a blocker.

No regression risk here since nothing was changed — this is a read-only
code review confirming the existing implementation already meets the
brief's Section 8 requirements.

## 9. Security review — VERIFIED against the brief's own checklist, two real fixes applied

Every item the brief's Section 9 explicitly names has been checked
directly against current code/config (not assumed): exposed secrets,
unsafe environment variables, publicly accessible private data, insecure
API endpoints, missing authorization checks, weak database/storage
rules, unrestricted file uploads, missing rate limiting, sensitive data
in logs, insecure CORS, vulnerable dependencies, excessive permissions,
and missing request validation. One item (AI Assistant provider key) is
a real gap requiring your decision, not a code fix; two real bugs
(missing security headers, the rate-limit-sharing bug) were found and
fixed this session.

Verified directly against current code:

- **CORS**: `apps/api/src/main.ts` restricts `origin` to `ALLOWED_ORIGINS`
  (render.yaml sets this to exactly `https://engineeringos-web.onrender.com`
  in production — not a wildcard). Correct.
- **Rate limiting**: global `ThrottlerGuard` via `APP_GUARD`
  (`app.module.ts`), 100 req/min default, 10 req/min on the `auth` throttler
  name — already in place.
- **Secret logging**: grepped for `console.log`/`logger.log` near
  password/token/secret — the two matches found log an email address and
  migration filenames, not secret values. No secret-logging issue found.
- **Security headers (gap, now fixed)**: no `helmet` middleware existed —
  no HSTS, `X-Content-Type-Options`, `X-Frame-Options`, etc. Added
  `helmet` as a direct dependency of `apps/api` and wired it into
  `main.ts` with `contentSecurityPolicy`/`crossOriginEmbedderPolicy`
  disabled (the API serves no HTML beyond Swagger's own inline
  scripts/styles in non-production, and nothing here is iframe-embedded or
  embeds another origin). Purely additive middleware — no route, auth, or
  DB behavior changed. Verified: `tsc --noEmit` clean, `eslint` clean,
  full Jest suite passing (502/502), production build succeeds.
- **Rate limiting was effectively global, not per-client (real bug, now
  fixed)**: Render terminates TLS and proxies every request through one
  internal hop before it reaches the container. Express's `trust proxy`
  setting was never configured, which means `req.ip` resolved to Render's
  internal proxy address for *every* request, not the real client. Two
  concrete consequences this caused: (1) NestJS's default `ThrottlerGuard`
  tracker keys off `req.ip` — with every request reporting the same IP,
  the 100 req/min / 10 req/min (auth) limits were effectively one shared
  bucket across *all* users, not per-client, meaning one busy or malicious
  user could rate-limit everyone else; (2) `auth.controller.ts` logs
  `req.ip` on login/refresh — every login from every user in production
  would have recorded the identical proxy IP, making that field useless
  for its intended security purpose. Fixed with `app.set('trust proxy',
  1)` — trusting exactly one hop matches Render's actual single-proxy
  topology (not `true`, which would trust an attacker-forgeable
  `X-Forwarded-For` chain of arbitrary length). Verified: `tsc --noEmit`
  clean, `eslint` clean, full Jest suite passing (502/502), production
  build succeeds.
- **Dependency vulnerability scan** (`pnpm audit --prod`): 143 findings
  (3 critical, 87 high, 47 moderate, 6 low). Read each critical finding's
  actual dependency path rather than trusting the count:
  - `proxy-addr` (critical, IP-spoofing via IPv4-mapped IPv6 trust-subnet
    parsing) — reached through `apps/api → @nestjs/platform-express →
    express → proxy-addr`, i.e. genuinely in the production API's
    dependency tree. Its specific vulnerable behavior only matters when
    `trust proxy` is configured with a subnet string; now that trust
    proxy is set to the integer `1` (trust exactly one hop, not a parsed
    subnet), this specific parsing bug is not in the code path that's
    actually exercised. A version bump would still be the complete fix but
    requires a `pnpm.overrides` entry forcing a transitive dependency
    (not yet done — low urgency given the above, but noted as a following
    task).
  - `tar` (critical, decompression DoS) and `shell-quote` (critical,
    command injection) — both reached only through
    `apps/agent → active-win → node-gyp/node-pre-gyp` and
    `apps/api → drizzle-orm → expo-sqlite → expo → ... → @react-native-community/cli`
    respectively: native-module build tooling and an Expo/React-Native CLI
    dependency chain that `drizzle-orm` pulls in as an *optional* adapter
    for a driver this codebase never uses (Postgres via `postgres`/`pg`,
    not `expo-sqlite`). Neither path is reachable by code this application
    actually executes in production. Not a live production risk, but
    inflates `node_modules` and audit noise — a candidate for a future
    `pnpm.overrides`/dependency-pruning pass, not urgent.
  - The great majority of the 143 findings share this same
    `drizzle-orm → expo-sqlite → expo → react-native → ...` chain. No
    change made to drizzle-orm here — swapping/pruning it is a larger,
    separately-considered change, not a "smallest safe fix."
- **Exposed secrets scan**: grepped the entire repository (excluding
  `node_modules`) for real-looking secret patterns — Anthropic key prefix
  (`sk-ant-`), AWS access key IDs (`AKIA...`), Stripe live keys
  (`sk_live_...`), Google API keys (`AIza...`), and PEM private-key
  headers. One match: `.env.production.example`'s
  `ANTHROPIC_API_KEY=sk-ant-...` / `STRIPE_SECRET_KEY=sk_live_...` —
  confirmed these are literal `...`-suffixed template placeholders (the
  file's own stated purpose), not real values. No actual exposed secret
  found anywhere in the repository.
- **Excessive permissions**: checked `app_user`'s actual `GRANT`s
  (migration 052) rather than assuming "narrowly scoped" without reading
  the grants — `SELECT, INSERT, UPDATE, DELETE` on tables plus
  `USAGE, SELECT` on sequences, with an explicit `REVOKE UPDATE, DELETE ON
  audit_log` carved back out (append-only audit trail, even for the app's
  own runtime role). No `DROP`, `TRUNCATE`, `ALTER`, `CREATE`, or
  superuser attributes granted — this is close to the minimum a
  CRUD application role needs, not an excessive grant.
- **Weak database rules — re-confirmed independently, not just cited**:
  the prior audit (`engineering-review/CURRENT_STATUS.md` §4) had
  documented a real, serious gap as of 2026-09-28 — production's runtime
  DB role was the table *owner*, which bypasses Postgres RLS by ownership
  regardless of the `tenant_isolation` policy's existence, and that
  document's own author marked it **RESOLVED** by migration 052. This
  session independently re-verified that resolution still holds on the
  current `main` tip (Section 5 above: `FORCE ROW LEVEL SECURITY` +
  explicit `app_user` grants + the `withSystemBypass()` GUC-flag mechanism
  for the fixed set of genuinely pre-tenant operations) — confirming the
  prior audit's fix is still in place, not just taking its word for it.
- **Login error-message specificity — reviewed, left as-is (prior
  product decision, not a new defect)**: `AuthService.login()` returns
  distinct messages for wrong credentials vs. a deactivated account vs.
  an inactive company. The prior audit (`CURRENT_STATUS.md` §3) already
  identified this as a deliberate UX-vs-enumeration tradeoff needing a
  product decision, not an engineering default, and explicitly left it
  unchanged. Per the brief's own "preserve the existing permission model
  unless a documented security defect requires a change," this is not
  re-litigated here — it's a known, already-surfaced tradeoff, not an
  unreviewed gap.
- **AI Assistant Gateway — missing provider key (new finding, not
  previously documented this explicitly)**: `render.yaml`'s
  `engineeringos-api` service block declares **no** `ANTHROPIC_API_KEY`,
  `GEMINI_API_KEY`, or `AI_PROVIDER` entry at all — not even `sync: false`.
  This is distinct from the already-known gap in `engineeringos-ai-service`
  (the separate Python RAG service, which *does* have `ANTHROPIC_API_KEY`/
  `OPENAI_API_KEY` declared as `sync: false`, "no key configured yet").
  The user-facing AI Assistant (`apps/api/src/modules/ai`, the Gateway
  rebuilt in PR #52) will fail its lazy `getProvider()` call on every
  single request in production today — it is non-functional, not merely
  degraded. Fixing this needs either a real `ANTHROPIC_API_KEY`/
  `GEMINI_API_KEY` added to `render.yaml` as `sync: false` plus the actual
  key value entered on the Render dashboard (your action — a secret value
  must never be pasted into this chat) or your confirmation that the AI
  Assistant is deliberately not live yet. **No change made to render.yaml
  for this yet — flagging it for your decision**, since adding the env var
  declaration is safe but a real key has a cost/account implication only
  you can authorize.

## 10. Backup & recovery — BLOCKED, cannot verify via API (confirmed open since before this session)

The prior audit (`engineering-review/CURRENT_STATUS.md` §5, §7;
`LAUNCH_READINESS.md`'s readiness table; `NEXT_STEPS.md`) already
identified this exact gap as of 2026-09-28: "Backups/restore: not
configured or documented anywhere in this repository... requires Render
dashboard/account access this environment doesn't have" and named it a
blocker for private beta and public launch specifically. This session
independently re-attempted verification rather than just repeating that
conclusion unchanged:

Attempted to confirm this directly rather than assume Render's documented
default applies: tried a read-only query against `engineeringos-db` via
the Render Postgres query tool — it was refused because the database's
`ipAllowList` is empty (no public internet access at all, confirmed in
Section 1). That refusal is itself good evidence of the correct network
posture, but it also means **backup configuration and retention cannot be
confirmed from here** — Render's backup settings (frequency, retention
window) are configured per-database in the dashboard's "Backups" tab, not
exposed through any tool available in this session.

**Per the brief, I will not claim backups work until this is verified and
a safe restoration test has been completed** — neither has happened.
**This needs your action**: open `engineeringos-db` → Backups in the
Render dashboard and tell me the configured frequency/retention (no
credentials needed, just what the settings show), or grant this session's
IP allowlist access temporarily if you want me to verify programmatically.
A real restoration test (restore to a *new*, throwaway database instance,
never overwriting the live one) is something I can help plan once backup
configuration is confirmed, and would need your explicit go-ahead before
running since it's the kind of production-data-adjacent operation the
brief gates.

## 11. Logging & monitoring — PARTIAL, one historical incident traced to resolution

- Render provides built-in log aggregation and the metrics shown in
  Section 7 for every service by default — already active, no
  configuration needed. No alerting is configured beyond that (Render
  supports email/Slack alerts on deploy failures and some metrics
  thresholds, configurable in the dashboard; not yet set up here, and
  doing so has no cost but does need dashboard access to configure, which
  I can walk you through on request).
- **Investigated live error logs rather than assuming the app has been
  running cleanly.** Found three distinct historical error clusters,
  traced each to a specific cause and determined whether it's resolved:
  1. **`PostgresError: role "app_bypass_rls" does not exist`, recurring
     every 5 minutes, plus a cluster of `/auth/login → 500` errors, all
     within an 8:43–8:52 AM window on 2026-10-04.** Root cause: migration
     052 introduced a bypass mechanism requiring a Postgres role that
     Render's managed Postgres doesn't permit creating (no `CREATEROLE`
     grant on the database owner — a platform restriction). This broke
     every pre-tenant operation (login, password reset, company
     registration, the two system cron jobs) the moment that migration's
     deploy actually ran. **Already fixed same-day**: commit `c21a4dd`
     ("URGENT: fix withSystemBypass() — login/signup broken in
     production") replaced the role-based bypass with a session-local
     Postgres GUC flag (migration 057) requiring no elevated privilege —
     the same mechanism `withTenant()`'s own tenant-scoping already used
     successfully. Confirmed via `list_logs` with a text filter for
     `app_bypass_rls` across the full window from immediately after that
     fix through now (2026-10-04 09:00 through 2026-10-09 03:30): **zero
     further occurrences.** This is a resolved historical incident, not
     an open item — documenting it because "verify it happened and is
     fixed" is stronger evidence than "assume no one told me about it."
  2. **`AiUsageService`/`AI Assistant` 503 (2026-10-05) and the
     `No AI provider configured` boot crashes (2026-10-08)** — both
     already covered in Sections 1 and 9 above (the AI Gateway's missing
     provider key, and PR #53's non-fatal-boot fix respectively). Not
     re-documented twice.
  3. One `POST .../convert-to-snag → 500` on 2026-10-07 — a single
     occurrence, not a recurring pattern in the log window checked;
     flagged as worth a closer look if it recurs, not investigated
     further here since it didn't repeat and the log line alone doesn't
     show a root cause.
- No structured alerting exists for a *new* occurrence of either error
  class above — if the same `app_bypass_rls`-style regression happened
  again, nothing would notify anyone automatically today beyond someone
  noticing broken logins. Configuring Render's built-in alerting (no
  additional cost) is a reasonable next step; I can set this up once you
  confirm you want it and which channel (email/Slack) to send to.

## 12. CI/CD and release management — ONE SAFE ADDITION IMPLEMENTED

Confirmed via direct read of `.github/workflows/ci.yml`: lint, typecheck,
test, and build run on every PR/push, but there was no deploy/smoke-test
step at all. Since there is no staging environment (Section 3), the
brief's full "staging deploy → smoke test → approved production release"
sequence isn't achievable without first building that environment (cost
decision, pending your answer). What *is* achievable without a staging
environment or any cost: added
`.github/workflows/post-deploy-health-check.yml`, triggered on every push
to `main` — it waits for Render's deploy to roll out, then polls the
already-public `/api/v1/health/ready` endpoint (checks database, Redis,
and object-storage reachability, not just "process is up") up to 5 times
over ~2.5 minutes, plus a check that `engineeringos-web` is serving.
Read-only, no application behavior changed, YAML syntax validated. This
turns "a deploy silently broke production" (exactly what happened on
2026-10-04 and again on 2026-10-08, per Section 11) into a visibly red
GitHub Actions run on the commit that caused it, rather than relying on a
user noticing. It cannot block or roll back a bad deploy — GitHub Actions
has no hook into Render's own deploy pipeline — so this is a detection
improvement, not a prevention one; true pre-production gating needs the
staging environment this section's real gap still is.

## 13. Cost identification — PARTIAL (rough estimate, verify against Render's current pricing)

Current known recurring services, with Render's publicly listed starting
prices for these plan tiers **as a rough order of magnitude — please
verify exact current pricing on Render's own pricing page before treating
these as firm, since published prices change**:

| Service | Plan | Rough monthly cost |
|---|---|---|
| `engineeringos-api` | starter web_service | ~$7 |
| `engineeringos-web` | static_site | $0 (static sites are free on Render) |
| `engineeringos-ifc-service` | starter background_worker | ~$7 |
| `engineeringos-ai-service` | starter private_service | ~$7 |
| `engineeringos-qdrant` | starter private_service + 5GB disk | ~$7 + small disk fee |
| `engineeringos-db` | basic-256mb Postgres | ~$19 |
| `engineeringos-redis` | free key-value | $0 |

**Fixed cost, rough total: ~$45–50/month** at current scale, before any
domain purchase or paid AI provider usage. **Usage-based/variable costs,
not yet activated or estimable without real traffic**: AI provider API
calls (Anthropic/Gemini — zero spend today since no key is configured at
all, per Section 9), object-storage (Cloudflare R2) bandwidth/storage
beyond whatever free tier it has, and any future autoscaling beyond one
instance per service. **Not yet activated, so $0 today, but would add
cost if approved**: a custom domain (one-time registration + annual
renewal, varies by registrar/TLD), a second environment for
staging/dev (would roughly double the fixed-cost table above), and any
log-alerting add-on beyond Render's free built-in tier. No paid service
has been activated this session; nothing above has changed.

## Immediate safe changes made this session

- Added `helmet` to `apps/api` and wired default security headers into
  `main.ts` (CSP/COEP disabled, see Section 9).
- Set `app.set('trust proxy', 1)` in `apps/api/src/main.ts`, fixing the
  shared-rate-limit-bucket bug and useless login-IP logging (Section 9).
- Ran `pnpm audit --prod` and read every critical finding's actual
  dependency path rather than reporting the raw count (Section 9).
- Confirmed no Firebase/Firestore anywhere in the repo and documented the
  actual architecture/request flow (Section 2).
- Confirmed no real `.env` file has ever been committed to git history
  (Section 3).
- Code-reviewed file/media upload handling end-to-end (Section 8).
- Re-verified the full auth/authz guard chain, session-expiry bound, and
  cross-tenant ID-manipulation defenses against the current `main` tip,
  not just trusting the earlier audit's conclusions (Section 5).
- Reviewed multi-tenant isolation and flagged the no-optimistic-locking
  gap for awareness, not as a blocker (Section 6).
- Pulled live CPU/memory/connection metrics and confirmed pagination is
  enforced server-side with a hard cap (Section 7).
- Investigated live error logs and traced a historical production
  incident (`app_bypass_rls` role-creation failure, 2026-10-04) to its
  root cause and confirmed same-day resolution, with zero recurrence
  since (Section 11).
- Added `.github/workflows/post-deploy-health-check.yml` — a read-only
  post-deploy readiness poll against the existing public health endpoint,
  since there was previously zero automated signal when a deploy broke
  production (which has happened twice: 2026-10-04 and 2026-10-08)
  (Section 12).
- Wrote a rough, explicitly-caveated monthly cost estimate from current
  services (Section 13) — no paid service was activated.
- Found and read the prior technical audit already in this repository
  (`engineering-review/CURRENT_STATUS.md`, `LAUNCH_READINESS.md`,
  `NEXT_STEPS.md`) and cross-referenced every section above against it —
  confirming where its conclusions still hold (the RLS/`app_user` fix),
  where this session's own evidence extends it (the `app_bypass_rls`
  incident trace, the post-deploy health check), and where its flagged
  gaps are still open today (backups, the AI provider key, no staging
  environment).
- Completed the remaining Section 9 checklist items: scanned the
  repository for real exposed secrets (none found — one placeholder-only
  match), checked `app_user`'s actual database grants for excessive
  permissions (none found — close to minimum CRUD), and reviewed the
  login error-message enumeration tradeoff (a pre-existing, already-
  documented product decision, not a new defect).

None of the above changed any API contract, auth behavior, or database
schema/data. Verified after each code change: `tsc --noEmit` clean,
`eslint` clean, full Jest suite passing (502/502), production build
succeeds; the new workflow's YAML was syntax-validated.

## Open items requiring your decision before I proceed

1. Custom domain — do you want one, and on what registrar? (cost, your approval needed)
2. AI Assistant Gateway has no provider key declared in `render.yaml` at
   all — is this feature meant to be live yet? If so, I can add the
   `sync: false` declaration; you'd then paste the real key only into the
   Render dashboard, never into this chat.
3. Staging/dev environment — duplicating the Render blueprint has a real
   monthly cost; do you want a cost estimate before I document the
   concrete setup options?
4. Backup/recovery (Section 10) — I cannot verify this via any tool
   available in this session (the database correctly has no public
   network access). Please open `engineeringos-db` → Backups in the
   Render dashboard and tell me the configured frequency/retention, or
   let me know if you'd like deploy-failure/metric alerting configured
   (no cost, dashboard-only setup I can walk you through).

---

## 16. Final report

### 1. Actual production architecture

Not Firebase-based (the brief's template assumes Firebase; this repo has
none — see Section 2). NestJS 10 (`apps/api`) on Node 22, Docker, Render
`web_service`; React + Vite SPA (`apps/web`), Render `static_site`;
self-hosted PostgreSQL 16 with Row-Level Security (`engineeringos-db`,
Render managed, private-network-only); S3-compatible object storage
(Cloudflare R2) via presigned URLs; a separate Python/FastAPI RAG service
+ Qdrant vector DB (`apps/ai-service`, `engineeringos-qdrant`), both
Render `private_service`s with no public exposure; Redis for the Bull job
queue (`engineeringos-redis`, free tier). Full request-flow diagram in
Section 2. **VERIFIED COMPLETE.**

### 2. Changes made

1. Added `helmet` security-headers middleware to `apps/api` (Section 9).
2. Fixed `app.set('trust proxy', 1)` — resolved a real bug where rate
   limiting was a single shared bucket across all users instead of
   per-client, and login-IP logging was recording the wrong address
   (Section 9).
3. Added `.github/workflows/post-deploy-health-check.yml` — read-only
   post-deploy readiness polling (Section 12).
4. Wrote this tracking document (`docs/phase2-production-readiness.md`).

No database schema change, no API contract change, no auth-behavior
change, no production secret or credential touched, nothing deployed
outside the existing autodeploy-on-push-to-`main` mechanism that was
already in place before this phase started. **VERIFIED COMPLETE.**

### 3. Files changed

- `apps/api/package.json`, `pnpm-lock.yaml` — added `helmet` dependency.
- `apps/api/src/main.ts` — `helmet()` middleware, `trust proxy` setting.
- `.github/workflows/post-deploy-health-check.yml` — new file.
- `docs/phase2-production-readiness.md` — new file (this document).

**VERIFIED COMPLETE.**

### 4. Services configured

None. No Render service configuration, environment variable, or database
setting was changed this phase — every finding above that would require
a service-configuration change (AI provider key, backups, alerting,
staging environment, custom domain) is listed as **REQUIRES MY ACTION**
or **BLOCKED** below, not silently applied. **VERIFIED COMPLETE** (as in:
verified that nothing was changed, which was the deliberate, safe choice
for anything touching live service config).

### 5. Tests executed and results

After every code change this phase: `pnpm --filter api typecheck` (clean),
`pnpm --filter api lint` (clean), `pnpm --filter api test` (502/502
passing), `pnpm --filter api build` (succeeds). The new GitHub Actions
workflow's YAML was syntax-validated with `python3 -c "import yaml..."`
(not executed end-to-end against a real deploy yet — that happens on the
next push to `main`). No new application tests were added this phase
(no application code behavior changed beyond the two Section 9 fixes,
both covered by the existing suite continuing to pass). **VERIFIED
COMPLETE** for what was run; the workflow's first real trigger is
**IMPLEMENTED BUT NOT VERIFIED** until it fires on an actual push.

### 6. Security findings and resolutions

See Section 9 in full. Summary: 2 real bugs found and fixed (missing
security headers; shared rate-limit bucket from an unconfigured trust
proxy). 1 real gap found, not fixed, needs your decision (AI Assistant
has no provider key declared anywhere in `render.yaml` — non-functional
in production today). 1 dependency-audit finding read to its actual
path and determined non-urgent (`proxy-addr`, reachable in principle but
its vulnerable code path isn't exercised by the current trust-proxy
config). Everything else checked (secrets scan, permissions, CORS, RLS,
request validation, file-upload validation) came back clean — **VERIFIED
COMPLETE** for the checks performed; **no claim is made** about checks
this document doesn't list (e.g. no penetration test was run).

### 7. Staging deployment URL

**NOT IMPLEMENTED.** No staging environment exists. Building one means a
second Render Blueprint (duplicate services + a second Postgres instance)
with a real recurring cost — gated on your approval per the brief's cost
rules. See Section 3/13 for the concrete tradeoff; I have not built this
without you seeing the cost first.

### 8. Load-test methodology and results

**NOT IMPLEMENTED.** No load test has been run against any environment.
Per the brief, an aggressive test will never run against production
without explicit approval, and even a safe, low-intensity read-only probe
hasn't been attempted yet without your go-ahead. Current metrics
(Section 7) describe an idling system, not a tested ceiling — no
concurrency claim is made.

### 9. Backup and recovery status

**BLOCKED.** Cannot be verified from this session — the database
correctly has no public network access, which is itself good security
but also means Render's backup/retention configuration can't be checked
by any tool available here. This exact gap was already flagged by the
prior audit (2026-09-28) and remains open today. **REQUIRES MY ACTION**:
confirm the Backups tab settings in the Render dashboard for
`engineeringos-db`, after which a restoration test (to a new, throwaway
instance, never overwriting production) can be planned with your
approval.

### 10. Monitoring status

**PARTIAL.** Render's built-in per-service logs and metrics are active
by default (no setup needed). Added a post-deploy readiness poll this
phase (Section 12) — detection, not prevention or continuous monitoring.
No alerting is configured for an in-between-deploys regression (e.g. a
new `app_bypass_rls`-style incident would currently only be caught by
someone checking logs or noticing broken logins). Configuring Render's
built-in deploy/metric alerting is a no-cost, dashboard-only task I can
walk you through once you confirm you want it. **IMPLEMENTED BUT NOT
VERIFIED** for the health-check workflow (first real trigger pending);
**REQUIRES MY ACTION** (your decision) for alerting.

### 11. Estimated monthly costs

~$45–50/month fixed cost at current scale (4 starter services + 1
basic-256mb Postgres + free Redis + free static site), explicitly
caveated against Render's current published pricing — see the full
breakdown in Section 13. No paid service was activated this phase; usage-
based costs (AI API calls, object-storage bandwidth) are currently $0
since no AI provider key is configured at all.

### 12. Remaining blockers

1. AI Assistant Gateway has no provider key anywhere in `render.yaml` —
   non-functional in production (Section 9).
2. No staging/dev environment — every merge to `main` goes straight to
   production with no pre-production gate beyond CI's lint/test/build
   and the new post-deploy health check (Sections 3, 12).
3. Backup/recovery configuration unverified, no restore ever tested
   (Section 10).
4. No custom domain (Section 4) — not a functional blocker, both services
   work correctly on their `*.onrender.com` URLs, but named here since the
   brief's own objective #1 is a production domain.
5. No load test has ever been run — current capacity under 100 concurrent
   users is unknown, not merely "untested for compliance reasons" but
   genuinely unknown (Section 7).
6. No alerting on logs/metrics between deploys (Section 11).

### 13. Exact actions requiring your involvement

1. **Custom domain** — tell me the registrar/DNS provider and approve the
   purchase cost, or confirm you don't want one yet.
2. **AI Assistant provider key** — confirm whether this feature should be
   live; if yes, I'll add the `sync: false` declaration to `render.yaml`
   and you paste the real key only into the Render dashboard (never into
   this chat).
3. **Staging environment** — approve the recurring cost (roughly doubles
   the current fixed-cost total) before I build it, or tell me to
   document the setup without building it yet.
4. **Backups** — open `engineeringos-db` → Backups in the Render
   dashboard and tell me the configured frequency/retention, since no
   tool in this session can read it directly.
5. **Alerting** — tell me if you want Render's built-in deploy-failure/
   metric alerts configured (no cost) and which channel (email/Slack).
6. **Load testing** — explicit approval needed before even a safe,
   low-intensity test runs against any environment, and production is
   off-limits for an aggressive one regardless.

### 14. Production launch checklist

Per the brief's own Section 15 acceptance criteria — nothing below is
checked off without the evidence cited:

- [x] Production architecture documented — Section 2.
- [x] Frontend production build succeeds — verified every code change this phase (`pnpm --filter api build`/`pnpm build`).
- [x] Backend production build succeeds — same evidence.
- [ ] Staging deployment is operational — NOT IMPLEMENTED (Section 3/7 above), cost decision pending.
- [ ] Authentication works in staging — no staging exists; authentication was verified by code review against the live production guard chain instead (Section 5), not a staging deploy.
- [x] Authorization is verified on protected operations — Section 5 (guard chain, IDOR defense-in-depth, re-verified against current `main`).
- [x] Database and storage rules are reviewed — Sections 6, 8, 9 (RLS, upload validation, storage bucket privacy).
- [ ] Existing core workflows pass regression tests — the existing Jest suite passes (502/502), but this phase did not re-run the prior audit's live-browser regression pass; no new claim is made about UI-level regression beyond what `LAUNCH_READINESS.md` already verified before this phase started.
- [x] Environment variables are documented — Section 3 (4 existing `.env.example` files plus root `.env.production.example`, all spot-checked, no real secrets).
- [ ] No known critical security issue remains unresolved — one real, known issue remains: the AI Assistant has no provider key configured anywhere (non-functional, not insecure, but a known gap pending your decision).
- [ ] Backup and recovery procedures are documented and tested where configured — BLOCKED, Section 10.
- [x] Monitoring and logging are operational where configured — Render's built-in logging/metrics plus the new post-deploy health check (Section 11/12); alerting itself is not configured (your decision pending).
- [x] Deployment and rollback procedures are documented — deploy: Render auto-deploy-on-push + `preDeployCommand` migrations (Section 1); rollback: re-deploy a prior image (no scripted down-migrations), documented here and consistent with the prior audit's own finding.
- [ ] Capacity testing results are recorded — NOT IMPLEMENTED, Section 7; only idle-baseline metrics exist, no load test.
- [x] Estimated operating costs are provided — Section 13 (explicitly caveated rough estimate).
- [x] Production launch blockers are identified — Section 12 above, this document's "remaining blockers" list.

**Overall verdict, stated precisely rather than rounded up**: this phase
found and fixed two real production bugs (security headers, shared rate
limiting) and traced one historical incident to confirmed resolution,
without touching data, schema, or auth contracts. The platform is
**not** newly "production-ready" as a result — the brief's own
instruction not to claim readiness just because it builds applies
directly here. The specific items still blocking a real production
launch are backups (unverified), the AI Assistant (unconfigured), staging
(nonexistent, cost-gated), and load testing (never run) — all four
already named, with exactly what's needed from you to close each one.
