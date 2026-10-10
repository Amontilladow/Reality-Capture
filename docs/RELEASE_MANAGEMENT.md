# EngineeringOS — Release Management and Regression Prevention

**Phase 7: Continuous Improvement, AI Optimization & Product Growth**
Section 9 of this phase's brief. Describes the actual current pipeline, confirmed from `.github/workflows/` and `render.yaml`, then proposes the gaps — never recommending a release purely because the build succeeded.

---

## 1. Current pipeline — confirmed from the actual config

```
PR opened → ci.yml (install, typecheck, test, build, lint) → merge to main
                                                                    │
                                                                    ▼
                                          Render auto-deploys on push to main (render.yaml)
                                                                    │
                                                                    ▼
                                    post-deploy-health-check.yml (confirms the app is reachable)
```

Two workflows exist, confirmed by reading them directly:
- **`ci.yml`**: runs on every PR — install, typecheck, test, build, lint (the exact check run, "Install, typecheck, test, build, lint," is what gates every PR in this repo, confirmed live on PR #55 this phase).
- **`post-deploy-health-check.yml`**: the workflow's own comment states plainly — "Render auto-deploys on every push to main... with no staging environment and no deploy/smoke-test step in `ci.yml`" — so this workflow exists specifically to catch an immediately-broken deploy after the fact, not to gate it beforehand.

**This means: there is no staging environment and no pre-production smoke test today.** A merge to `main` goes straight to production, gated only by the PR's own CI (which runs against the test database/mocks, not a staging deploy of the real app) and the Claude Approvals review gate (confirmed from this session's own PR-babysitting rules).

## 2. What this already gets right

- **Automated checks are real and comprehensive**: 594 tests across 60 suites (confirmed this phase), typecheck, lint, and a production build all gate every PR — this is a genuinely solid regression-prevention floor, not a rubber-stamp CI.
- **Rollback is possible via the existing deployment infrastructure**: Render keeps prior deploys; `INCIDENT_AND_RECOVERY_RUNBOOK.md` (Phase 6) already documents the backup/restore procedure for data-layer issues. A code-level rollback (redeploying a prior commit) is a platform capability already available, just not a documented one-command procedure in this repo.
- **Claude Approvals gate (confirmed from this session's own operating rules) acts as a review gate** before merge — findings are addressed, not waived, before a PR is considered mergeable.

## 3. Confirmed gaps

- **No staging environment.** Every change's first real-world exposure is production. For a multi-tenant platform handling real company/project data, this is the single highest-value gap in this list.
- **No feature-flag system for staged rollout.** The only "feature flag" concept that exists (`subscription_plans.feature_flags`) gates features by paid tier, not by rollout percentage/cohort — there is no mechanism to ship a substantial new feature to a subset of users/companies before a full release, confirmed by searching for any staged-rollout or canary-flag pattern (none found).
- **No automated regression suite beyond unit/integration tests** — no E2E browser test suite was found (no Playwright/Cypress test files in this repo), so UI-level regressions (a button that silently stops working, a form that submits the wrong field) are caught only by manual testing or by users after deploy.
- **No documented rollback procedure specific to a bad code deploy** (as distinct from the already-documented data-restore procedure) — "redeploy the prior commit" works on Render's platform but isn't written down as a runbook step anywhere in this repo.

## 4. Proposed process (not built — process and tooling recommendations only)

1. **Dev → review → automated checks** — already real, keep as-is.
2. **Regression testing** — already real (594 tests); recommend simply keeping this bar as the codebase grows, not lowering it under time pressure.
3. **Staging validation** — **proposed, not built.** The cheapest version of this (and the one recommended first) is a second Render environment running the same `render.yaml` config against a separate database, with deploys gated behind a manual promotion step rather than auto-deploying straight from `main`. This has a real, non-zero infrastructure cost (a second running instance + database) — **flagged for your approval as a new recurring cost**, not assumed.
4. **Approval** — already real (Claude Approvals + human review via the PR process).
5. **Deployment monitoring** — partially real (the post-deploy health check); see `MONITORING_AND_INCIDENT_MANAGEMENT.md` for the broader gap (no alerting beyond that one-shot check).
6. **Rollback** — platform-capable, not documented as a procedure. **Recommendation (safe, zero-cost): write down the "redeploy the previous commit on Render" steps as a short addition to `INCIDENT_AND_RECOVERY_RUNBOOK.md`** — this is a documentation-only task, not a feature to build, and is the cheapest item in this whole list.
7. **Release notes** — proposed in `PRODUCT_FEEDBACK_AND_GOVERNANCE.md` §7 (reusing Help Centre infrastructure) — not duplicated here.
8. **Post-release verification** — currently just the health check; a slightly richer version (checking a few key user-facing flows, not just "is the server up") is a reasonable low-cost follow-on, not built in this pass.

## 5. Feature flags for substantial features — recommendation

For any future *substantial* new feature (the brief's own term) — something that changes a core workflow, not a small UI tweak — a simple, self-hosted feature-flag approach (a boolean column per company, or an env-var-driven flag checked at the service layer) is sufficient and avoids a new paid service. This is proposed as a convention to adopt for the next substantial feature this platform ships, not a system to build speculatively ahead of having a feature that needs it.

## 6. Explicit statement per this phase's constraint

**A green CI run and a successful build are not, by themselves, sufficient reasons to release** — per this document's own framing, "automated checks passed" is step 2 of a multi-step process, not the whole process. The gaps in §3 (no staging, no feature flags, no E2E suite) mean that today, a change that passes every automated check can still break a real user-facing flow in production, discovered only after the fact. Closing the staging-environment gap (§4.3) is the single highest-leverage next step to change that, and is the first item recommended in the Phase 7 roadmap's P1 tier.
