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
| Floor Plans / Drawings | open | `manage_project_records` | — |
| BIM Models | open | `manage_project_records` | — |
| Issues | open | create/update: open*; `manage_issues` for the admin-only force-status override | — |
| RFIs | open | create/respond/close/etc.: `manage_project_records`; submit-for-review/decide-review: `manage_rfis` OR `approve_rfis`; drawing-update reminder: `manage_rfis` | `approve_rfis` (review-only) |
| Snagging | open | create/update: `manage_project_records`; verify (fixed→verified): `manage_project_records` OR `verify_snag_items` | `verify_snag_items` (verify-only) |
| Submittals | open | `manage_project_records` | — |
| Transmittals | open | `manage_project_records` | — |
| QA Inspections | open | `manage_project_records` | — |
| Documents | open | upload/create/link: `manage_project_records` | — |
| Progress Reports | open | generate/share: `manage_project_records` | — |
| Team & Permissions (`ManageMembersModal`) | read open to current members; write | `manage_team` | — |
| Email send/history (Phase 3) | gated by project membership only (no `ProjectPermission` required — any project member may send/view) | same | — |

\* Issue creation itself has no `@RequireProjectPermission` decorator at
all — any project member can create one. Only the admin force-status
override route requires `manage_issues`.

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
`pg_isready`). Full content coverage for every module is Phase 4D, not
yet done at the time this section was written.
