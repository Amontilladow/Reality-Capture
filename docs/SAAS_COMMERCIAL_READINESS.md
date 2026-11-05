# EngineeringOS: SaaS Commercial Readiness

**Phase 7: Continuous Improvement, AI Optimization & Product Growth**
Every item below distinguishes **implemented** (verified in code) from **proposed** (not built, needs approval). No billing/subscription/payment integration is implemented or recommended for implementation anywhere in this document without explicit approval, per this phase's constraints.

---

## 1. Onboarding: two real paths, with a gap between them

**Implemented: self-service company registration** (`TenancyController.register()`, `POST /company/register`, `@Public()`). It creates a company and its `company_admin` user and starts a 30-day trial (`register-company.dto.ts` + `tenancy.service.ts`). This is fully automated at the API level, **but no frontend form calls it** (confirmed: no frontend caller of `/company/register` in `apps/web/src`). Today it is reachable only by a direct API call, not through the product's own UI.

**Implemented: invite by signup code.** An existing company's `super_admin` can view/regenerate a `signup_code` (`GET`/`POST /company/signup-code`, gated `@Roles('super_admin')`), which a new user enters to join that company. This path **is** reachable through the UI (confirmed during Phase 6's permission-matrix work), but it only adds a user to an *existing* company. It is not a new-company signup flow.

**Net finding:** there is no UI-reachable "sign up a brand-new company" flow today. The automated flow has no frontend, and the UI-reachable one only grows an existing company. **This is a real gap for self-service SaaS growth.** Closing it is a frontend-only change (a registration form calling the working `/company/register` endpoint), not a backend build, so it is cheap relative to its value and belongs on the roadmap.

## 2. Company settings: a working feature with no UI

`companies.settings` (JSONB) is **not** a dead write-only column. One feature reads it: `RiskService.getRiskMatrixSettings()` reads `settings.riskMatrix.thresholds` so a company can customize its risk-scoring matrix (confirmed, `risk.service.ts:484-489`). The generic `PATCH /company/settings` endpoint (`@Roles('super_admin')`) can write any key into this column.

**The actual gap:** no frontend form calls `PATCH /company/settings` (confirmed: no caller in `apps/web/src`). Risk-matrix customization works end to end on the read side, but a company admin can only set it through a direct API call, not through the product. The feature is half-shipped rather than dead: the backend contract and its one consumer both work, and only the admin settings UI was never built.

## 3. Confirmed dead schema: `custom_max_projects`/`custom_max_users`/`custom_feature_flags`

These three columns exist on `companies` (migration 001) so an operator can grant a company custom limits/features outside its subscription plan's defaults. **Confirmed dead:** `SubscriptionService.checkLimit()`, the only place plan limits are enforced, queries `subscription_plans.max_projects`/`max_users`/`feature_flags` and never references any `custom_*` column on `companies`. No per-company override is possible today even though the schema exists for it.

**Recommendation:** if per-company overrides are a real near-term need, wire these columns into `checkLimit()`'s query (a small change using a `COALESCE(co.custom_max_projects, sp.max_projects)` pattern). If not, remove the dead columns. **Not done in this pass**, because whether per-company overrides are needed yet is a product decision, not a default to assume either way.

## 4. Confirmed dead code path: storage limit enforcement

`checkLimit()`'s `resource: 'storage'` branch is fully implemented (it checks `storage_used_bytes + additionalBytes` against `max_storage_bytes`) but **nothing in the codebase ever calls it with `'storage'`**, confirmed by checking every call site of `checkLimit`. Only `'projects'` and `'users'` are invoked (from `projects.service.ts` and `users.service.ts` respectively, per the existing code comments). A company can exceed its plan's storage allotment indefinitely even though the check exists in code.

**Recommendation:** call `checkLimit(companyId, 'storage', uploadSizeBytes)` from the capture/document/BIM upload paths, following the existing project/user-limit call pattern. This is a well-scoped, low-risk addition, since the check itself is already written and presumably tested in isolation. It is on the roadmap as a commercial-readiness gap but not implemented in this pass: it changes user-facing upload behavior (a company could suddenly start seeing storage-limit rejections), so customers should get notice before it ships.

## 5. No company deactivation or deletion path exists

**Confirmed, and more than cosmetic:** `companies.is_active` is a real column, enforced on login (`AuthService`: `'Account deactivated.'`/`'Your company account is inactive.'`) and by `TenancyGuard` (every tenant-scoped request checks `is_active = true`). But **no code path sets it to `false`**, confirmed by reading every `UPDATE companies` statement in the codebase (`tenancy.service.ts`'s `updateSettings`, `regenerateSignupCode`, `incrementStorage`, `decrementStorage`; none touch `is_active`). No admin endpoint, internal tool or script deactivates a company.

**Commercial impact:** today there is no way to suspend a non-paying or offboarding company's access short of a manual database edit. There is also no company *deletion* path at all. A mature product would need careful handling here (cascading deletes across every tenant-scoped table), but to be plain about it: deletion does not exist even as a manual or admin-only tool.

**Recommendation:** add a `PATCH /company/:id/deactivate`-style endpoint, available to the platform operator only and not to company admins (a company should not be able to deactivate itself by accident). It is a small addition that closes a real operational gap. **Not implemented in this pass**: a change that could lock real users out if done carelessly should be reviewed before it ships.

## 6. No full-company data export

No dedicated "export everything this company owns" feature exists. Per-project and per-feature exports do exist and work (management report export, progress report export, Excel issue export, risk register export, all confirmed in prior phases), but a company has no single way to export all of its own data, which matters for GDPR-style data-portability requests or for a company leaving the platform. **Proposed, not built.** It is on the roadmap as a trust/compliance feature, but not an urgent one while no customer has asked for it.

## 7. Customer support: Help Centre only

Confirmed: no support-ticketing integration, no live chat, and no support email address in the product UI. The only customer-facing support surface is the static Help Centre (built in Phase 4). `PRODUCT_FEEDBACK_AND_GOVERNANCE.md` found that no feedback/bug-report mechanism exists either, and the two gaps compound: a stuck user today has no in-product way to report a problem or ask a question. Any support channel (email, phone, etc.) exists entirely outside the product, and the code can't confirm whether one does.

## 8. Billing/subscription/payment: explicitly not touched

`stripe` appears as a dependency in `apps/api/package.json`, but this phase did **not** investigate, change, or recommend changes to any billing/payment integration. This phase's brief says "do NOT implement billing/subscription/payment integration without approval", so that whole surface is out of scope here. Nothing in this document says whether the Stripe integration is complete, partial, or absent; that would need a dedicated review. The commercial-readiness gaps above are all about limit and lifecycle management, not payment processing.

## 9. Summary: implemented vs. proposed

| Item | Status |
|---|---|
| Self-service company registration (backend) | **Implemented**, no frontend form |
| Signup-code invite-to-existing-company | **Implemented and UI-reachable** |
| Company settings (risk matrix) | **Implemented** (read side), no admin UI to write it |
| Per-company custom limits (`custom_max_*`) | **Dead schema**: not wired into enforcement |
| Storage quota enforcement | **Dead code path**: written, never called |
| Company deactivation | **Does not exist** |
| Company deletion | **Does not exist** |
| Full-company data export | **Does not exist**: proposed only |
| Customer support channel beyond Help Centre | **Does not exist** |
| Billing/payment review | **Out of scope for this document** |

No new recurring cost is introduced by this document. Every gap above is either a confirmed absence (nothing to remove) or a proposal pending approval (nothing built).
