# EngineeringOS — Production Deployment Checklist

**Phase 6: Final Production Readiness & Acceptance Testing**
Grounded in a full read of `render.yaml`, `.github/workflows/ci.yml`, `.github/workflows/post-deploy-health-check.yml`, and the health/config modules. Checked items (`[x]`) are confirmed either by code review or a live test this engagement performed. Unchecked items (`[ ]`) are gaps or require your action — each says exactly what and why.

---

## Infrastructure

- [x] Database: managed Postgres 16 (Render), no public internet access (`ipAllowList: []`) — API/ifc-service reach it over Render's private network only.
- [x] Redis/queue: managed keyvalue instance, same private-network-only posture.
- [x] API service: Docker runtime, health-checked at `/api/v1/health`.
- [x] Separate `ai-service` (Python, semantic/vector search) and `ifc-service` (IFC parsing worker) as their own Render services.
- [x] Static web app served separately with SPA rewrite rules.
- [ ] **No staging environment exists.** `render.yaml` defines exactly one environment, tracking `main` directly. There is no mechanism to test a release against production-like infrastructure before it serves real traffic. **Decision needed:** accept this for the current scale, or provision a second Render environment before the next major release.

## Configuration

- [x] `JWT_ACCESS_SECRET`/`JWT_REFRESH_SECRET` — required at boot, auto-generated per environment (`generateValue: true`), process refuses to start without them.
- [x] `CREDENTIAL_ENCRYPTION_KEY` — **added this engagement**; same fail-closed treatment as the JWT secrets (see `KNOWN_ISSUES_AND_REMEDIATION.md` C-5). Confirm it is actually set in the Render dashboard before the next deploy (it's `generateValue: true` in `render.yaml`, which Render applies automatically on first provision — verify it wasn't already provisioned without this key present in an earlier deploy).
- [x] `.env.local`/`.env` are gitignored; no committed secrets found in a full-repo grep for API-key/password/PEM-key patterns.
- [ ] `GEMINI_API_KEY`/`ANTHROPIC_API_KEY`/`OPENAI_API_KEY` (and optionally `AI_PROVIDER`) — **not set anywhere in `render.yaml`.** The user-facing AI Assistant is non-functional in production until you set one via the Render dashboard. *Action: you.*
- [ ] `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET` — currently literal placeholder values in `render.yaml`. Billing/webhooks will be rejected by Stripe until real keys are set via the dashboard. *Action: you.*
- [ ] `MICROSOFT_OAUTH_CLIENT_ID`/`MICROSOFT_OAUTH_CLIENT_SECRET` and `GMAIL_OAUTH_CLIENT_ID`/`GMAIL_OAUTH_CLIENT_SECRET` — needed for live Outlook/Gmail connection testing; not configured in this sandbox. See `docs/phase3-email-integration.md` for the exact external setup steps (Entra App Registration / Google Cloud Console). *Action: you.*
- [ ] `DB_CA_CERT` — documented in `render.yaml` as a manual one-time step (open a Render Shell, pull the cert via `openssl s_client`, paste it in). Confirm this has actually been done for the live database connection, not just documented.

## Security

- [x] `helmet()` wired into `main.ts` (confirmed via code read) with CSP/COEP deliberately disabled for this API-only origin (reasonable trade-off, documented in-code).
- [x] CORS: explicit allowlist via `ALLOWED_ORIGINS`, never a wildcard; `credentials: true` combined correctly.
- [x] `trust proxy: 1` — correct minimal setting for Render's single-hop reverse-proxy topology (protects the per-IP rate limiter and audit-log IP values from trivial spoofing).
- [x] Global rate limiting (100 req/min default, 10/min on auth, 20/min on AI) — confirmed working live.
- [x] Argon2id password hashing; JWT secrets validated at boot; refresh-token rotation and revocation confirmed working.
- [x] SQL injection: fully parameterized queries throughout (tagged-template `postgres` driver); zero raw string-interpolation into SQL found in a full-repo grep.
- [x] RLS (Row-Level Security) architecture (`withTenant`/`withSystemBypass`) applied consistently; the narrow "bypass" escape hatch is used only for genuinely pre-tenant lookups (login, token lookup, signup-code lookup), never generically.
- [x] 4 authorization gaps found and fixed this engagement (see `KNOWN_ISSUES_AND_REMEDIATION.md` C-1 through C-4) — re-verified live and via the full regression suite.
- [ ] **`pnpm audit --prod` shows 3 critical / 87 high findings.** Priority: `sharp` (processes untrusted uploaded images), `axios`, `nodemailer` are all below patched versions. See H-3. *Action: schedule a dependency-upgrade pass before go-live, or explicitly accept the risk with a named owner and date.*
- [ ] Same-company cross-project access gap on issue/drawing sub-resources (H-1) — not fixed this engagement (needs a focused multi-file pass). *Decision needed before go-live if any customer runs multiple confidential, separately-staffed projects under one company account.*
- [ ] No account lockout on repeated failed logins across rotating IPs (M-2). *Decision needed: accept current per-IP throttling as sufficient, or schedule the feature.*

