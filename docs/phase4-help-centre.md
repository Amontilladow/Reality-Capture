# Phase 4 — Help Centre, User Guides & Interactive Onboarding

Tracks the brief's 9 stages (4A–4I) against evidence actually gathered.
Status values match Phase 2/3's docs: **VERIFIED COMPLETE**,
**IMPLEMENTED BUT NOT VERIFIED**, **REQUIRES MY ACTION**, **BLOCKED**,
**NOT IMPLEMENTED**. Per the brief's own final rule: describe the real
application, not an imagined version of it.

## Phase 4A — Audit actual features and permissions — VERIFIED COMPLETE

Inspected directly against this branch's actual code (`App.tsx`,
`AppShell.tsx`, controllers, `packages/types`), not assumed or carried
over from memory of earlier phases.

### Routes and navigation that actually exist

Company-level (no `:projectId`):

| Route | Page | Nav location |
|---|---|---|
| `/projects` | `ProjectList` | "Projects" (top) |
| `/projects/messages` | `MessagesPage` | Communication |
| `/projects/workforce` | `WorkforcePage` | Workforce |
| `/projects/ai-settings` | `AiSettingsPage` | AI |
| `/projects/email-settings` | `EmailSettingsPage` | Email |
| `/projects/help` | `HelpPage` | Help |
| `/projects/developer` | `DeveloperSettingsPage` | Admin (company_admin/super_admin only) |

Project-level (`/projects/:projectId/...`):

| Route | Page | Nav location |
|---|---|---|
| `/projects/:projectId` | `ProjectDetail` | Overview |
| `.../captures` | `CapturesPage` | Project |
| `.../drawings` | `FloorPlanViewer` | Project (labeled "Floor Plans") |
| `.../buildlens`, `.../buildlens/:locationId` | `BuildLensPage` / `BuildLensTimelinePage` | Engineering |
| `.../bim`, `.../bim/:modelId` | `BimModelsPage` / `BimViewerPage` | Engineering |
| `.../issues` | `IssuesPage` | Project |
| `.../rfis`, `.../rfis/:rfiId` | `RfisPage` / `RfiDetailPage` | Project |
| `.../snagging` | `SnaggingPage` | Project |
| `.../submittals` | `SubmittalsPage` | Project |
| `.../progress-report` | `ProgressReportPage` | Project |
| `.../assistant` | `AssistantPage` | AI |
| `.../risk` | `RiskPage` | Risk |
| `.../reports` | `ReportsPage` | Project |
| `.../viewer/:locationId` | `Viewer360` | (full-bleed, linked from floor plan/location, no sidebar entry) |
| `.../emails` *(Phase 3)* | — (no standalone page; composer/history embedded on RFI/Issue/Submittal/Snag detail pages and `ProjectDetail`) | — |

Public / unauthenticated: `/login`, `/forgot-password`, `/reset-password`,
`/accept-invitation`, `/signup`, `/rfi/external/:token` (token-only RFI
reply page, no EngineeringOS account), `/progress-report/:token` (same
pattern for progress reports).

**Finding, fixed in this stage**: `DocumentsPage.tsx`, `QaInspectionsPage.tsx`,
and `TransmittalsPage.tsx` existed as complete components (each with its
own working API client, list view, and create/detail modals) but had
**no route in `App.tsx` and no nav entry in `AppShell.tsx`** — a user
could not reach any of the three through the UI at all, despite the
backend (`documents`/`qa`/`transmittals` controllers and services) being
fully built. Per the account owner's explicit decision, this stage adds:
- Routes: `/projects/:projectId/documents`, `.../transmittals`, `.../qa-inspections`.
- Nav entries under the existing "Project" group in `AppShell.tsx`, each
  with its own icon (`IconFolder`, `IconSend`, `IconChecklist` — added
  here, matching the file's existing one-icon-per-module style).

With that fix, all three are now real, reachable, operational features
and are covered in the Help Centre like any other module (Phase 4D).

### Role and permission model (verified from `packages/types/src/user.types.ts`, `rfi.types.ts`, and every `@RequireProjectPermission` call site)

**This does not match the brief's illustrative role examples** (no
"BIM Coordinator," "Technical Engineer," "Architect," etc. exist in this
codebase) — per the brief's own instruction, role-specific guides (Phase
4E) are built against the roles below, not the brief's examples.

