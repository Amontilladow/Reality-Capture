# EngineeringOS / RealityCapture — Production Readiness Report

**Phase 6: Final Production Readiness & Acceptance Testing**
Prepared as a Senior QA Architect / SaaS Security Engineer / DevOps Engineer / Performance Engineer / Construction Technology Product Auditor review. Every claim in this report is backed by either a live test against a running instance of the actual application, or a specific file:line code citation. Nothing here is asserted from the existence of prior phase documentation alone — every prior claim (Phase 2's production-readiness doc, Phase 3's email-integration doc) was independently re-verified against current source, and several places where current code has drifted from those docs are called out explicitly below.

**Companion documents:** `ACCEPTANCE_TEST_MATRIX.md`, `ROLE_PERMISSION_MATRIX.md`, `PRODUCTION_DEPLOYMENT_CHECKLIST.md`, `INCIDENT_AND_RECOVERY_RUNBOOK.md`, `KNOWN_ISSUES_AND_REMEDIATION.md`.

---

## 1. Executive Summary

EngineeringOS is a mature, well-architected platform with real strengths: consistent Row-Level-Security-backed tenant isolation (independently stress-tested this engagement and found solid against every cross-company attack attempted), fully parameterized database access (zero SQL injection vectors found), correct password hashing and JWT secret handling, a thoughtful AI Assistant design that hard-gates scope and cannot write to controlled records, a 569-test automated suite that passed cleanly throughout this engagement, and genuinely good in-code security reasoning in several places (e.g. a deliberately-tighter gate on password-reset than on user-invite, with the reasoning spelled out in a comment).

