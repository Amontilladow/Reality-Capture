# EngineeringOS — Role & Permission Matrix

**Phase 6: Final Production Readiness & Acceptance Testing**
Generated from direct code review of `apps/api/src/common/{authorization,guards,decorators}`, `packages/types/src/user.types.ts`, and all 42 controllers under `apps/api/src/modules/**`, cross-checked with live requests against a running instance. Every claim below is grounded in a specific file:line citation or a live HTTP test — none is inferred from documentation or UI behavior alone.

---

## 1. How authorization actually works (ground truth)

Global guard chain, in request order (`apps/api/src/app.module.ts:149-160`):

```
ThrottlerGuard → JwtAuthGuard → PendingApprovalGuard → TenancyGuard → RolesGuard → ProjectPermissionGuard → SiteRoleRestrictionGuard
```

- **RolesGuard** (`apps/api/src/common/guards/roles.guard.ts:10-32`): a route with no `@Roles()` is open to **any authenticated user**. A route with `@Roles(a, b, c)` admits any company role whose `COMPANY_ROLE_WEIGHT` is **≥ the minimum weight among the listed roles** — not an exact-match list. A role not literally named in the decorator can still pass if its weight exceeds the lowest named role's weight. This is a load-bearing design fact: several decorators silently admit more roles than they appear to.
- **COMPANY_ROLE_WEIGHT** (`packages/types/src/user.types.ts:51-70`):

  | Role | Weight |
  |---|---|
  | super_admin | 100 |
  | company_admin | 90 |
  | technical_director | 80 |
  | engineering_manager | 70 |
  | bim_manager | 65 |
  | project_manager | 60 |
  | construction_manager | 55 |
  | qa_qc_manager | 50 |
  | commercial_manager | 45 |
  | project_engineer | 35 |
  | consultant | 30 |
  | client_representative | 20 |

  Note `project_engineer` (35) sits above `consultant`/`client_representative` despite being a site-restricted role.
- **ProjectPermissionGuard + ProjectAuthorizationService** (`project-authorization.service.ts:22-43`): for `@RequireProjectPermission(...)` routes, access requires ONE of: (a) `companyRole === 'super_admin'` (always bypasses), (b) the caller is that project's `project_lead` (a **project role**, not a company role — bypasses with no grant needed), or (c) an explicit row in `project_permission_grants` for that exact permission. **A high company role on its own — even `company_admin` — grants nothing at the project level.** Grants can only be created by `super_admin` (`projects.controller.ts:159-160`).
- **CRITICAL CORRECTION, live-verified during this audit's UAT pass:** `ProjectsService.grantPermission()` (`projects.service.ts:385-397`) additionally requires the **target user's company role to literally be `company_admin`** — `if (target.companyRole !== 'company_admin') throw new BadRequestException('Permission grants can only be given to a company_admin.')`. This means the `(c)` path above is only reachable for `company_admin` users. **No other company role — project_manager, bim_manager, technical_director, qa_qc_manager, consultant, client_representative, construction_manager, project_engineer, commercial_manager, engineering_manager — can ever receive a `manage_team`/`manage_issues`/`manage_project_records`/`manage_rfis`/`approve_rfis`/`verify_snag_items` grant.** Confirmed live: granting `manage_rfis` to a `consultant` returned `400 BAD_REQUEST` with exactly that message. Their only path to any of these six permissions on a given project is being made that project's `project_lead` — which bundles **all six** permissions as a single bloc; there is no way to hand a non-company_admin user just one of the six. This is a significant, previously-undocumented gap between the platform's apparent fine-grained permission model (six distinct permissions) and what is actually usable: in practice, narrow delegation to anyone who isn't `company_admin` does not exist — it's "all six or none." Every "Grant/Lead only" cell in the matrix below should be read with this caveat: for every role except `company_admin`, "Grant" is unreachable and only "Lead" (all-or-nothing) is real.
- **SiteRoleRestrictionGuard**: applies only to write methods. Blocks `construction_manager`/`project_engineer` (company roles) and `site_engineer` (project role) from any write outside `/projects/:projectId/(issues|snag-items|drawings)/...`. Adds restriction only — never a bypass.
- **PendingApprovalGuard**: a self-signed-up user with a pending `requested_company_role` is blocked from everything except `@AllowPending()`/`@Public()` routes.
- **Company-wide project visibility, confirmed live and in code**: there is no baseline "must be a project member" check outside the specific permission-gated write routes. Every non-archived project in a company is visible to every signed-in company user — this is a deliberate design choice (confirmed by Phase 4/5 work and reconfirmed here), not a missing feature, but it means the only real isolation boundary inside a company is the permission-grant/project_lead system, not membership.

## 2. Role × Action matrix