**Company roles** (`CompanyRole`, company-wide, weight-ordered):
`super_admin` (100) · `company_admin` (90) · `technical_director` (80) ·
`engineering_manager` (70) · `bim_manager` (65) · `project_manager` (60) ·
`construction_manager` (55) · `qa_qc_manager` (50) · `commercial_manager`
(45) · `project_engineer` (35) · `consultant` (30) · `client_representative`
(20).

`construction_manager` and `project_engineer` are additionally
**site-restricted** (`SiteRoleRestrictionGuard`): full working access to
Floor Plans/Issues/Snagging, read-only everywhere else, no access to
project settings, user management, or billing — this is a real,
enforced restriction a role-specific guide must reflect, not an
illustrative example.

**Project roles** (`ProjectRole`, per-project, `project_members.role`):
`project_lead` · `site_engineer` · `surveyor` · `document_controller` ·
`capture_operator` · `viewer`. A project's own `project_lead` passes
every `ProjectPermission` check on that project without needing an
explicit grant (`ProjectAuthorizationService`'s own bypass order).

**Project permissions** (`ProjectPermission` — independently grantable,
not a hierarchy): `manage_team` · `manage_issues` · `manage_project_records`
· `manage_rfis` · `approve_rfis` (narrower than `manage_rfis`: only the
PMC/client review-and-approve step) · `verify_snag_items` (narrower
sign-off-only grant for the fixed→verified snag step).

**Organization slots** (`ProjectOrganizationSlot`, RFI-routing context —
the actual implementation of the brief's "organization category" idea,
under a different name and a different value set): `client` · `pmc` ·
`ldc` (Lead Design Consultant) · `main_contractor` · `subcontractor`.

**Verified permission gate per module** (every `@RequireProjectPermission`
call site, read via direct grep across every controller):

| Module | Read (list/detail) | Write (create/update) | Narrower grants |
|---|---|---|---|
| Captures | open to any project member | `manage_project_records` | — |
| Floor Plans / Drawings | open | uploading a drawing / creating a pin: `manage_project_records`; renaming, moving, archiving, or converting an *existing* pin to a Snag: open to any project member (no gate at all — a genuine asymmetry in the real code, not an error in this doc) | — |
| BIM Models | open | `manage_project_records` | — |
| Issues | open | create: open to any project member; update (edit)/delete: `manage_issues`; close: no `ProjectPermission`, but requires company-role weight ≥ `engineering_manager` (i.e. `super_admin`/`company_admin`/`technical_director`/`engineering_manager`) **or** `manage_issues`, **and** at least one evidence capture attached; force-status: `@Roles('company_admin','engineering_manager')`, which `RolesGuard` resolves by weight to the same ≥`engineering_manager` set (no `manage_issues` fallback for this one) | — |
| RFIs | open | create: open to any project member; update/delete/attachments/notice-letter: `manage_project_records`; submit: no `ProjectPermission` -- service-level check (creator OR `manage_rfis` OR Project Lead OR super_admin); request-clarification/respond/close/reopen/drawing-reminder: `manage_rfis`; submit-for-review/decide-review: `manage_rfis` OR `approve_rfis` | `approve_rfis` (review-only) |
| Snagging | open | create: open to any project member; update/delete: `manage_project_records`; verify (fixed→verified): `manage_project_records` OR `verify_snag_items` | `verify_snag_items` (verify-only) |
| Submittals | open | create: open to any project member; update/delete: `manage_project_records` | — |
| Transmittals | open | create: open to any project member; update/delete: `manage_project_records` | — |
| QA Inspections | open | create: open to any project member; update/delete: `manage_project_records` | — |
| Documents | open | upload/create/link: `manage_project_records` | — |
| Progress Reports | open -- the report itself is computed live on read, not a stored record | generating/revoking a public share link: `manage_project_records` | — |
| Team & Permissions (`ManageMembersModal`) | read open to current members; write | `manage_team` | — |
| Email send/history (Phase 3) | gated by project membership only (no `ProjectPermission` required — any project member may send/view) | same | — |

**Correction note**: an earlier pass over this table (committed in Phase
4A) got several of these backwards by grepping for
`@RequireProjectPermission` occurrences without confirming which method
each one actually decorates. Re-verified every row above directly
against each controller's source (reading the method bodies, not just
counting decorator lines) during Phase 4D, while writing the Issues and
Floor Plans/Pinpoints articles that depend on getting this right. The
general, now-confirmed pattern across this codebase: **creating** a
workflow record (Issue, RFI, Snag, Submittal, Transmittal, QA Inspection)
is open to any project member; **editing or deleting** one requires
`manage_project_records` (or the record's own narrower permission, e.g.
`manage_issues` for Issues). File-upload-centric creation (Captures,
Drawings, BIM Models, Documents, a floor-plan pin) is the exception --
creating *those* requires `manage_project_records` from the start. Floor
Plans/Pinpoints breaks the "edit needs permission" half of the pattern
in the other direction: once a pin exists, renaming/moving/archiving/
converting it has no permission gate at all. Both asymmetries are
described exactly as found, not smoothed over.

