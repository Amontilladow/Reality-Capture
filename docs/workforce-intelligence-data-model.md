# Workforce Intelligence™ — Data Model (MVP)

Follows this repo's existing migration conventions exactly (see
`apps/api/src/database/migrations/001_initial_schema.sql`): UUID PKs via
`gen_random_uuid()`, `company_id` + `tenant_isolation` RLS policy on every
tenant table, `IF NOT EXISTS`/idempotent DDL, registered in `_migrations`.
Implemented as `apps/api/src/database/migrations/037_workforce_intelligence.sql`.

## Raw telemetry vs. derived intelligence (brief §19)

| Table | Kind | Mutability |
|---|---|---|
| `devices` | reference | mutable (heartbeat, revocation) |
| `application_registry` | reference/config | mutable (admin-managed) |
| `activities` | **raw telemetry** | insert-only; never updated by the scoring engine |
| `activity_project_attributions` | derived (but source-of-truth for "current best guess") | replaceable (re-attribution upserts) |
| `productivity_scores` | **derived intelligence** | recalculable — a formula-version change deletes and re-inserts by `model_version`, never an in-place UPDATE of history |
| `workforce_privacy_settings` | config | mutable, admin-managed, changes audit-logged like every other sensitive action in this codebase |

## Extensibility decisions (deliberate — brief §10/§11 "do not blindly
hardcode, design extensible")

- `activities.activity_type` and `application_registry.category`/
  `discipline` are `VARCHAR`, not Postgres enum types. A Postgres enum
  would need a migration to add a value — the opposite of "extensible."
  Validity is enforced at the API layer (`class-validator` `@IsIn(...)`
  against a `const` array in `packages/types`), which can grow without a
  schema migration. `application_registry.category`/`discipline` aren't
  even a fixed whitelist — brief §11 explicitly calls for a
  *configurable* registry, so these are free text set by whoever manages
  the registry (`company_admin`+), exactly like the brief's own example
  list ("BIM", "Documentation", "Collaboration") is illustrative, not
  exhaustive.
- `application_registry.productivity_classification` and
  `activity_project_attributions.method` *are* validated against small,
  stable vocabularies (`productive|neutral|unproductive|unclassified` and
  the brief §12 mechanism list respectively) because the scoring engine's
  logic branches on these values — growing the vocabulary is a deliberate
  code change to the scoring engine anyway, not something that should
  silently vary per company.

## Schema

### `devices`
Enrolled desktop/agent endpoints. `user_id` is the primary owner (a device
is enrolled *by* someone); MVP has no shared-workstation modeling.

```
id, company_id, user_id, platform (windows|macos|linux|web),
hostname, device_fingerprint (hashed, not raw hardware id),
agent_version, enrolled_at, last_seen_at, is_active, revoked_at,
revoked_by, created_at
```

