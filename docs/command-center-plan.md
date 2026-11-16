# Project Command Center: architecture review and plan

## 1. What exists today (inspected)

| Area | Found | Notes |
|---|---|---|
| Stack | NestJS 10 API + Postgres (raw SQL via `postgres`, numbered migrations 001-084), React 18 + Vite + Tailwind + React Query web app | RLS on every tenant table (`withTenant`), company tenancy guard on every route |
| Authorization | Global guards: JWT, Tenancy, Roles, ProjectPermission, CategoryAction, SiteRoleRestriction, SubcontractorRfiAccess, SectionSevenViewOnly | Project reads are company-scoped; subcontractors are blocked from everything under `/projects/:id/*` except RFIs, drawings (view), own issues/submittals |
| Branding | Jet Black / Smoke Grey / Cherry Red tokens (`--rc-*`), curved glass sidebar, 16px body scale, shared `Menu` and `Collapsible` | Reused as is; no new palette |
| Dated records | `issues.deadline`, `rfis.due_date`, `snag_items.due_date`, `qaqc_records.due_date`, `submittals.due_date`, `qa_inspections.inspection_date`, `issue_reminders.scheduled_for` | All carry `assigned_to` (inspections too) |
| Drawings | `site_drawings.current_workflow_status` (UNDER_REVIEW, APPROVED, AFC, REJECTED, SUPERSEDED, WITHDRAWN, UNKNOWN) | No reviewer or due date column, so "awaiting review" is project-wide, not per person |
| Activity | `audit_log` + `/audit/project/:id` + `groupActivity()` | Reused for the timeline; links added from `resourceType/resourceId` |
| Notifications | Full engine (in-app, email, WhatsApp, escalation) | Unchanged |
| Calendar | Only Workforce shifts/absences and an external workforce calendar sync | **No project or personal calendar** |
| Personal tasks / saved items | **None** | New |
| Meetings | **None in the system** | Meetings filter shown as "not available" rather than faked |
| Global search | **None** (only per-list `search` params) | New, server-side |
| User preferences | `users.preferences` JSONB | Timezone, 12/24h clock and dashboard perspective stored here; no migration needed |

## 2. Decisions

1. **The Command Center is the project Overview** (`/projects/:id`), the page every project link already lands on. Personal widgets (greeting, clock, calendar, priorities, workspace) sit on top of the project data, so one screen serves "what do I do today" and "how is this project".
2. **Navigation keeps the approved curved sidebar** (logo, project switcher, notifications, profile, settings already live there). A new **MY WORKSPACE** section adds My tasks / My calendar / Saved items. Existing sections and routes are kept; nothing is removed. Global search opens from a search button in the page header and from Ctrl/⌘+K.
3. **Smallest schema change**: one migration, two tables, both with company RLS and always filtered by `user_id` (private by default):
   - `user_tasks` (personal tasks and reminders: title, description, notes, due date, optional due time, priority, status, kind task/reminder, optional project and linked record)
   - `saved_items` (bookmarks: type, record id, project, label, note; unique per user + record)
4. **Calendar = derived, never copied.** `/me/agenda` reads dates straight from issues, RFIs, snags, QA/QC records, submittals, inspections and personal tasks for a date range. No event rows are duplicated.
5. **Priorities are rule-based** (no AI). Documented score below.
6. **KPIs are server-aggregated** in one `/projects/:id/command-center` call, which sits under `/projects/:id`, so every existing guard (including the subcontractor block) applies automatically.
7. **Perspective** (Management / Engineer) only reorders and emphasises sections; it never widens data access. Default comes from company role, and the user can switch.

## 3. Calculations

**KPI snapshot** (project, real data, `null` → "Not enough data")
- Total drawings: current site drawings, excluding SUPERSEDED and WITHDRAWN.
- Pending actions: open issues + open RFIs + open snags + open QA/QC records + open submittals.
- Overdue items: the same set, with a due date in the past (items without a due date are never overdue).
- Document compliance: approved (APPROVED + AFC) ÷ current drawings with a known status (excluding UNKNOWN). Fewer than 5 such drawings → not enough data.