### Modules verified operational (will get Help Centre coverage)

Captures · Floor Plans & Pinpoints (via `FloorPlanViewer`, including the
360° `Viewer360`) · Issues · Snagging · RFIs (incl. the external
token-link reply flow) · Submittals · Transmittals · QA Inspections ·
Documents · BIM Models · BuildLens (photo-timeline comparison) ·
Progress Reports · Reports (KPIs, PDF export for both the general
project report and the risk report, Excel export) · Risk (AI-scored risk
graph, human risk assessment) · Notifications (bell icon; no manageable
"preferences" — confirmed, see below) · Messages (project channels +
DMs) · AI Assistant (Q&A + RFI/Issue/Snag draft creation, daily quota) ·
Email Integration (Outlook/Gmail connect, compose/send, history — Phase
3, already shipped) · Workforce (activity/productivity tracking,
reporting lines, screenshots — admin + self views) · User management
(invite, approve, deactivate, role assignment — `ManageMembersModal`) ·
Developer settings (API keys, webhooks — company_admin/super_admin only).

### Confirmed NOT supported (so these are never documented as available)

- **Notification preferences/management** — grepped
  `NotificationBell.tsx` for "preferences"/"mute"/"unsubscribe": no
  matches. The bell shows and marks-read; there is no settings surface
  to change what triggers a notification.
- **A dedicated "Contact Support" or "Report a Problem" feature** — no
  such route, page, or backend endpoint exists anywhere in the app.
  Troubleshooting articles (Phase 4H) will direct users to their company
  admin instead of inventing a support-ticket flow that doesn't exist.