### `application_registry`
Per-company, admin-managed. No global/system rows in MVP — each company
starts empty and populates it (a future seed script can pre-populate
common construction/engineering tools per brief §11's example list, but
that's a convenience, not a schema requirement).

```
id, company_id, name, match_pattern (executable name or pattern, e.g.
"revit.exe", matched by the agent), category, discipline (nullable),
productivity_classification (productive|neutral|unproductive|unclassified,
default 'unclassified'), engineering_relevance (boolean),
is_active, created_by, created_at, updated_at
UNIQUE (company_id, match_pattern)
```

### `activities` — raw, immutable
```
id, company_id, user_id, device_id (nullable — null for seed/manual
entries), client_event_id (nullable — the agent's idempotency key),
application_id (nullable FK to application_registry — null until
matched), application_name_raw (always stored, even unmatched),
domain (nullable), activity_type (VARCHAR, see extensibility note),
started_at, ended_at, duration_seconds, source
(agent|browser_extension|manual|seed|import), confidence (nullable,
0-1 — confidence in the activity_type classification itself, distinct
from project-attribution confidence below), raw_metadata (JSONB),
window_title (nullable VARCHAR(500), migration 042 — only ever populated
when workforce_privacy_settings.window_title_enabled was on and this row
isn't 'PRIVATE' at the moment of ingest; enforced in
ActivitiesService.insertOne() regardless of what any client sends),
created_at
UNIQUE (device_id, client_event_id) — the idempotency guarantee: a
retried ingestion batch after a dropped connection upserts onto the
same row instead of duplicating (brief §30's duplicate-event test).
Partial (WHERE both NOT NULL) since manual/seed rows have neither.
Indexes: (company_id, user_id, started_at DESC) — the hot query path
for "my activity this week" and for productivity aggregation.
```

### `activity_project_attributions` — which project this activity belongs to
Kept separate from `activities` rather than as columns on it: attribution
can be revised (a better signal arrives later, or a user corrects a
mis-attribution) without ever mutating the immutable raw row.

```
id, company_id, activity_id (FK, UNIQUE — one current attribution per
activity), project_id, confidence (0-1, required, never omitted),
method (manual_selection|task_context|file_path|bim_model_metadata|
document_metadata|browser_context|integrated_system|ai_inference),
evidence (JSONB — e.g. {"activeBimModel":"AMWF","activeTask":"AMWF-142"}),
attributed_by (nullable — set for manual_selection, null for inferred),
attributed_at
```

`confidence = 1.0` only for `manual_selection` (a human said so) or an
unambiguous single-project company. Every inferred method starts below
1.0 — MVP's `task_context` inference is a simple "does this user have
exactly one project with an active/assigned task right now" check, scored
accordingly; it never asserts certainty it doesn't have.

### `productivity_scores` — derived, versioned, recalculable
```
id, company_id, user_id, project_id (nullable — null means the
all-projects rollup for that user/period), period_type (day|week),
period_start, period_end, score (0-100), factors (JSONB — the
mandatory breakdown per brief §14, e.g.
{"utilization":0.82,"engineeringShare":0.61,"topApplications":[...]}),
model_version (e.g. "v1"), calculated_at
Index: (company_id, user_id, period_type, period_start).
No DB-level UNIQUE — the service owns recompute semantics (delete rows
for a given user/project/period/model_version, then re-insert), so a
formula change is always a full, auditable replacement rather than a
silent in-place drift.
```

A score is **never** returned by the API without its `factors` — there is
no "just give me the number" endpoint, by design (brief §14).

### `workforce_privacy_settings` — one row per company
```
id, company_id (UNIQUE — same one-row-per-tenant pattern as
company_subscriptions), monitoring_level (minimal|standard|detailed,
default 'standard'), screenshot_enabled (boolean, default false — a real
capture pipeline now exists in apps/agent's screenshot cycle, gated
entirely behind this switch and enforced server-side in
ScreenshotsService.assertScreenshotsEnabled(), regardless of what any
client believes its own config says), window_title_enabled (boolean,
default false, migration 042 — same off-by-default/server-enforced
treatment as screenshot_enabled, for the desktop agent's window-title
capture; see ActivitiesService.insertOne()), retention_days (default 90),
self_view_enabled (boolean, default true — an admin can turn off
employee self-view only if company policy requires it, but it defaults
on because brief §16 treats employee self-view as core, not optional),
updated_by, updated_at, created_at
```

`keystroke logging` has no column at all in MVP — there is no partial
feature to gate; per brief §9/§18 it's treated as a hypothetical future
capability requiring its own explicit architectural/privacy work if ever
proposed, not a flag to ship half-built today.

## Row-Level Security

All six tables get the identical pattern from migration `001`:
`ALTER TABLE ... ENABLE ROW LEVEL SECURITY` +
`CREATE POLICY tenant_isolation ... USING (company_id = current_setting('app.current_company_id', true)::UUID)`.
No new tenancy mechanism.

## Scale notes (brief §26)

`activities` is the only high-write table. At MVP/V1 scale (tens to low
hundreds of employees) a single table with the
`(company_id, user_id, started_at DESC)` index is sufficient. The schema
is written so that range-partitioning by `started_at` (month) is a
non-breaking `ALTER` later — no foreign key or application code assumes
a single physical table — deferred until real volume justifies the
operational overhead of partitioning, per brief §19's ask to identify the
scaling strategy without necessarily implementing it before it's needed.