**Priority score** (higher first; only items assigned to the user, plus their own tasks and reminders)
- Overdue: 100 + days overdue (capped at +30)
- Due today: 80; due tomorrow: 60; due within 7 days: 40; no date: 10
- Priority: critical +30, high +20, medium +10, low 0
- Awaiting the user's response (RFI open and assigned to them, issue waiting on its assignee): +15
- Inspection scheduled today: treated as due today
- Each result states why it ranks ("Overdue by 2 days", "Critical, due today") and gives a recommended next action and a link.

## 4. Build phases

1. Backend: migration 085, `workspace` module (tasks, saved items, agenda, priorities, preferences, search) and `command-center` endpoint, with unit tests.
2. Command Center foundation: greeting, live clock (user timezone, 12/24h, DST via `Intl`), interactive month calendar with dots, Today button.
3. Personal productivity: My tasks (Assigned / Personal / Reminders), Saved items, Save buttons on records, Today's priorities.
4. Project operations: KPI snapshot, Attention center (filterable, full list), My workspace, linked activity timeline, permission-aware quick actions.
5. Perspectives and project health.
6. Tests: API unit tests, a real Postgres migration run plus endpoint smoke tests, web unit tests, desktop/phone screenshots, regression suite.

Then screenshots for approval; merge only after the owner says so.

---

# Implementation report

## Built

| Area | What | Where |
|---|---|---|
| Schema | Migration 085: `user_tasks` (tasks + reminders) and `saved_items`, company RLS + FORCE RLS, always filtered by `user_id` | `apps/api/src/database/migrations/085_personal_workspace.sql` |
| API | `/me/preferences`, `/me/tasks`, `/me/saved`, `/me/agenda`, `/me/priorities`, `/me/workspace`, `/me/search`; `/projects/:id/command-center` | `apps/api/src/modules/workspace/` |
| Priority rules | Pure, unit-tested ranking and attention classification (section 3 above) | `priority-rules.ts` + spec |
| Overview → Command Center | Greeting, live clock, interactive month calendar (week strip on phones), today's agenda with tick-off, quick actions, engineer/management views, Today's priorities, My workspace, KPI snapshot, Attention center, linked activity timeline, project health | `apps/web/src/components/command-center/`, `pages/ProjectDetail.tsx` |
| Pages | My tasks (Assigned / Personal / Reminders / Completed), My calendar (month / week / day, filters, upcoming deadlines), My saved items | `pages/MyTasksPage.tsx`, `MyCalendarPage.tsx`, `SavedItemsPage.tsx` |
| Navigation | MY WORKSPACE sidebar section (inside and outside a project); Search button + Ctrl/⌘+K global search; Save buttons on issue, RFI and QA/QC detail | `AppShell.tsx`, `workspace/GlobalSearch.tsx`, `workspace/SaveButton.tsx` |
| Deep links | `?new=1` opens the create form on Issues, RFIs, QA/QC lists, QA inspections and the Site Drawing Hub (quick actions) | the four pages |

## Reused

Existing tenancy/RLS (`withTenant`), every global guard, `users.preferences` JSONB, the audit log and `groupActivity()`, the Risk and Reports executive summary (`useProjectBriefing`, risk card, banner), `categoryCan`/`getOrgCategory` and `SITE_RESTRICTED_COMPANY_ROLES` for quick actions, and the shared Modal, Field, Listbox, Menu, Collapsible, Badge and toast components. No new colours: Jet Black / Smoke Grey / Cherry Red tokens throughout.

## Task and calendar data

Personal tasks and reminders are the only new records. Every other calendar entry is read live from its own table (issue `deadline`, RFI/snag/submittal `due_date`, QA/QC `due_date`, inspection `inspection_date`), so nothing is duplicated and completing a record anywhere updates the calendar, priorities and workspace at once (shared React Query keys under `['me']` and `['command-center']`).

## Time zones

The user's saved IANA zone (`preferences.timezone`) wins, else the browser's zone (sent as `tz`), else UTC. Postgres converts timestamps with `AT TIME ZONE` and formats dates in SQL; the browser formats with `Intl`, so DST changes apply at the next tick with no reload. Date-only fields (QA/QC due dates, personal task dates) are treated as that calendar day. Tests cover the date line (Dubai vs New York) and a US DST transition.

## Permissions verified (against a real Postgres + API)

