# EngineeringOS — SaaS Commercial Readiness

**Phase 7: Continuous Improvement, AI Optimization & Product Growth**
Every item below distinguishes **implemented** (verified in code) from **proposed** (not built, needs approval). No billing/subscription/payment integration is implemented or recommended for implementation anywhere in this document without explicit approval, per this phase's constraints.

---

## 1. Onboarding: two real paths, with a gap between them

**Implemented — self-service company registration** (`TenancyController.register()`, `POST /company/register`, `@Public()`): creates a company, its `company_admin` user, and starts a 30-day trial (`register-company.dto.ts` + `tenancy.service.ts`). This is fully automated end-to-end at the API level — **but has no frontend form calling it** (confirmed: no frontend caller of `/company/register` found in `apps/web/src`). It is reachable today only via a direct API call, not through the product's own UI.

**Implemented — invite-by-signup-code:** an existing company's `super_admin` can view/regenerate a `signup_code` (`GET`/`POST /company/signup-code`, gated `@Roles('super_admin')`), which a new user enters to join that existing company. This path **is** reachable through the UI (confirmed via Phase 6's permission-matrix work), but it only adds a user to an *existing* company — it is not a new-company signup flow.

**Net finding:** there is no single, UI-reachable "sign up a brand-new company" flow today. The automated one exists but has no frontend; the UI-reachable one only grows an existing company. **This is a real gap for self-service SaaS growth** — closing it is a frontend-only change (a registration form calling the already-working `/company/register` endpoint), not a backend build, which makes it a comparatively cheap, high-leverage item for the roadmap.

## 2. Company settings: a working feature with no UI

`companies.settings` (JSONB) is **not** a dead write-only column as such — it is genuinely read by one feature: `RiskService.getRiskMatrixSettings()` reads `settings.riskMatrix.thresholds` to let a company customize its risk-scoring matrix (confirmed, `risk.service.ts:484-489`). The generic `PATCH /company/settings` endpoint (`@Roles('super_admin')`) can write any key into this JSONB column.

**The actual gap:** there is no frontend form anywhere that calls `PATCH /company/settings` (confirmed — no caller found in `apps/web/src`). The risk-matrix customization feature is real and wired end-to-end on the read side, but a company admin has no way to actually set it through the product — only via a direct, unauthenticated-by-the-UI API call. This is a "half-shipped" feature, not a dead one: the backend contract and its one real consumer both work; only the admin-facing settings UI was never built.

## 3. Confirmed dead schema: `custom_max_projects`/`custom_max_users`/`custom_feature_flags`

These three columns exist on `companies` (migration 001) specifically to let an operator grant a company custom limits/features outside its subscription plan's defaults. **Confirmed dead:** `SubscriptionService.checkLimit()` — the only place plan limits are enforced — queries `subscription_plans.max_projects`/`max_users`/`feature_flags` only; it never references any `custom_*` column on `companies` at all. No per-company override is possible today despite the schema existing for it.

**Recommendation:** either wire these columns into `checkLimit()`'s query (a small, contained change — add a `COALESCE(co.custom_max_projects, sp.max_projects)` pattern) if per-company overrides are a real near-term need, or remove the dead columns if not. **Not done in this pass** — this is a product decision (is per-company override actually needed yet?), not a safe default to assume either way.

## 4. Confirmed dead code path: storage limit enforcement

`checkLimit()`'s `resource: 'storage'` branch is fully implemented (checks `storage_used_bytes + additionalBytes` against `max_storage_bytes`) but **is never called with `'storage'` anywhere in the codebase** — confirmed by searching every call site of `checkLimit`. Only `'projects'` and `'users'` are actually invoked (from `projects.service.ts` and `users.service.ts` respectively, per the existing code comments). A company can exceed its plan's storage allotment indefinitely with no enforcement, despite the capability existing in code.

