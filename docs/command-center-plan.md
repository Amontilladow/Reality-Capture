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