Legend: ✅ = passes by default · **Grant/Lead only** = requires an explicit `project_permission_grants` row or being that project's `project_lead` · — = no access.

| Company Role (weight) | Create Project | Invite User | Create Issue/RFI/Snag/Submittal/Transmittal/QA | Create Document/Drawing/Capture/BIM model | Edit records (manage_project_records) | Approve/Close RFI | Close Issue | Verify Snag | Force-status | Admin (webhooks/api-keys/audit) | Deactivate/reset-password users | BIM/Engineering read | AI Assistant |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| super_admin (100) | ✅ | ✅ | ✅ | ✅ | ✅ (bypass) | ✅ (bypass) | ✅ | ✅ (bypass) | ✅ | ✅ | ✅ | ✅ full | ✅ |
| company_admin (90) | ✅ | ✅ | ✅ | ✅ | Grant/Lead | Grant/Lead | ✅ | Grant/Lead | ✅ | ✅ | ✅ | ✅ read; write=Grant/Lead | ✅ |
| technical_director (80) | — | ✅* | ✅ | ✅ | Grant/Lead | Grant/Lead | ✅ | Grant/Lead | ✅ | audit only | — | ✅ read; write=Grant/Lead | ✅ |
| engineering_manager (70) | — | ✅ | ✅ | ✅ | Grant/Lead | Grant/Lead | ✅ | Grant/Lead | ✅ | — | — | ✅ read; write=Grant/Lead | ✅ |
| bim_manager (65) | — | ✅* | ✅ | ✅ | Grant/Lead | Grant/Lead | — | Grant/Lead | — | — | — | ✅ read; write=Grant/Lead | ✅ |
| project_manager (60) | — | ✅ | ✅ | ✅ | Grant/Lead | Grant/Lead | — | Grant/Lead | — | — | — | ✅ read; write=Grant/Lead | ✅ |
| construction_manager (55, site-restricted) | — | — | ✅ (Issues/Snags; full on Drawings) | — (blocked elsewhere) | Grant/Lead, Issues/Snags/Drawings only | — | — | Grant/Lead, in-allowlist | — | — | — | read-only elsewhere | ✅ (RFI drafting blocked) |
| qa_qc_manager (50) | — | — | ✅ | ✅ | Grant/Lead | Grant/Lead | — | Grant/Lead | — | — | — | ✅ read; write=Grant/Lead | ✅ |
| commercial_manager (45) | — | — | ✅ | ✅ | Grant/Lead | Grant/Lead | — | Grant/Lead | — | — | — | ✅ read; write=Grant/Lead | ✅ |
| project_engineer (35, site-restricted) | — | — | ✅ (Issues/Snags; full on Drawings) | — (blocked elsewhere) | Grant/Lead, in-allowlist | — | — | Grant/Lead, in-allowlist | — | — | — | read-only elsewhere | ✅ (RFI drafting blocked) |
| consultant (30) | — | — | ✅ | ✅ | Grant/Lead | Grant/Lead | — | Grant/Lead | — | — | — | ✅ read; write=Grant/Lead | ✅ |
| client_representative (20) | — | — | ✅ | ✅ | Grant/Lead | Grant/Lead | — | Grant/Lead | — | — | — | ✅ read; write=Grant/Lead | ✅ |

\* Admitted only by weight resolution, not named in the `@Roles()` decorator — see §4 below.

`project_lead` (a project role any company role can hold on a given project) grants `manage_team`/`manage_issues`/`manage_project_records`/`manage_rfis`/`approve_rfis`/`verify_snag_items` on that one project with no grant needed. Project roles `surveyor`/`document_controller`/`capture_operator`/`viewer` carry no authorization weight anywhere in the API layer today — they affect only `project_members.role` lookups (`site_engineer` triggers `SiteRoleRestrictionGuard`).

## 3. RFI / Issue / Snag lifecycle — the real gating per transition

**RFI** (4 distinct, separately-gated transitions):
| Transition | Gate | Citation |
|---|---|---|
| Create | **none** — any authenticated company user | `rfis.controller.ts:25-29` |
| Submit draft → submitted | inline: creator OR `manage_rfis` OR project_lead OR super_admin | `rfis.service.ts:1104-1114` |
| Respond (formal answer) | `@RequireProjectPermission('manage_rfis')` | `rfis.controller.ts:169-180` |
| Review decision (approve/reject) | `@RequireProjectPermission('manage_rfis','approve_rfis')` | `rfis.controller.ts:187-208` |
| Close | `@RequireProjectPermission('manage_rfis')` | `rfis.controller.ts:210-221` |