## Backups

- [x] 3-day point-in-time recovery + on-demand export configured (confirmed in Phase 2's prior audit, re-verified as current via a fresh read of the Render Postgres plan config this engagement).
- [x] A real restore test was performed against a disposable Render Postgres instance in Phase 2 (documented in `docs/phase2-production-readiness.md`) — not re-run this engagement (would require provisioning real Render infrastructure, outside this sandbox's reach).
- [ ] **Re-run the restore test periodically** (quarterly is a reasonable cadence) — a backup strategy that was validated once is not validated forever. *Action: you, on a schedule.*

## Monitoring

- [x] Post-deploy health check (`.github/workflows/post-deploy-health-check.yml`) — polls `/api/v1/health/ready` up to 5× after every push to `main`, correctly checking both HTTP status and the JSON body.
- [ ] **`/api/v1/health` (Render's own native health-check path) always returns HTTP 200, even when its internal DB check fails** (M-4). Render's own auto-restart mechanism cannot detect a live DB outage between deploys this way. *Recommend fixing before go-live — it's a small, well-understood change, but changing a production health check's behavior is flagged for your sign-off rather than applied unilaterally in this audit.*
- [ ] **No structured logging or error-monitoring (APM) tool is integrated** (no Sentry/Datadog/equivalent found anywhere in the codebase). Production incident response currently depends entirely on Render's console log viewer. *Decision needed: accept this for current scale, or integrate an APM tool before go-live.*
- [ ] No alerting is configured beyond GitHub Actions workflow failure notifications (which only fire around a deploy, not continuously).

## Rollback

- [x] Rollback procedure exists and is accurate as documented: redeploy a previous commit/image via Render. No destructive migrations were found (every migration reviewed is additive or uses safe `ALTER ... USING` casts).
- [ ] **No scripted down-migrations exist.** 52 of 66 migration files have no rollback comment at all (though none are destructive on their own). A rollback that needs to undo a schema change, not just revert application code, requires a human to hand-write the reverse SQL. *Recommend: document this limitation plainly for whoever is on call, and require every future migration PR to include a rollback comment (several already do — make it a lint/PR-template rule rather than inconsistent practice.)*
- [x] **Duplicate migration number `052`** (two unrelated files) does not currently cause any functional conflict (alphabetical sort keeps them stable), but should be renumbered before it does. (L-4)

## Go-live approvals

This checklist's unchecked items are the actual go-live blockers and decisions, consolidated:

| # | Item | Blocking? | Who decides |
|---|---|---|---|
| 1 | `CREDENTIAL_ENCRYPTION_KEY` confirmed set in the real Render environment (not just added to `render.yaml` this engagement) | **Yes — Critical** | You (verify in the Render dashboard) |
| 2 | If any past deployment ran without it: rotate every stored OAuth/BYO-AI credential | **Yes, if applicable — Critical** | You |
| 3 | Same-company cross-project access gap (H-1) fixed or explicitly risk-accepted | **Yes — High**, if multi-project confidentiality within one company matters to your customers | You |
| 4 | `sharp`/`axios`/`nodemailer` upgraded past patched versions | **Yes — High**, given `sharp` processes untrusted input | You (schedule the upgrade pass) |
| 5 | Real AI provider key set (or AI Assistant explicitly marked "not available yet" in the product) | Not blocking for core platform, but misleading if left silently broken | You |
| 6 | Real Stripe keys set (or billing explicitly marked "not live yet") | Not blocking unless billing is required at launch | You |
| 7 | `/api/v1/health` status-code fix | Recommended before go-live, not strictly blocking | You (approve the change) |
| 8 | Account lockout / cross-IP brute-force protection | Lower urgency, real gap | You |
| 9 | APM/structured logging | Lower urgency for initial launch at this scale, real gap | You |

**My assessment (not a go-live authority — that's yours):** items 1–2 are the only ones I'd call hard blockers given their severity; everything else is a real, documented trade-off you're entitled to accept consciously rather than something I'd withhold a GO over on my own authority.