- **Article/content management UI** — no admin interface for authoring
  Help Centre content exists yet (this phase builds the user-facing
  Help Centre first, per the brief's own fallback: "implement the
  user-facing Help Centre first and document the recommended
  administration phase separately" — see the Phase 4I report).
- **Any existing onboarding/tour component** — grepped the whole
  frontend for "onboarding," "tour," "walkthrough": no matches (two
  unrelated false-positive hits in `SnaggingPage.tsx`/the migrations).
  Phase 4F builds this from nothing, not by extending something partial.

### Existing UI/design system confirmed reusable (no new dependency needed)

`Modal`, `Card`, `Alert`, `Input`/`Textarea`/`Select` (`components/ui/Field.tsx`),
`StatusBadge`, `PageHeader` — all already used consistently across every
page audited above. The Help Centre and onboarding (4B–4H) are built
entirely from these; no new UI library is introduced.

## Phase 4B/4C — Help Centre navigation/layout + article rendering/search — VERIFIED COMPLETE (framework; see 4D for content coverage)

**Architecture decision (brief: "investigate the simplest secure way to
maintain help articles... prefer an approach consistent with the
existing stack"):** article content is static, versioned TypeScript data
(`apps/web/src/content/help/*.ts`), not a new database table or backend
module. Reasoning:
- It is genuinely the simplest option consistent with the existing
  stack -- this codebase already expresses large label/constant tables
  this way (`RFI_DISCIPLINE_LABELS`, `PROJECT_ORGANIZATION_SLOT_LABELS`,
  etc.), so this isn't a new pattern.
- It needs no new migration, no new backend module, and critically no
  new admin-authoring authentication/authorization surface -- the brief
  explicitly warns against "an unnecessary second authentication
  system." Content changes go through the same PR/code-review process as
  everything else, which already is the access control.
- Search and role-visibility can run entirely client-side with zero
  confidentiality risk, because this content is generic product
  documentation -- no project data, no attachment, no user-entered text
  is ever in it. The brief's "search must not expose restricted content"
  concern has no teeth here: there is no restricted content in the
  corpus, only advice about which role can do what.
- The brief explicitly allows this fallback: "If a full article-
  management interface would substantially expand the scope, implement
  the user-facing Help Centre first and document the recommended
  administration phase separately" -- done; see Phase 4I's
  "Administrative capabilities" section for the recommended next phase
  if non-engineers need to self-edit content later.

**Content model** (`apps/web/src/content/help/types.ts`): one
`HelpArticle` type covering the brief's full 16-field template, every
field but `slug`/`category`/`title`/`summary` optional -- a short FAQ or
glossary entry uses only the required fields; a full feature
walkthrough uses most or all of the rest. `ArticleView` (and the right
panel's table of contents, which shares one `getArticleSectionTitles()`
helper with it so the two can never disagree) render only the fields
actually present, never an empty heading for an omitted one.

**Layout** (`apps/web/src/pages/HelpPage.tsx`, same route `/projects/help`
and nav entry the Phase 1K skeleton already used -- replaced the stub
entirely, no new route added): three-panel desktop layout exactly as the
brief specifies --
- **Left**: category navigation (Getting Started, Dashboard & Projects,
  Floor Plans & Pinpoints, Issues & Snagging, RFI, Drawings & Documents,
  Reports & Progress, Notifications & Email, AI Assistant, User
  Management & Security, FAQ, Troubleshooting, Glossary).
- **Main**: either the category's article list (title + one-line
  summary cards) or, once an article is opened, its full rendered
  content.
- **Right**: table of contents (jump links to whichever sections the
  open article actually has), related articles, and up to three
  "common mistakes" entries as helpful tips -- all three only appear
  once an article is open, and only the parts that have real content.

On a narrow screen the three-column grid collapses to a single stacked
column (Tailwind `grid-cols-1 lg:grid-cols-[...]`), same responsive
pattern already used elsewhere in this app (e.g. `ProjectDetail`'s
hierarchy/content split) -- verified in Phase 4I.

Deep-linking: `?article=<slug>` and `?category=<key>` query params select
content directly, read via `useSearchParams` -- this is what Phase 4G's
contextual help links target, so a help icon next to (for example) the
RFI form opens that specific article, never the Help Centre homepage.

**Search** (`apps/web/src/content/help/index.ts`): local, in-browser
substring match over title, keywords, summary, and category label --
no backend call, no external/paid search provider, per the brief's
explicit instruction. Empty results show a short message plus a few
category suggestions rather than a bare "no results."

**Verified**: `tsc --noEmit` clean, `eslint` clean (zero new warnings --
the one risk, two functions sharing a file with a React component
triggering a fast-refresh lint warning, was avoided by moving them to
their own `article-sections.ts` module), production build succeeds.
Framework tested with the seed content written so far (Getting Started:
9 articles; Glossary: 15 terms; FAQ: 5 entries; Troubleshooting: all 12
of the brief's Section K symptoms) -- category browsing, article
opening, related-article navigation, and search all work end to end
against this real content, not placeholder text.

**Not yet verified**: a real browser render (no live backend/DB in this
environment -- same limitation as every prior phase; confirmed via
`pg_isready`).

## Phase 4D — Write + verify highest-priority articles — VERIFIED COMPLETE

Ten category files written, each only after reading the relevant
controller(s)/service(s)/page(s) directly (full method bodies, not just
counting decorator occurrences -- this phase's audit method, switched to
after catching mistakes in the original Phase 4A pass; see the
correction note above):

| File | Articles | Modules covered |
|---|---|---|
| `dashboard-projects.ts` | 8 | Projects page, project dashboard, create/edit/archive a project, switching projects, organization slots |
| `floor-plans-pinpoints.ts` | 9 | Floor plan viewer, pinpoints (create/view/photo/convert), filtering (not yet available) |
| `issues-snagging.ts` | 15 | Issues (create/edit/assign/priority/photos/comments/track/close) and Snagging (create/mark-fixed/verify) |
| `rfi.ts` | 9 | RFI lifecycle: create, describe, attach, submit, respond, track, closure |
| `drawings-documents.ts` | 9 | Documents, Transmittals, QA Inspections |
| `reports-progress.ts` | 9 | Reports KPIs/charts/exports, Progress Report and its share link |
| `notifications-email.ts` | 8 | Notifications, Outlook/Gmail connect, sending/history/disconnect |
| `ai-assistant.ts` | 7 | AI Assistant scope, capabilities, limitations, privacy |
| `user-management.ts` | 7 | Inviting users, organization vs. project access, roles, password resets |
| (Getting Started/Glossary/FAQ/Troubleshooting from 4B/4C) | 41 | — |

123 articles total, wired into `ALL_HELP_ARTICLES` in
`apps/web/src/content/help/index.ts`.

**A significant permission finding surfaced while verifying
`dashboard-projects.ts` and `user-management.ts` (not something this
phase changes -- documented here because it affects what the Help
Centre can accurately tell a user, and because it's a real,
security-relevant gap worth your attention):**

- `PATCH /projects/:id` (editing any project's details, including
  setting its status to `archived` -- there is no separate archive or
  delete endpoint) carries no `@Roles` or `@RequireProjectPermission`
  decorator. Any authenticated user in the same company can edit, or
  effectively archive, any project.
- More broadly: reading a project's own records (issues, RFIs, drawings,
  documents, etc.) is **not** gated by project membership anywhere --
  confirmed by reading `issues.controller.ts`'s read endpoints,
  `project-permission.guard.ts` (passes through any route without the
  `@RequireProjectPermission` decorator -- it is opt-in, not default-deny),
  and `IssuesService`'s query methods (filter by `project_id`/`company_id`
  only, no `project_members` join). `GET /projects` itself also returns
  every non-archived company project to every company user, with no
  "my projects" filter. Only *writing* to most modules, and viewing/
  editing the formal project-membership/role/organization-slot
  structure itself, is actually gated.