**Issues:**
| Action | Gate | Citation |
|---|---|---|
| Create | **none** | `issues.controller.ts:32-36` |
| Update | `@RequireProjectPermission('manage_issues')` | `issues.controller.ts:164-168` |
| Close | inline: `manage_issues` AND ≥1 evidence photo attached | `issues.service.ts:403-412, 546-550` |
| Delete | inline: creator or company admin only | `issues.service.ts:455` |
| force-status / reminders / warn-user | `@Roles('company_admin','engineering_manager')` → by weight admits super_admin/company_admin/technical_director/engineering_manager | `issues.controller.ts:107-126, 262-272` |

**Snags:**
| Action | Gate | Citation |
|---|---|---|
| Create | **none** | `snagging.controller.ts:22-25` |
| Update/Delete | `@RequireProjectPermission('manage_project_records')` | `snagging.controller.ts:48-59` |
| Verify | `@RequireProjectPermission('manage_project_records','verify_snag_items')` | `snagging.controller.ts:87-93` |
| force-status | `@Roles('company_admin','engineering_manager')` | `snagging.controller.ts:95-105` |

## 4. Confirmed gaps / concerns (ranked by severity)

### 4.0 HIGH (functionality, not security) — Fine-grained permission grants are unreachable for every role except company_admin (LIVE-VERIFIED)
See the "CRITICAL CORRECTION" callout in §1. `grantPermission()` rejects any target whose company role isn't literally `company_admin`. The practical consequence, confirmed live during UAT:
- A `project_manager` cannot be given narrow `manage_rfis` access to review/respond to RFIs on one project — the grant endpoint refuses the request outright.
- The only way to give a non-`company_admin` user any of the six project permissions is to make them that project's `project_lead`, which hands them all six at once (`manage_team`, `manage_issues`, `manage_project_records`, `manage_rfis`, `approve_rfis`, `verify_snag_items`) — there is no narrower project role.
- This fails closed (overly restrictive, not a security hole), but it means the "Team & Permissions" UI's promise of configurable, narrow delegation does not work as designed for the vast majority of company roles. A construction company that wants its `qa_qc_manager` to verify snags but not also manage the whole project's team/issues/records/RFIs cannot configure that today.

**Recommended fix:** either allow `grantPermission()` to target any company role (removing the `company_admin`-only restriction, since the endpoint itself is already `@Roles('super_admin')`-gated — only a super_admin can call it in the first place, so the extra restriction on the *target* appears to be stricter than necessary) or introduce one or more narrower project roles between `viewer` and `project_lead` that map to subsets of the six permissions.

### 4.1 CRITICAL — Privilege escalation via user invite (LIVE-VERIFIED)
`POST /users/invite` is gated `@Roles('company_admin','engineering_manager','project_manager')` (admits anyone ≥ `project_manager` weight — 6 of 12 roles). `UsersService.invite()` (`users.service.ts:95`) inserts the caller-supplied `dto.companyRole` **directly and uncapped** as the new user's `company_role`, with `is_active` defaulting to `true` and no pending-approval gate on this path.

**Live reproduction (this audit):** logged in as the demo `project_manager`, called `POST /users/invite` with `{"companyRole":"super_admin", ...}` → `HTTP 201`, and the resulting DB row showed `company_role = 'super_admin'`, `is_active = true`. Any user at `project_manager` weight or above can mint a brand-new `super_admin` account for an email they control. Test account deleted after confirmation.

The `InviteUserDto`'s own comment claims this field is "harmless" pending a separate admin-approval step — that claim does not match what the code does.

**Recommended fix:** cap the inserted `companyRole` to the inviter's own weight (never higher), or ignore client-supplied `companyRole` entirely for anything above the lowest default role and require a separate `super_admin`/`company_admin`-only promotion endpoint.

### 4.2 CRITICAL — `PATCH /projects/:id` has no authorization at all (LIVE-VERIFIED)
`projects.controller.ts:45-49` carries no `@Roles`/`@RequireProjectPermission`. `ProjectsService.update()` (`projects.service.ts:119-158`) performs only tenant (`company_id`) scoping — no role, permission, or membership check.

**Live reproduction:** logged in as the demo `consultant` (weight 30, the second-lowest company role) and successfully renamed the demo project and changed its status via `PATCH /projects/:id` — `HTTP 200`, change persisted in the database. Reverted after confirmation.

Any authenticated user of **any** company role can rename, re-phase, or rewrite the client/contractor/consultant fields of **any project in their company**, with no project membership required. `POST :id/branding/upload-url` is similarly ungated (lower severity on its own).

**Recommended fix:** gate to `@RequireProjectPermission('manage_project_records')` or project_lead/super_admin, matching every other settings-level mutation on this same controller.

