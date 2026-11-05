# EngineeringOS: Release Management and Regression Prevention

**Phase 7: Continuous Improvement, AI Optimization & Product Growth**
Section 9 of this phase's brief. Describes the current pipeline as confirmed from `.github/workflows/` and `render.yaml`, then proposes how to close its gaps. It never recommends a release just because the build succeeded.

---

## 1. Current pipeline: confirmed from the actual config

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
- **`ci.yml`**: runs install, typecheck, test, build and lint on every PR. That check ("Install, typecheck, test, build, lint") gates every PR in this repo, confirmed live on PR #55 this phase.
- **`post-deploy-health-check.yml`**: the workflow's own comment says "Render auto-deploys on every push to main... with no staging environment and no deploy/smoke-test step in `ci.yml`". The workflow exists to catch a broken deploy after the fact, not to gate it beforehand.

**This means: there is no staging environment and no pre-production smoke test today.** A merge to `main` goes straight to production, gated only by the PR's own CI (which runs against the test database/mocks, not a staging deploy of the real app) and the Claude Approvals review gate (confirmed from this session's own PR-babysitting rules).

## 2. What this already gets right

- **Automated checks are real**: 594 tests across 60 suites (confirmed this phase), plus typecheck, lint, and a production build, gate every PR. That is a solid floor for catching regressions.
- **Rollback is possible via the existing deployment infrastructure**: Render keeps prior deploys; `INCIDENT_AND_RECOVERY_RUNBOOK.md` (Phase 6) already documents the backup/restore procedure for data-layer issues. A code-level rollback (redeploying a prior commit) is a platform capability already available, just not a documented one-command procedure in this repo.
- **A Claude Approvals gate (confirmed from this session's own operating rules) reviews each PR before merge.** Findings are addressed, not waived, before a PR counts as mergeable.

## 3. Confirmed gaps

- **No staging environment.** Every change's first real-world exposure is production. For a multi-tenant platform handling real company/project data, this is the single highest-value gap in this list.
- **No feature-flag system for staged rollout.** The only "feature flag" concept (`subscription_plans.feature_flags`) gates features by paid tier, not by rollout percentage or cohort. A search for any staged-rollout or canary-flag pattern found none, so there is no way to ship a substantial new feature to a subset of users/companies before a full release.
- **No automated regression suite beyond unit/integration tests.** There is no E2E browser suite (no Playwright/Cypress test files in this repo), so UI-level regressions (a button that silently stops working, a form that submits the wrong field) are caught only by manual testing or by users after deploy.
- **No documented rollback procedure for a bad code deploy** (as distinct from the already-documented data-restore procedure). "Redeploy the prior commit" works on Render but isn't written down as a runbook step anywhere in this repo.

## 4. Proposed process (not built: process and tooling recommendations only)

1. **Dev → review → automated checks**: already in place; keep as-is.
2. **Regression testing**: already in place (594 tests). Keep this bar as the codebase grows and don't lower it under time pressure.
3. **Staging validation**: **proposed, not built.** The cheapest version, and the one to do first, is a second Render environment running the same `render.yaml` config against a separate database, with deploys gated behind a manual promotion step instead of auto-deploying from `main`. It has a real infrastructure cost (a second running instance + database), **so it needs your approval as a new recurring cost**.
4. **Approval**: already in place (Claude Approvals + human review via the PR process).
5. **Deployment monitoring**: partly in place (the post-deploy health check). See `MONITORING_AND_INCIDENT_MANAGEMENT.md` for the broader gap (no alerting beyond that one-shot check).
6. **Rollback**: the platform supports it, but there is no written procedure. **Recommendation (safe, zero cost): add the "redeploy the previous commit on Render" steps to `INCIDENT_AND_RECOVERY_RUNBOOK.md`.** It is a documentation task, not a feature, and the cheapest item on this list.
7. **Release notes**: proposed in `PRODUCT_FEEDBACK_AND_GOVERNANCE.md` §7 (reusing Help Centre infrastructure); not repeated here.
8. **Post-release verification**: currently just the health check. A slightly richer version that checks a few key user-facing flows, not just whether the server is up, is a reasonable low-cost follow-on. Not built in this pass.

## 5. Feature flags for substantial features: recommendation

For any future *substantial* new feature (the brief's term), meaning one that changes a core workflow rather than a small UI tweak, a simple self-hosted feature flag is enough and avoids a new paid service: a boolean column per company, or an env-var flag checked at the service layer. This is proposed as a convention for the next substantial feature, not a system to build ahead of a feature that needs it.

## 6. Explicit statement per this phase's constraint

**A green CI run and a successful build are not, on their own, reasons to release.** "Automated checks passed" is step 2 of the process above, not the whole process. Because of the gaps in §3 (no staging, no feature flags, no E2E suite), a change that passes every automated check can still break a real user-facing flow in production, and nobody finds out until afterwards. Closing the staging gap (§4.3) would do the most to change that, and it is the first item in the Phase 7 roadmap's P1 tier.
