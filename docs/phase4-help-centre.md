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

## Phase 4B — Help Centre navigation and layout

See below — in progress.
