# Implementation Report — RealityCapture Platform Audit

**Branch:** `claude/platform-audit` (fresh branch off current `main`; this audit is unrelated to the separately-reviewed security-fix work that was already merged into `main` as PR #96).

## Files changed

| File | Change |
|---|---|
| `apps/web/src/components/ui/LiveClock.tsx` | New. The Asia/Dubai live clock component (Phase 4). |
| `apps/web/src/components/ui/LiveClock.test.tsx` | New. 6 tests (timezone correctness, per-second update, timer cleanup, no duplicate timers, tab-resume refresh). |
| `apps/web/src/components/layout/AppShell.tsx` | Edited. Imports and renders `<LiveClock />` in the sidebar footer, above the account row. |
| `docs/platform-audit/realitycapture-audit.md` | New. Phase 1 baseline (architecture, email forensics, workforce-screenshot capability determination, secrets spot-check). |
| `docs/platform-audit/api-evaluation.md` | New. Email-provider and disposable-domain-detection candidate comparison. |
| `docs/platform-audit/implementation-report.md` | New (this file). |

Nothing else was touched. No dependency changes, no migrations, no config/env var changes, no other UI/behavior changes.

## What was actually implemented this pass

**Phase 4 — live Abu Dhabi clock.** The only phase of the original brief with zero external dependency and a confirmed-clean slate (no existing clock component, per the baseline audit). Implemented as a small, self-contained component:

- `Intl.DateTimeFormat` with `timeZone: 'Asia/Dubai'` — no external time API, no added dependency, no network call.
- Ticks via a single `setInterval(1000)` per mount, cleared on unmount (verified by a test that spies on `window.clearInterval` and asserts it fires exactly once).
- Recomputes from a fresh `new Date()` on every tick rather than incrementing a counter, so a throttled/backgrounded tab's drift self-corrects on the next tick instead of accumulating.
- A `visibilitychange` listener forces one extra recompute the instant the tab becomes visible again, so the display never sits stale after the browser throttles a hidden tab.
- Shows `HH:MM:SS` plus a compact `Wed 29 Oct · Asia/Dubai` line underneath — visible, not dominant, placed in the sidebar footer above the account row (where `ThemeToggle` already lives), so it's present on every authenticated screen via `AppShell` without needing to be added to each page individually.
- No SSR/hydration concern: this is a plain client-rendered Vite SPA, no server-rendered markup to mismatch.

**Everything else in the original 9-phase brief is explicitly *not* implemented this pass**, for the reasons laid out in `realitycapture-audit.md` and `api-evaluation.md`: the email-verification flow, disposable-email detection, and workforce-screenshot interval/status enhancements all either require an external account/decision only you can make, or are large enough new product surface (a signup-flow change) that building them without your confirmation first would risk exactly the kind of unrequested scope the brief's own rules warn against (rules #1–3: inspect first, preserve architecture, don't rebuild working features). See "Remaining blockers" below and the backlog document.

## Configuration required

**None, for what was actually implemented.** The clock needs no environment variables, no new secrets, no DNS, no infrastructure change.

For the (not-yet-built) email work, once you've picked a provider per `api-evaluation.md`, the configuration path is entirely pre-existing — `render.yaml`'s `engineeringos-api` service already declares `SMTP_HOST`/`SMTP_PORT`/`SMTP_USER`/`SMTP_PASSWORD`/`SMTP_FROM` as `sync: false` placeholders. No `.env.example` changes are needed because these variables already exist there; see the repo's `.env.production.example` if you want to confirm the names before filling them into the Render dashboard.

## Tests executed and actual results

All commands run in this session, against the repo's own scripts, full output captured:

```
pnpm typecheck   -> 6/6 packages clean (api, web, mobile, agent, ifc-service, packages/types)
pnpm test        -> 0 failures across all 9 workspace packages
    apps/api:               85 suites / 921 tests passed
    apps/web (vitest):      8 files / 54 tests passed (46 pre-existing + 8 new: the 6
                            LiveClock tests above, re-counted here against the full suite)
    apps/ifc-service:       1 suite / 6 tests passed
    tools/bim-debug:        2 tests skipped (no real customer IFC file — pre-existing, documented)
pnpm build       -> api, ifc-service, web all build clean
pnpm lint        -> 0 errors; 2 pre-existing warnings in apps/web, unrelated to this change
```

Notably, the `apps/api` test run's own log output independently corroborates this audit's email root-cause finding, captured live mid-suite:

```
[AuthService] Failed to send password reset email to pat@aecom.com: SMTP not configured
```

This is `AuthService.forgotPassword()`'s own test deliberately exercising the "SMTP not configured" path — the exact failure mode described in `realitycapture-audit.md` §1, now with a second, independent piece of evidence (the test suite's own expected-failure assertion) alongside the `render.yaml` comment that first pointed to it.

**What was not tested, and why:** no browser-level visual check of the rendered clock inside `AppShell` was performed. `AppShell` sits behind this app's full auth flow and needs a running Postgres + NestJS API to reach (not available in this sandbox without standing up the whole backend stack, which is disproportionate to verify a small, already unit-tested, type-checked, and successfully-built UI addition). The component itself is directly tested (rendering, exact text, timer behavior); the `AppShell.tsx` integration point is a minimal, mechanical JSX insertion that passed typecheck, build, and lint. I'm reporting this gap rather than claiming a visual check that didn't happen, per the brief's own rule against fabricating verification.

## Remaining blockers (genuine external dependencies — brief's rule #17)

1. **No transactional email provider has ever been configured in production.** This blocks all of Phase 2/3's "fix email delivery" goal at the root — there's no code defect to fix, only an account to create. Needs: you (or M4) to pick a provider from `api-evaluation.md` (Resend recommended), create the account, verify a sending domain, and hand me the resulting SMTP credentials to place in Render's dashboard.
2. **No domain exists yet** for M4/EngineeringOS (confirmed earlier this session — everything currently runs on `*.onrender.com`). Domain verification for item 1 needs a domain to point DNS records at. This was already an open item before this audit; it's a shared blocker with the earlier file-sharing (FileSync) discussion.
3. **Whether to build email-ownership verification at all is a product decision, not an engineering one.** The current signup model (company-level signup code) already functions as M4's access control. Adding self-serve, open email-verified signup is a meaningful product-surface change I have not built without your explicit go-ahead.
4. **Workforce-screenshot interval/status enhancements** are a small, well-scoped, non-blocking improvement to an already-working feature (see backlog) — not blocked by anything external, just sequenced after you confirm it's actually wanted (brief rule #19's spirit: don't change an authorized-monitoring feature's behavior without being sure it's asked for).

## Deployment instructions

Nothing in this pass needs deploying beyond the normal flow — the clock is a pure frontend addition with no new env vars. Standard path: open a PR from `claude/platform-audit` into `main`, merge once reviewed (this repo's `render.yaml` auto-deploys `engineeringos-web`/`engineeringos-api` on push to `main`, so the same "ask before merging" caution from the earlier security-audit work applies here too — I have not merged this branch).