- Personal tasks and saved items: invisible and unchangeable by another user or another company (404).
- Saved items can only point at records the caller's company owns, and tasks they own.
- `/projects/:id/command-center` sits under the existing project guards: other company → 404, subcontractor → 403.
- `/me` aggregations apply the subcontractor rule themselves (RFIs only on those projects).
- Search never returns another user's tasks and is company-isolated.
- One deliberate guard change: `SiteRoleRestrictionGuard` (read-only-elsewhere for site roles) now lets `/api/v1/me/*` writes through, since they only touch the caller's own rows; covered by a new guard test, and project paths stay blocked.
- Quick actions mirror the category matrix and the site-role restriction (a site engineer sees Create issue, not Create RFI).

## Testing

- API: 1157 unit tests (14 new for priority rules, 1 for the guard); 43-check smoke run against the real API + Postgres (privacy, isolation, subcontractor, timezone, ranking, no duplicates, completion).
- Web: 153 tests (6 new for clock, calendar, dots, labels, links; 1 regression for string counts); typecheck, lint (3 pre-existing warnings), production build, design-rules test.
- End to end in Chromium on the real stack: create a task in the UI → appears and ranks → tick it off → leaves priorities; calendar day select + Today; Save → Saved items; perspective persists across reload; attention filters; Ctrl+K search → Enter opens the record; no page errors.
- Desktop 1440px and phone 390px: no horizontal overflow.

## Fixed along the way

- Executive signals printed "1 critical issues are open": the reports API returns counts as strings; `buildSignals` now coerces them.

## Limitations

- **Meetings** do not exist in RealityCapture; they appear only once a user connects their own calendar (below). Without one, the calendar says so instead of inventing any.
- **Drawings awaiting review** are project-wide: site drawings have no reviewer or due-date column, so they can't be "awaiting *my* review" or overdue.
- **Revision conflicts** have no data model, so they aren't shown.
- **Personal tasks can't be shared** yet (private by default, with no share option).
- **Reminders don't send notifications** yet; they appear in the calendar, priorities and workspace.
- **Package progress** isn't included for management; no package-level data exists.
- Submittals and QA inspections link to their module lists, since those pages have no per-record URL.

## Connect calendar (Google / Outlook), optional

- **+ Connect calendar** on My calendar and the Overview's calendar card offers Google Calendar and Outlook Calendar. It is read-only: RealityCapture never creates or changes events there.
- **Reuses** the Workforce Google connection: the same encrypted token table (`workforce_calendar_integrations`, one row per user and provider), the same Google OAuth client and callback, and the same HMAC-signed state. The state now also carries where to return (`workforce` or `calendar`), signed, so it can't become an open redirect. Outlook uses the Outlook-email Entra app registration with its own callback and the `Calendars.Read` scope. No schema change.
- **Events are read live** for the range on screen and shown as **Meetings**. They are never stored. Provider calls run outside the database transaction. If a provider fails, the rest of the calendar still loads with a "couldn't reach" note.
- **Routes**: `GET /me/calendar-connections`, `GET /me/calendar-connections/:google|outlook/authorize-url`, `DELETE /me/calendar-connections/:provider`, `GET /me/calendar-connections/outlook/callback` (public; the signed state is the authorization).
- **Setup needed per deployment**:
  - **Google**: the existing `GOOGLE_OAUTH_*` variables, with the calendar.readonly scope on the consent screen.
  - **Outlook**: `MICROSOFT_OAUTH_CLIENT_ID/SECRET/TENANT` (already used for Outlook email), plus `MICROSOFT_CALENDAR_REDIRECT_URI` registered on the Entra app, with the delegated `Calendars.Read` permission.
  - A provider that isn't set up is shown, disabled, as "not set up yet".
- **Tested**:
  - unit tests for the Outlook provider path, rotated refresh tokens, the signed return-to (forged and missing state) and DST-safe local midnight
  - live API checks of the consent URL (read-only scope), the declined, failed and forged callbacks (nothing stored), an unknown provider, an unconfigured provider, and agenda behaviour when a provider is unreachable
  - web tests for the connect menu
- **Not verified here**: a real sign-in and event read against Google or Microsoft, since this sandbox has no credentials for either. That needs one check on staging once the credentials are set.
- **Limitations**:
  - the primary calendar only
  - a multi-day all-day event shows on its first day
  - personal Microsoft accounts are excluded while `MICROSOFT_OAUTH_TENANT=organizations` (the existing default)
