# Workforce Intelligence™ — API (MVP)

Follows existing conventions exactly: REST, `/api/v1` prefix (global,
already configured), `Authorization: Bearer <JWT>`, response envelope
`{ data, error }` (`{ data, meta, error }` for paginated lists), NestJS
guards in the existing order (`JwtAuthGuard` → `PendingApprovalGuard` →
`RolesGuard` → `ProjectPermissionGuard`, already registered globally in
`app.module.ts` — workforce controllers add no new guard). Every
controller is gated `@RequireFeature('workforce')` at class level,
exactly like `BimController` uses `@RequireFeature('bim')`.

Not nested under `/projects/:projectId/*` — workforce data is
company-scoped by default (an employee, a device); project is a field on
an activity's attribution, not a URL segment, since a single device's
activity stream spans many projects in a day.

## Devices — `apps/api/src/modules/workforce/devices`

| Method | Path | Auth | Notes |
|---|---|---|---|
| `POST` | `/api/v1/workforce/devices` | any authenticated user | Self-enrolls a device (`companyId`/`userId` from JWT, never from body). Body: `{ platform, hostname, agentVersion?, deviceFingerprint? }`. |
| `GET` | `/api/v1/workforce/devices` | any authenticated user | Own devices only, unless caller's `companyRole` weight ≥ `company_admin`, in which case all company devices — a service-level scoping decision (brief's `view_own` vs. `manage_devices`), not a new guard. |
| `POST` | `/api/v1/workforce/devices/:deviceId/heartbeat` | owner or `company_admin`+ | Updates `last_seen_at`/`agent_version`. 404s (not 403) if the device belongs to another company, per existing tenancy convention (RLS already makes cross-tenant rows invisible). |
| `DELETE` | `/api/v1/workforce/devices/:deviceId` | owner or `company_admin`+ | Sets `is_active=false`, `revoked_at`, `revoked_by`. Never a hard delete — device history stays queryable against past activity rows. |

## Application registry — `apps/api/src/modules/workforce/applications`

| Method | Path | Auth | Notes |
|---|---|---|---|
| `GET` | `/api/v1/workforce/applications` | any authenticated user | Read-only reference data (used by the self-view dashboard to label activity). |
| `POST` | `/api/v1/workforce/applications` | `@Roles('company_admin')` | Create a registry entry. |
| `PATCH` | `/api/v1/workforce/applications/:id` | `@Roles('company_admin')` | Partial update. |
| `DELETE` | `/api/v1/workforce/applications/:id` | `@Roles('company_admin')` | Soft delete (`is_active=false`) — existing activity rows keep their `application_id` reference. |

## Activities — `apps/api/src/modules/workforce/activities`

| Method | Path | Auth | Notes |
|---|---|---|---|
| `POST` | `/api/v1/workforce/activities/ingest` | any authenticated user | **The agent's endpoint.** Body: `{ activities: [{ clientEventId?, deviceId?, applicationNameRaw, activityType, domain?, startedAt, endedAt, rawMetadata? }, ...] }`, batch (capped, e.g. 500/request). Always writes under the caller's own `userId`/`companyId` — an agent authenticates as the user it's enrolled for; it cannot post activity for anyone else. Idempotent on `(deviceId, clientEventId)`: a repeat of an already-seen pair is a no-op, not an error and not a duplicate row (brief §30). |
| `GET` | `/api/v1/workforce/activities/me?from=&to=&groupBy=application\|activityType` | self only | Returns the raw list plus a breakdown (used by the self-view dashboard's app/activity-type charts). No endpoint anywhere returns another user's raw activity without an elevated role — there is no "view team activity" endpoint in MVP (V1 scope). |
| `POST` | `/api/v1/workforce/activities/:activityId/attribute` | self only, on own activity | Body: `{ projectId }`. Always recorded as `method: 'manual_selection'`, `confidence: 1.0`, `attributedBy: <self>` — a human said so, so it's the one case confidence is asserted rather than computed. |

## Productivity — `apps/api/src/modules/workforce/productivity`

| Method | Path | Auth | Notes |
|---|---|---|---|
| `GET` | `/api/v1/workforce/productivity/me?periodType=day\|week&periodStart=YYYY-MM-DD` | self only | Computes (or returns the already-computed) score for that period under the current `model_version`, **always** with `factors` in the response — there is no bare-score response shape (brief §14). Computing is idempotent: re-requesting the same period recomputes from current `activities` data and replaces the stored row for that `model_version`, it never appends a duplicate. |

MVP intentionally ships no manager/PM/department dashboards
(`/workforce/productivity/team`, `/project/:id`, etc.) — V1 per the
implementation plan. Adding them later is additive (new endpoints, new
`@RequireProjectPermission`/`@Roles` gates), not a breaking change to
anything above.

## Privacy settings — `apps/api/src/modules/workforce/privacy`

| Method | Path | Auth | Notes |
|---|---|---|---|
| `GET` | `/api/v1/workforce/privacy-settings` | any authenticated user | Employees can see what policy applies to them — itself a trust feature (brief §17), not just an admin tool. |
| `PATCH` | `/api/v1/workforce/privacy-settings` | `@Roles('company_admin')` | Body: `{ monitoringLevel?, screenshotEnabled?, retentionDays?, selfViewEnabled? }`. Added to the existing global `AuditInterceptor`'s route map (`apps/api/src/common/interceptors/audit.interceptor.ts`) as `workforce.privacy_settings_updated` — the one small, additive edit this feature makes to a shared file, matching the existing pattern where every other module registers its own routes in that same map. No guard/RBAC logic in that file is touched. |

## Validation

Every DTO uses `class-validator`, matching existing DTOs
(`create-issue.dto.ts` etc.): `@IsIn([...])` against the `const` arrays in
`packages/types/src/workforce.types.ts` for closed vocabularies
(`platform`, `productivityClassification`, `method`), `@IsDateString()`
for timestamps, `@IsUUID()` for references, array-length caps on the
ingestion batch to bound request size.

## Error shape

Unchanged from the rest of the API: NestJS's `GlobalExceptionFilter`
already normalizes to `{ data: null, error: { code, message } }`. A
`@RequireFeature('workforce')` failure returns the existing
`PaymentRequiredException` (402) shape used by `bim`/`ai` today — no new
error type introduced.
