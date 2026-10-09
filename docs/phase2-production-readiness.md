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

## 2–3. Production architecture / environment separation — PARTIAL

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

## 8. File / media upload handling — NOT STARTED THIS SESSION

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
  `main.ts` (CSP/COEP disabled, see Section 9 above). No API contract,
  auth, or DB behavior changed. Verified: typecheck, lint, full test
  suite (502/502), and production build all pass.

## Open items requiring your decision before I proceed

1. Custom domain — do you want one, and on what registrar? (cost, your approval needed)
2. AI Assistant Gateway has no provider key declared in `render.yaml` at
   all — is this feature meant to be live yet? If so, I can add the
   `sync: false` declaration; you'd then paste the real key only into the
   Render dashboard, never into this chat.
3. Staging/dev environment — duplicating the Render blueprint has a real
   monthly cost; do you want a cost estimate before I document the
   concrete setup options?
