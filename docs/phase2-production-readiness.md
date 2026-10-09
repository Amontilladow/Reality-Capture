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

## 4. Capacity / workload review — PARTIAL, NO LOAD TEST RUN

- `engineeringos-db`: Postgres 16, `basic-256mb` plan, 15GB disk, no
  high-availability, no read replicas. This is Render's lowest real
  Postgres tier above "free" — a reasonable starting point for 100 users
  but with a visible ceiling (connection limits and RAM scale with plan).
- No load test has been run against production or any other environment.
  **Per the brief, no aggressive load test will be run against production
  without explicit approval**, and a safe, low-traffic read-only probe
  against production has also not been run yet — that would need your
  go-ahead before it's attempted even at low intensity.
- No concurrency-level claim is made here, consistent with the brief.

## 5. Domain & access — BLOCKED, awaiting your decision

No custom domain exists. **Will not purchase one without approval.** If
you want one, I need: the domain registrar/DNS provider you want to use,
and confirmation to proceed (there is a cost). Once you approve, this is a
DNS-only change (CNAME to the Render service) — reversible, no app-code
impact.

## 6. Authentication / authorization review — NOT RE-STARTED THIS SESSION

The RBAC guard chain (ThrottlerGuard → JwtAuthGuard → PendingApprovalGuard
→ TenancyGuard → RolesGuard → ProjectPermissionGuard →
SiteRoleRestrictionGuard) and `ProjectAuthorizationService` were built and
tested across PRs #44–#52 in earlier sessions (404+ passing authorization
tests at the time). Not yet re-verified against the current `main` tip in
this Phase 2 pass — pending.

## 7. Multi-tenant readiness — NOT STARTED THIS SESSION

RLS via the narrowly-scoped `app_user` role (migration 052) is already in
place and is the existing isolation mechanism. **No multi-tenancy
assumptions will be introduced and no schema migration will be proposed
without a documented plan and your approval**, per the brief.

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

## 9. Security review — PARTIAL, one fix applied this session

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

## 10. Backup & recovery — NOT STARTED THIS SESSION

Render's managed Postgres plans include automated daily backups by
default, but this has not been confirmed in the dashboard for this
specific instance, and **no restoration test has been run** — per the
brief, backups will not be described as "working" until a safe restore is
actually verified.

## 11. Logging & monitoring — PARTIAL

No log aggregation/alerting beyond Render's own built-in log viewer and
metrics has been confirmed. Not yet reviewed this pass.

## 12. CI/CD & release management — GAP CONFIRMED, no fix implemented yet

Confirmed via direct read of `.github/workflows/ci.yml`: lint, typecheck,
test, and build run on every PR/push, but there is no staging deploy and
no smoke test before production traffic sees a change. A GitHub Actions
step that curls the deployed `/api/v1/health` endpoint after Render's
auto-deploy would be a safe, reversible addition (no behavior change, CI
config only) — proposed as a next step, not yet implemented.

## 13. Cost identification — NOT STARTED THIS SESSION

Current known recurring cost surface: 4 `starter`-plan services +
1 `basic-256mb` Postgres, 1 free Redis — no paid add-ons beyond what's
already running. No new paid service will be activated without approval.

## Immediate safe changes made this session

- Added `helmet` to `apps/api` and wired default security headers into
  `main.ts` (CSP/COEP disabled, see Section 9 above).
- Set `app.set('trust proxy', 1)` in `apps/api/src/main.ts`, fixing the
  shared-rate-limit-bucket bug and useless login-IP logging described in
  Section 9 above.
- Ran `pnpm audit --prod` and read every critical finding's actual
  dependency path rather than reporting the raw count (Section 9).
- Confirmed no Firebase/Firestore anywhere in the repo and documented the
  actual architecture/request flow (Section 2).
- Confirmed no real `.env` file has ever been committed to git history
  (Section 3).
- Code-reviewed file/media upload handling end-to-end (Section 8).

None of the above changed any API contract, auth behavior, or database
schema/data. Verified after each change: `tsc --noEmit` clean, `eslint`
clean, full Jest suite passing (502/502), production build succeeds.

## Open items requiring your decision before I proceed

1. Custom domain — do you want one, and on what registrar? (cost, your approval needed)
2. AI Assistant Gateway has no provider key declared in `render.yaml` at
   all — is this feature meant to be live yet? If so, I can add the
   `sync: false` declaration; you'd then paste the real key only into the
   Render dashboard, never into this chat.
3. Staging/dev environment — duplicating the Render blueprint has a real
   monthly cost; do you want a cost estimate before I document the
   concrete setup options?