### 4.3 CRITICAL — Buildings/Levels/Locations module has zero authorization (CODE-VERIFIED)
All 9 routes in `buildings.controller.ts` (create/update building, levels, locations, archive, convert-pin-to-snag) carry no `@Roles`/`@RequireProjectPermission`; `BuildingsService` contains no role/permission/membership check anywhere (grepped for `ForbiddenException`/`companyRole`/`hasProjectPermission` — zero hits). `SiteRoleRestrictionGuard` does correctly block site-restricted identities from these writes (not in its allowlist), but all other 9 company roles are unrestricted.

**Recommended fix:** gate mutating routes to `manage_project_records`, matching Documents/Drawings/Captures/BIM.

### 4.4 CRITICAL — Risk module has zero project-scoped authorization (CODE-VERIFIED)
Every route in `risk.controller.ts` (recalculate, override, matrix-override, human-assessment, set-status, assign-owner) has no `@Roles`/`@RequireProjectPermission`; `RiskService` scopes only by `companyId`, never by project membership or role (zero hits for `companyRole`/`ForbiddenException`/`hasProjectPermission`). Any authenticated company user can override risk scores, set risk status/owner, or clear matrix overrides on any project in the company.

**Recommended fix:** same pattern — gate mutating routes to `manage_project_records`, reads can likely remain open consistent with the company-wide-visibility design.

### 4.5 HIGH — Deactivation does not revoke a live access token (LIVE-VERIFIED)
`DELETE /users/:id` (`@Roles('super_admin')`) responds `"User deactivated and all sessions revoked."` and correctly sets `is_active = false`. `JwtStrategy.validate()` (`jwt.strategy.ts:19-32`) performs **no database lookup** — it trusts the JWT's embedded claims for the token's full lifetime.

**Live reproduction:** deactivated the demo `consultant` account as `super_admin`, then replayed the consultant's pre-existing access token against `GET /projects` → `HTTP 200`, full data returned. Access tokens are not actually revoked; refresh tokens are (confirmed separately: `auth.service.ts:107` checks `is_active` on refresh).

Impact is bounded by `JWT_ACCESS_EXPIRES_IN=15m`, but a 15-minute live window directly contradicts the "all sessions revoked" message and matters for incident response (compromised account, terminated employee).

**Recommended fix:** either shorten access-token TTL further for this threat model, add a cheap `is_active` check (e.g. cached) to the JWT validation path, or correct the user-facing message to describe the actual guarantee.

### 4.6 MEDIUM — Inconsistent creation gating across record types (CODE-VERIFIED)
Issues, RFIs, Snags, Submittals, Transmittals, and QA Inspections all have **open, ungated creation**; Documents, Drawings, Captures, and BIM models all require `manage_project_records` to create. No in-code rationale documents why creation itself (as opposed to the later workflow transitions) differs this way. Recommend confirming with the product owner whether this is intentional or drift.

### 4.7 LOW — Weight-based `@Roles()` resolution silently widens access
Confirmed mechanically for `users.controller.ts:33` (invite — silently admits `technical_director`/`bim_manager` though neither is named) and present by construction anywhere `@Roles(a, b)` is used. Not a bug in the guard's documented design, but a maintenance risk: inserting a new role between two existing weights changes who passes an existing check without touching the decorator.

### 4.8 Positive findings worth recording
- `POST /users/:id-equivalent admin-reset-password` is deliberately gated tighter (`company_admin` only) than `invite`, with an in-code comment explicitly reasoning through why a password-reset credential is more sensitive than an invite — good security judgment already present in the codebase.
- `PATCH /users/:id` has no controller-level `@Roles()`, but `UsersService.update()` inline-enforces `super_admin`-only for `companyRole`/`isActive` changes and restricts non-admins to their own profile — a service-level check invisible to decorator-only review, verified safe by reading the method body.
- The narrower `approve_rfis` and `verify_snag_items` permissions exist and are honored alongside their broader `manage_rfis`/`manage_project_records` counterparts, exactly as intended for a PMC/client sign-off step distinct from day-to-day project management.
- File-upload storage keys are built from a server-generated UUID, never the client-supplied filename — confirmed live (path-traversal and `.exe` filenames were rejected by extension allowlisting; a valid-extension path-traversal payload was accepted by validation but produced a clean `{companyId}/drawings/{projectId}/{uuid}.pdf` key, with the original filename discarded entirely).

## 5. Not yet verified (time-budget limited, explicitly flagged rather than assumed clean)
Full line-by-line review beyond decorator-level grep for: `documents.controller.ts`, `drawings.controller.ts`, `captures.controller.ts`, `submittals.controller.ts`, `transmittals.controller.ts`, `qa.controller.ts` bodies (pattern consistently matches ungated-create + `manage_project_records`-gated update/delete at the decorator level); the complete `AiUsageService` per-role quota table; `rfi-external-access` token expiry/single-use semantics; and the full `apps/web/src` frontend beyond `ManageMembersModal.tsx`/`AppShell.tsx` (which were checked and matched their server-side rules).