**Recommendation:** wire `checkLimit(companyId, 'storage', uploadSizeBytes)` into the capture/document/BIM upload paths, mirroring the existing project/user-limit call pattern exactly. This is a well-scoped, low-risk addition (the hard part — the check itself — is already written and presumably already tested in isolation); flagged for the roadmap as a real commercial-readiness gap, not implemented in this pass since it changes user-facing upload behavior (a company could suddenly start seeing storage-limit rejections) and deserves a heads-up before shipping, not a silent change.

## 5. No company deactivation or deletion path exists

**Confirmed, and worse than a cosmetic gap:** `companies.is_active` is a real column, enforced on login (`AuthService`: `'Account deactivated.'`/`'Your company account is inactive.'`) and by `TenancyGuard` (every tenant-scoped request checks `is_active = true`). But **no code path anywhere sets it to `false`** — confirmed by reading every `UPDATE companies` statement in the codebase (`tenancy.service.ts`'s `updateSettings`, `regenerateSignupCode`, `incrementStorage`, `decrementStorage` — none touch `is_active`). There is no admin endpoint, no internal tool, no script that deactivates a company.

**Commercial impact:** there is today no way to suspend a non-paying or offboarding company's access, short of a manual database edit. There is also no company *deletion* path at all (expected for a mature product to require careful handling — cascading deletes across every tenant-scoped table — but worth stating plainly: it does not exist even as a manual/admin-only tool).

**Recommendation:** a `PATCH /company/:id/deactivate`-style endpoint (platform-operator-only, not company-admin-accessible — a company should not be able to deactivate itself by accident) is a small, contained addition that closes a real operational gap. **Not implemented in this pass** — this is exactly the kind of "could lock real users out if done carelessly" change that should be reviewed before shipping, not added unilaterally.

## 6. No full-company data export

No dedicated "export everything this company owns" feature exists. Per-project/per-feature exports do exist and work (management report export, progress report export, Excel issue export, risk register export — all confirmed from prior phases' work), but there is no single mechanism for a company to get a complete export of their own data (relevant for GDPR-style data-portability requests, or for a company offboarding from the platform). **Proposed, not built** — flagged for the roadmap as a trust/compliance-relevant feature, not an urgent one absent any current customer request for it.

## 7. Customer support: Help Centre only

Confirmed: no support-ticketing integration, no live chat, no support email address surfaced in the product UI — the only customer-facing support surface is the static Help Centre (built in Phase 4). This is consistent with `PRODUCT_FEEDBACK_AND_GOVERNANCE.md`'s finding that no feedback/bug-report mechanism exists either — the two gaps compound: a stuck user today has no in-product way to report a problem or ask a question, only whatever support channel exists entirely outside the product (email, phone, etc. — not something code can confirm either way).

## 8. Billing/subscription/payment — explicitly not touched

`stripe` appears as a dependency in `apps/api/package.json`, but this phase did **not** investigate, change, or recommend changes to any billing/payment integration — per this phase's explicit constraint ("do NOT implement billing/subscription/payment integration without approval"), that entire surface is out of scope for this document. Nothing here should be read as a statement about whether Stripe integration is complete, partial, or absent — that would require a dedicated review this phase didn't do, and isn't needed for this document's commercial-readiness-gap findings above, which are all about limit/lifecycle management, not payment processing itself.

## 9. Summary: implemented vs. proposed

| Item | Status |
|---|---|
| Self-service company registration (backend) | **Implemented**, no frontend form |
| Signup-code invite-to-existing-company | **Implemented and UI-reachable** |
| Company settings (risk matrix) | **Implemented** (read side), no admin UI to write it |
| Per-company custom limits (`custom_max_*`) | **Dead schema** — not wired into enforcement |
| Storage quota enforcement | **Dead code path** — written, never called |
| Company deactivation | **Does not exist** |
| Company deletion | **Does not exist** |
| Full-company data export | **Does not exist** — proposed only |
| Customer support channel beyond Help Centre | **Does not exist** |
| Billing/payment review | **Out of scope for this document** |

No new recurring cost is introduced by this document — every gap above is either a confirmed absence (nothing to remove) or a proposal pending approval (nothing built).