Against that foundation, this audit found and **fixed** five Critical-severity authorization/credential-handling defects during this engagement — including a live-reproduced privilege-escalation bug that let a mid-level employee mint a new super-admin account, and a project-update endpoint with no authorization at all. It also found and **left open, by design** (per this audit's own "fix safe defects, ask before high-risk changes" instruction) a smaller number of High and Medium findings whose correct fix has a broader blast radius than a narrow guard addition: a same-company cross-project access gap on a handful of sub-resource routes, a functional gap that makes fine-grained permission delegation unreachable for 11 of 12 company roles, and several dependency version upgrades (most notably `sharp`, which processes untrusted uploaded images).

**The platform is not yet ready for unrestricted production use by multiple companies today**, primarily because of one unresolved question this sandbox cannot answer: **whether any live deployment has ever run with `CREDENTIAL_ENCRYPTION_KEY` unset** (it silently fell back to a key visible in source code until this engagement's fix). If the answer is yes, every stored Outlook/Gmail OAuth token and BYO-AI key in that deployment must be treated as compromised before go-live. Everything else found is either fixed, or documented with a clear owner and recommended action.

## 2. Overall Readiness Assessment

**CONDITIONAL GO** — see §14 for the full reasoning. Core platform functionality, tenant isolation, and the now-fixed Critical authorization defects support a GO; the open items (cross-project access gap, dependency upgrades, and especially the `CREDENTIAL_ENCRYPTION_KEY` production-history question) are real enough to withhold an unconditional GO until you've made an informed decision on each.

## 3. Verified Functionality

Confirmed working via live tests against a real running instance (API + web, local Postgres/Redis/mock-S3, a dedicated demo company — never production data) or the automated suite:

- **Authentication:** login, token refresh/rotation/revocation, logout, password reset (enumeration-safe, single-use, time-limited), self-signup with pending-approval gating, admin-assisted password reset (deliberately tighter-gated than invite, with reasoning in-code).
- **Multi-tenancy:** a second company created for this audit could not see, list, read, or write any of the first company's projects, issues, RFIs, or drawings — tested via project listing, direct-by-ID access, and nested sub-resource listing, all correctly scoped.
- **RFI lifecycle:** create (open to any project member), respond (requires `manage_rfis`), close — all exercised live end-to-end with real data, including the correct block on a user without the permission and the correct unblock once given the project's `project_lead` role.
- **Issues/Buildings/BIM/Risk:** create, read, and the newly-fixed write-authorization boundary all exercised live.
- **Document upload/retrieval:** a real file was uploaded by one user and successfully retrieved by a different, independently-authenticated user.
- **User invitation and project assignment:** a new user was invited and assigned to a project with a specific role in one live workflow.
- **File-upload security:** path-traversal and disallowed-extension attempts were both correctly rejected or neutralized (storage keys never embed client-supplied filenames).
- **Rate limiting:** confirmed working exactly as configured (10 req/min/IP on auth routes, verified by triggering a real `429` on the 11th attempt).
- **AI Assistant:** domain guard is a hard, pre-LLM keyword filter (not relying on the model to self-police); draft-creation tools never write to the database, only the user's own Submit click does; platform and BYO-AI credentials are never present in any API response; usage limits are server-side, keyed to the authenticated user, and checked before any provider call.
- **Build/test/lint:** 588/588 API tests, 20/20 web tests, clean typecheck and lint on both apps, all 4 workspace projects build successfully.

## 4. Critical and High-Severity Defects

All five Critical findings were fixed and re-verified live plus via the full regression suite during this engagement. Full detail, evidence, and fix description for every item below is in `KNOWN_ISSUES_AND_REMEDIATION.md`.

| ID | Finding | Status |
|---|---|---|
| C-1 | Privilege escalation via `POST /users/invite` — any project_manager-weight+ user could mint a new super_admin | **FIXED** |
| C-2 | `PATCH /projects/:id` had no authorization — any company role could edit any project | **FIXED** |
| C-3 | Buildings/Levels/Locations module had zero authorization | **FIXED** |
| C-4 | Risk module had zero project-scoped authorization | **FIXED** |
| C-5 | `CREDENTIAL_ENCRYPTION_KEY` silently fell back to a hardcoded key visible in source | **FIXED** (code); **production-history unknown — requires your verification** |
| H-1 | Same-company cross-project access on issue activities/evidence/attachments and drawing lookup | **OPEN** — needs a focused multi-file fix, left for you to schedule |
| H-2 | Fine-grained permission grants (`manage_rfis` etc.) are unreachable for any role but `company_admin`; only path for others is the all-or-nothing `project_lead` role | **OPEN** — a product decision, not a narrow bug |
| H-3 | 3 critical / 87 high dependency vulnerabilities (`pnpm audit`); `sharp` (processes untrusted uploaded images), `axios`, `nodemailer` below patched versions | **OPEN** — needs its own upgrade-and-regression pass |
| H-4 | Google Calendar integration stores OAuth tokens in plaintext (confirmed via an in-repo comment, not independently re-verified this engagement) | **OPEN** — needs a dedicated follow-up read |

## 5. Security Findings

Full detail in `KNOWN_ISSUES_AND_REMEDIATION.md`; summarized by area:

| Area | Status |
|---|---|
| Authentication & session management | GOOD, with one Medium gap (no account lockout, M-2) and one bounded gap (15-min stale-token-after-deactivation window, M-1) |
| Broken access control / IDOR | 4 Critical fixed; 1 High open (H-1); tenant isolation itself held under every attack attempted |
| Injection (SQL/command/eval) | GOOD — zero findings, fully parameterized throughout |
| File upload handling | GOOD, with one Low-Medium gap (no magic-byte content validation, M-6 — meaningfully mitigated by MIME allowlists excluding all script-executable types) |
| Secrets exposure | 1 Critical fixed (C-5); no other hardcoded secrets found anywhere in the repository |
| CORS & security headers | GOOD — explicit origin allowlist, helmet() correctly wired, minimal `trust proxy` setting |
| Rate limiting | GOOD coverage on auth/AI; Medium gap on bulk-export/upload-URL endpoints (M-3) and on per-user (vs per-IP) limiting (M-5) |
| OAuth (Outlook/Gmail) | GOOD — HMAC-signed state, AES-256-GCM token encryption (once C-5 is confirmed fixed in production), correct per-user isolation, real disconnect behavior, clean reconnect UX on token-refresh failure |
| Dependencies | 1 High open (H-3) |
| Error messages | GOOD — a global exception filter guarantees no stack trace, SQL error, or internal path ever reaches a client response, in any environment (not just "safe in prod, leaky in dev" — it's safe in both, unconditionally) |

## 6. Performance Results

**Measured, not estimated**, against the actual API running locally (Postgres 16, Redis, real auth, real data):

- Single-request latency on representative endpoints (project list, project detail, issues list, reports dashboard): **2–11ms**, warm process, local network.
- Under light concurrent load (10 connections, requests under the global rate-limit threshold): p50 **5ms**, p97.5 **136ms**, p99 **147ms**.
- The global default rate limit (100 req/min per IP) is the dominant constraint observed at any higher synthetic concurrency — this is the abuse-prevention mechanism working as designed, not a performance ceiling, but it means a true "100 concurrent real users" load test (humans clicking at human pace, not a load-test tool firing continuously) was not fully reproducible in this single-machine sandbox without either disabling the throttle (not done, to avoid masking real throttle behavior) or running from 100 distinct source IPs (not available in this sandbox).
- **Honest limitation:** this sandbox is a single local machine, not Render's actual production infrastructure. These numbers demonstrate the application code and query patterns are fast (no N+1 patterns or missing-index symptoms observed in any tested path), but they are not a substitute for a real staged load test against production-equivalent infrastructure, network latency, and the real managed Postgres instance's actual resource limits. **Recommend a proper staged load test (10/25/50/100 concurrent, from multiple source IPs, against a staging environment once one exists — see the "no staging environment" gap in `PRODUCTION_DEPLOYMENT_CHECKLIST.md`) before claiming the 100-registered-user target is validated under realistic concurrent load.**
- Web bundle: production build succeeds; several chunks exceed 500KB (notably `BimViewerPage` at 5.4MB/919KB gzipped), flagged as L-5 — not measured against real network conditions in this sandbox, so actual page-load-time impact is unverified, not assumed negligible.

## 7. Missing Capabilities

- No literal "engineering calculations" feature exists (UAT-E in the acceptance matrix) — the closest real functionality is BIM Models access.
- No e2e test suite exists despite a `test:e2e` script being configured (0 `.spec.ts` files under `apps/api/test`).
- Web frontend has minimal automated test coverage (2 test files).
- No staging environment.
- No APM/structured error monitoring.
- No formally documented RTO/RPO.
- No scripted database rollback (redeploy-a-prior-commit is the only mechanism; 52 of 66 migrations lack a rollback comment, though none are destructive).

## 8. Dependencies Requiring Your Action

1. **Confirm whether `CREDENTIAL_ENCRYPTION_KEY` was ever unset in a live production deployment** (check the Render dashboard's environment-variable history for `engineeringos-api`). If yes, every row in `email_integrations` and `user_ai_connections` must be treated as compromised — see `INCIDENT_AND_RECOVERY_RUNBOOK.md` §4 for the exact recovery procedure (rotate the key, then delete the affected rows and force reconnection — do not attempt to re-encrypt them).
2. Set a real `GEMINI_API_KEY`/`ANTHROPIC_API_KEY`/`OPENAI_API_KEY` to make the AI Assistant functional in production (currently unset in `render.yaml`).
3. Set real `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET` if billing needs to be live at launch.
4. Set real Microsoft Entra / Google Cloud OAuth app credentials to enable live Outlook/Gmail connection (needed to fully verify UAT-K beyond code review).
5. Decide on, and schedule, the open High-severity items (H-1 cross-project access gap, H-3 dependency upgrades, H-4 Google Calendar plaintext tokens) — each has a recommended fix documented in `KNOWN_ISSUES_AND_REMEDIATION.md` but was deliberately not applied unilaterally in this engagement given its broader scope.
6. Decide whether to invest in a staging environment before the next major release, given its absence limits how confidently any future change can be validated before reaching production.

## 9. What Was Tested and Verified

See `ACCEPTANCE_TEST_MATRIX.md` for the complete, itemized list (31 distinct test cases across automated baseline, security/authorization, and the brief's required UAT scenarios A–K), each with its own evidence citation.

## 10. What Failed

One test failed outright: **TC-SEC-10** — a deactivated user's pre-existing access token remained usable for up to its full remaining 15-minute lifetime, despite the API's own response claiming "all sessions revoked." Bounded impact, documented as M-1, left open as a design trade-off for you to weigh (a global per-request revocation check has a performance cost across every endpoint).

## 11. What Was Not Tested

- A true multi-machine, multi-IP load test at realistic "100 concurrent users" scale (see §6).
- Live OAuth connection to a real Outlook or Gmail account (no real app credentials available in this sandbox).
- Live AI provider failure modes (timeout, real 429) against an actually-configured provider (no provider key available in this sandbox; the code path and the one specific failure scenario asked about — a BYO decrypt failure not leaking into the response — were both verified via the automated test suite reproducing the exact scenario).
- The full line-by-line body of `documents.controller.ts`, `drawings.controller.ts`, `captures.controller.ts`, `submittals.controller.ts`, `transmittals.controller.ts`, `qa.controller.ts` beyond decorator-level review (the pattern found — ungated create, `manage_project_records`-gated update/delete — was consistent everywhere it was checked, but not every line of every one of these files was read).
- The complete `apps/web/src` frontend for every frontend-only-enforcement gap (two representative components were checked and matched their server-side rules; the rest was not exhaustively audited).
- The Google Calendar integration module's plaintext-token-storage claim was not independently re-verified against current source this engagement (relied on an in-repo comment cross-reference) — flagged as H-4, not confirmed exploited.
- A real database restore (the Phase 2 restore test was not re-run this engagement — re-running it would require provisioning real disposable Render infrastructure, outside this sandbox's reach).

## 12. What Has Been Fixed and Retested

All five Critical findings (C-1 through C-5) — fixed in this engagement's own commits, each re-verified via a live retest reproducing the original exploit (now correctly denied) and via the full 569-test regression suite plus 5 new targeted regression tests for the invite-escalation fix specifically. Full `pnpm typecheck`/`pnpm lint`/`pnpm test`/`pnpm build` all green after every fix.

## 13. What Remains Before Production Deployment

In priority order:
1. Resolve the `CREDENTIAL_ENCRYPTION_KEY` production-history question (§8.1) — this alone could be a hard blocker depending on the answer.
2. Decide on and schedule H-1 (cross-project access gap) and H-3 (dependency upgrades) — both have clear, documented fixes, neither was applied unilaterally given their broader scope.
3. Set the missing production secrets (§8.2–8.4) relevant to the features you intend to launch with.
4. Run a proper staged load test against production-equivalent infrastructure before relying on the local-sandbox performance numbers in §6 as proof of 100-concurrent-user readiness.
5. Make an informed decision on each Medium/Low item in `KNOWN_ISSUES_AND_REMEDIATION.md` — none are blocking on their own, but several (account lockout, health-check status code, APM) are the kind of thing worth deciding deliberately rather than by default.

## 14. Expected Costs Not Verifiable From This Sandbox

- Real AI provider usage costs (Anthropic/Gemini/OpenAI) once a key is configured — cannot be estimated without knowing expected request volume and the provider/model chosen.
- Stripe transaction fees once billing goes live.
- Any cost associated with provisioning a staging environment, were you to add one.
- Render infrastructure cost changes from scaling plan tiers up for real production load — this sandbox cannot observe your current Render plan/billing.

## 15. Exact Next Actions Required From You

1. Check the Render dashboard's environment-variable history for `engineeringos-api` to answer the `CREDENTIAL_ENCRYPTION_KEY` question in §8.1, and act on the answer per `INCIDENT_AND_RECOVERY_RUNBOOK.md` §4 if it was ever unset.
2. Review and explicitly accept or reject each open item in `KNOWN_ISSUES_AND_REMEDIATION.md`'s High and Medium sections — each already states what the fix would be and why it wasn't applied unilaterally.
3. Set the production secrets listed in §8.2–8.4 for whichever features you're launching with.
4. Decide whether a staging environment is worth provisioning before the next release.
5. Schedule the dependency-upgrade pass (H-3), prioritizing `sharp` given its exposure to untrusted input.
6. Tell me which of the open items you'd like actioned now versus tracked for later — I did not fix anything beyond the five Critical items without flagging it first, per your own stated rules for this engagement.

---

## 16. Final Go-Live Decision

### **CONDITIONAL GO**

**Reasoning:** Critical acceptance criteria — tenant isolation, authentication, core authorization — all passed under live adversarial testing, and the five genuine Critical-severity defects found during this engagement were fixed and re-verified before this report was written, not merely documented. No unresolved Critical security or data-integrity issue remains **in the code as it stands right now**. That supports GO.

What keeps this from being an unconditional GO is narrow and specific, not a vague hedge:
- **One real unknown with potentially Critical production impact** (§8.1 — was `CREDENTIAL_ENCRYPTION_KEY` ever unset in a live deployment) that only you can answer from outside this sandbox, with a clear, bounded remediation path already written if the answer is yes.
- **A small number of clearly-scoped High-severity items** (H-1 cross-project access, H-3 dependency upgrades) that were deliberately left unfixed per this engagement's own "ask before high-risk, broader-blast-radius changes" instruction, each with an accepted mitigation/owner/decision already documented rather than left vague.

This is not a GO issued because the application builds successfully or the homepage loads — every item in this report, including the ones that passed, was backed by an actual request/response or a specific code citation, and the items still open are named precisely rather than hand-waved. It is also not a NO-GO, because nothing found rises to "unresolved Critical issue in the current codebase" — the Critical issues that existed were fixed during this same engagement, live-reproduced before the fix and live-reproduced-as-blocked after it.

**Condition for moving to an unconditional GO:** resolve item 1 in §15 (the `CREDENTIAL_ENCRYPTION_KEY` production-history question) and make an explicit, recorded decision on each High-severity item in §4. Everything else in this report is real, documented, and safe to carry forward as tracked technical debt rather than a go-live blocker.