- This phase's help content describes this behavior exactly as found
  (e.g. "Selecting a Project" in Getting Started, "Understanding Project
  Access" in User Management & Security) rather than instructing users
  to expect a membership wall that doesn't exist -- per the brief's rule
  against describing an imagined version of the app. Whether this is
  the intended access model or a gap worth closing is a product/security
  decision outside this Help Centre phase's scope; flagging it here so
  it isn't silently normalized into documentation as if it were by
  design.

**Verified**: `tsc --noEmit` clean, `eslint --max-warnings=0` clean
across `apps/web/src/content/help`, production build (`npm run build`)
succeeds, and every `relatedSlugs` reference across all 13 content
files resolves to a real slug (checked programmatically -- zero dead
links, zero duplicate slugs).

**Second correction (made after the first commit, same verification
discipline):** `RolesGuard` (`apps/api/src/common/guards/roles.guard.ts`)
does not match `@Roles(...)` against an exact list -- it resolves the
*minimum weight* among the listed roles and admits any company role
whose `COMPANY_ROLE_WEIGHT` is at or above that minimum. This means
`@Roles('company_admin', 'engineering_manager', 'project_manager')` on
invite actually admits `super_admin`, `technical_director`, and
`bim_manager` too (anything with weight ≥ 60), not just the three named
roles -- read the article text as "requires Company Admin" and you'd
wrongly conclude a Technical Director can't invite someone. Corrected
`inviting-users`/`understanding-organization-access` in
`user-management.ts` and `reviewing-and-closing-an-issue`/
`understanding-the-difference-between-issues-and-snagging` in
`issues-snagging.ts` (issue close/force-status is `@Roles('company_admin',
'engineering_manager')`, which resolves to weight ≥ 70 --
`super_admin`/`company_admin`/`technical_director`/`engineering_manager`,
matching `IssuesService.isPermittedApprover()`'s explicit weight check
for `close()`; `forceStatus()` has no `manage_issues` fallback, `close()`
does). Re-checked every other `@Roles(...)` claim in this phase's
content against this same weight rule -- `creating-a-project`'s
`@Roles('super_admin', 'company_admin')` resolves to weight ≥ 90, i.e.
exactly those two roles, so that article needed no change.

**Not yet verified**: a real browser render (no live backend/DB in this
environment). Role-specific filtering (4E), onboarding (4F), contextual
help links (4G), and expanded FAQ/troubleshooting coverage (4H) are not
yet done at the time this section was written.

## Phase 4E — Role-specific guides — VERIFIED COMPLETE

Added a "For My Role" entry point to the Help Centre
(`apps/web/src/pages/HelpPage.tsx`), reading the signed-in user's real
`companyRole` from `useAuthStore` (no new auth/profile mechanism). It
shows a curated quick-start subset of already-written articles for that
role, defined in a new `apps/web/src/content/help/role-guides.ts`
(`ROLE_GUIDE_SLUGS: Record<CompanyRole, string[]>`) -- deliberately a
hand-picked list of 4-6 real article slugs per role, not a filter over
the whole 124-article library: most articles are open to "any project
member," so filtering by role tag alone would reproduce nearly the full
list and defeat the point of a "quick start."

Also tagged the genuinely role-gated procedural articles with
`roles.companyRoles` (used by the existing `getArticlesForRole()`
helper, not directly by the new UI) so a future role-scoped view has
accurate metadata to build on: `inviting-users` (every role whose
`RolesGuard`-resolved weight qualifies), `managing-user-roles`
(`super_admin` only), `creating-a-project` (`super_admin`/
`company_admin`), and a new article,
`understanding-site-role-restrictions` (user-management.ts), tagged
`construction_manager`/`project_engineer` specifically -- it documents
the real, already-shipped `SiteRoleRestrictionGuard` behavior (full
access on Floor Plans/Issues/Snagging only, read-only everywhere else
for those two roles), which neither role would otherwise see explained
anywhere in the Help Centre. `reviewing-and-closing-an-issue` was left
untagged deliberately: closing is available either by sufficiently
senior role or by a `manage_issues` permission grant regardless of
role, so a role tag alone would misrepresent who can actually do it.

All 12 company roles have a guide (`super_admin`, `company_admin`,
`technical_director`, `engineering_manager`, `bim_manager`,
`project_manager`, `construction_manager`, `qa_qc_manager`,
`commercial_manager`, `consultant`, `client_representative`,
`project_engineer`). Two roles' guides point to the
site-restriction article as their first entry (`construction_manager`,
`project_engineer`), reflecting their real, narrower access.

**Known limitation**: there is no written Help Centre coverage of BIM
Models at all (confirmed while picking `bim_manager`'s guide -- no
`bim-models.ts` category file exists, and none of the brief's suggested
categories maps cleanly onto it either). `bim_manager`'s guide links to
the closest adjacent real content (Documents, Reports, inviting users)
rather than inventing BIM-specific procedural content. Flagged again in
Phase 4I's final report as missing content, not silently worked around.

**Verified**: `tsc --noEmit` clean, `eslint --max-warnings=0` clean,
production build succeeds, and every slug in `ROLE_GUIDE_SLUGS`
(53 references) resolves to a real article (checked programmatically,
same method as the `relatedSlugs` integrity check).

**Not yet verified**: a real browser render. Onboarding (4F), contextual
help links (4G), and expanded FAQ/troubleshooting coverage (4H) remain.

## Phase 4F — Interactive onboarding — VERIFIED COMPLETE

**Persistence decision**, made after dedicated investigation rather than
guessing: reused the `users.preferences JSONB` column that already
exists on the `users` table (`apps/api/src/database/migrations/
001_initial_schema.sql`) -- selected in `findOne()`/`getMe()` already,
but never written anywhere until now. No new migration, no new table,
no new admin surface. Completion is a single `onboardingCompleted`
boolean inside that JSON (`{"onboardingCompleted": true}`), written via
`jsonb_set` -- deliberately only that one key, never the whole request
body, so nothing else a caller might add to the DTO could land in
`preferences` by accident.

**No new authorization surface**: `onboardingCompleted` was added as an
ordinary optional field on the existing `UpdateUserDto` and the existing
`PATCH /users/:id` self-profile-edit path in `UsersService.update()` --
the same "editing your own profile is always allowed" rule that already
covers `firstName`/`lastName`/`phone` now also covers this, with no new
`@Roles`, guard, or endpoint. `AuthenticatedUser` gained an optional
`onboardingCompleted?: boolean` (packages/types/src/user.types.ts),
populated from a fresh DB read on `login()`, `getMe()`, and set to
`false` explicitly on `acceptInvitation()`/`selfSignup()` (brand-new
accounts) -- deliberately left out of the JWT payload itself (per the
investigating agent's recommendation) to avoid token bloat and staleness
across the access token's lifetime.

**Frontend** (`apps/web/src/components/onboarding/OnboardingFlow.tsx`,
mounted once in `AppShell.tsx` alongside `ChatWidget`): a 7-step modal
(Welcome -> your role and organization, including the site-restriction
note for Construction Manager/Project Engineer -> the Projects page ->
finding a project -> key modules -> a safe guided first task (view a
project's Issues list, open to every project member) -> a Help Centre
pointer), built on the existing `Modal` component so it matches the
rest of the app's dialogs rather than introducing a new visual pattern.
Controls: Skip (left), Back (from step 2 on), Next, and Finish & Open
Help Centre on the last step; closing the modal (the X) behaves like
Skip. Shown whenever `user.onboardingCompleted !== true` and the user
isn't pending approval; Skip/Finish set it to `true` both locally
(instant) and via a best-effort `PATCH /users/:id` (so a failed write
never blocks the user, it just risks reshowing the tour next login).
"Restart onboarding tour" lives in the Help Centre's left nav
(`HelpPage.tsx`) and does the mirror-image write (`false`), which
re-triggers the same modal through the same condition -- no separate
code path for "first run" vs. "restart."

No unnecessary personal information is stored: the only thing written
is a single boolean, inside a column that already exists and already
held nothing use-specific until now.

**Verified**: `tsc --noEmit` clean on both `apps/api` and `apps/web`,
`eslint --max-warnings=0` clean, both production builds succeed, and
the full API test suite (564 tests, up from 560) passes, including 4 new
`UsersService.update` tests added for this change (self-completing
onboarding without any admin role; restarting it; the no-op case when
the dto has no fields; and confirming it's still blocked from being set
on someone else's behalf by a non-admin -- the existing self-edit rule
applies unchanged).

**Not yet verified**: a real browser render/manual click-through (no
live backend/DB in this environment). Contextual help links (4G) and
expanded FAQ/troubleshooting coverage (4H) remain.

## Phase 4G — Contextual help links — VERIFIED COMPLETE

Added `apps/web/src/components/help/HelpLink.tsx`: a small reusable
link that always deep-links to one specific article slug (never the
Help Centre homepage) via the `?article=<slug>` pattern `HelpPage.tsx`
already reads. It always opens in a new tab (`target="_blank"`) --
every one of its call sites sits inside a form a user may be mid-filling
(RFI, Issue) or a page they're mid-task on, so navigating away in the
same tab would discard unsaved input or lose their place.

Wired into exactly the five locations the brief names, used sparingly
(one link per location, not scattered across every field):

| Location | Article it links to |
|---|---|
| `RfiFormModal.tsx` | `creating-an-rfi` |
| `IssueFormModal.tsx` | `creating-an-issue` (new) / `updating-an-issue` (edit) |
| `FloorPlanViewer.tsx` | `opening-a-floor-plan` |
| `ReportsPage.tsx` | `understanding-available-kpis` |
| `EmailSettingsPage.tsx` | `connecting-outlook` |

Every linked slug was checked against the real, already-written article
list (not invented) -- same programmatic dead-link method used for
`relatedSlugs` and `ROLE_GUIDE_SLUGS` in earlier stages.

**Verified**: `tsc --noEmit` clean, `eslint --max-warnings=0` clean,
production build succeeds.

**Not yet verified**: a real browser render/manual click-through.
Expanded FAQ/troubleshooting coverage (4H) and the final permissions/
responsiveness/navigation test pass + report (4I) remain.

## Phase 4H — Expand FAQ and troubleshooting coverage — VERIFIED COMPLETE

**Caught and fixed two more leftover errors from before the Phase 4D
correction pass**, both in content written during 4B/4C (before the
deeper permission audit) and missed when 4D corrected the same mistakes
elsewhere: `faq-which-projects-can-i-see` and
`trouble-project-not-visible` both still claimed project visibility was
membership-gated ("you only see projects you've been added to") --
corrected to match the verified fact (every non-archived company
project is visible to every company user). `faq-why-cant-i-create-something`
and `trouble-access-denied` both still claimed RFIs/Submittals/
Transmittals/QA Inspections needed `manage_project_records` to *create*
-- corrected to the verified pattern (create is open to any project
member; only Documents/Captures/Floor Plans/BIM Models require the
permission to create; edit/delete needs it for almost everything).
Running the full-content dead-link/duplicate-slug check (same method as
4D/4E/4G) after every content change remains how these keep getting
caught before commit rather than after.

**New FAQ entries** (`faq.ts`, 5 -> 11 entries), covering modules the
original 5 entries predated: what a Transmittal is, what a QA
Inspection is and how it differs from Snagging, why Reports numbers
don't match a prior week (computed live, no snapshot), whether
Documents syncs with Procore/Aconex/SharePoint/BIM 360 (no), who can
invite users and approve roles, and who can edit/archive a project
(any company member -- the same flagged finding from 4D, surfaced here
too since it's a natural FAQ).

**New troubleshooting entries** (`troubleshooting.ts`, 12 -> 14 symptoms,
plus the 2 corrections above): "Can't Close an Issue" (evidence vs.
role/permission) and "RFI Won't Submit" (creator/manage_rfis/Project
Lead/super_admin only) -- both direct from Phase 4D's RFI/Issue
authorization findings, which the original 12 generic Section K symptoms
didn't specifically cover.

**Verified**: `tsc --noEmit` clean, `eslint --max-warnings=0` clean,
production build succeeds, and the full dead-link/duplicate-slug check
across all 14 content files is clean (132 slugs, 150 relatedSlugs
references, zero missing, zero duplicates).

**Not yet verified**: a real browser render/manual click-through. Phase
4I (permissions/responsiveness/navigation testing + final report)
remains.
