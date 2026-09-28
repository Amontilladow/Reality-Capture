# EngineeringOS Reality Capture — CURRENT_STATUS.md

**This is the authoritative status document.** Every other file in
`engineering-review/` predates it and describes an earlier snapshot of the
codebase (mostly the "v0.1 Release Candidate" / early-Sprint-2 era). Where
they conflict with this document, this document is correct — it was
written by inspecting the current source tree and running the actual
verification commands below, not by trusting prior write-ups.

- **Review scope / commit context:** working tree of `Amontilladow/Reality-Capture`
  on branch `claude/awesome-ride-6e1dzu`, as of the verification date below.
- **Verification date:** 2026-09-28.

---

## 1. Implemented modules

All of the following exist as real NestJS modules with controllers, services,
and (for most) migrations and frontend pages — not stubs. Confirmed by
listing `apps/api/src/modules/*.controller.ts` and cross-referencing
`apps/web/src/pages/*.tsx`:

| Area | Backend | Frontend | Status |
|---|---|---|---|
| Auth (login/refresh/invite/reset) | `modules/auth` | login/invite pages | Implemented |
| Companies/projects/hierarchy | `modules/tenancy`, `modules/projects`, `modules/buildings` | ProjectsPage, hierarchy pickers | Implemented |
| Reality capture (photo/video/360°) | `modules/captures` | CapturesPage, capture grid/viewer | Implemented |
| BuildLens location timelines | `modules/timeline` | BuildLensTimelinePage | Implemented |
| IFC processing + BIM viewing | `modules/bim`, `apps/ifc-service` | BimModelsPage, BimViewerPage | Implemented; see §4 for viewer verification caveat |
| Drawings + pins | `modules/drawings` | FloorPlanViewer (grouped by building/level) | Implemented |
| Issues | `modules/issues` | IssuesPage (grouped by building/level, PDF/XLS export, reminders) | Implemented |
| Snagging | `modules/snagging` | SnaggingPage (grouped by building/level) | Implemented |
| RFIs | `modules/rfis` | RFIs pages, external access, PDF/notice letters | Implemented |
| Submittals / Transmittals / QA | `modules/submittals`, `modules/transmittals`, `modules/qa` | respective pages | Implemented |
| Documents | `modules/documents` | DocumentsPage | Implemented |
| Reports | `modules/reports` | ReportsPage | Implemented |
| Notifications / Messages / Chat | `modules/notifications`, `modules/messaging`, `modules/chat` | notification bell, chat widget | Implemented |
| Workforce / time tracking / productivity | `modules/workforce/*` (devices, activities, scheduling, screenshots, reporting-lines, privacy, productivity, reports, calendar-integration) | WorkforcePage + admin screens | Implemented |
| AI assistant / search | `modules/ai-client` + `apps/ai-service` (Python/FastAPI, Qdrant-backed RAG) | AI Assistant page | Implemented; `ANTHROPIC_API_KEY` unset in `render.yaml` today (`sync: false`, "no key configured yet, /assistant will error until one is added") |
| Native capture companion | `apps/mobile` (Expo/React Native) | n/a | Implemented as a capture-focused companion (camera, offline SQLite queue, background sync) — not full web feature parity |
| Browser extension | `apps/browser-extension` | n/a | Implemented (small, has its own `node:test` suite); not covered by any typecheck/lint/build script |
| Forensic BIM tooling | `tools/bim-debug` | n/a | Implemented; its one regression test self-skips without a real customer IFC file (`BIM_DEBUG_SOURCE_IFC` env var, not committed) — see the test file's own header comment |

The README previously described the product as "Phase 1 Foundation" with
Reality Capture, Drawings, BIM, Issues, and AI all "🔜 Next/Planned." That
was false as of this review — all of them exist and have working code
paths. See §7 for what "exists" does *not* mean here (browser/device
verification, load testing).

## 2. Partially implemented / notable gaps found in this pass

- **Presigned upload size limits still aren't enforced at the signature level anywhere,
  but real post-upload enforcement now exists for every upload family with a safe
  completion point.** `StorageService.getUploadUrl()`
  (`apps/api/src/modules/storage/storage.service.ts`) still never wires `_maxSizeBytes`
  into the `PutObjectCommand` — there is no `Content-Length-Range` condition on any
  presigned PUT URL in this codebase, and fixing that properly still means switching to a
  presigned POST policy (`createPresignedPost`), which changes the request shape every
  upload caller uses and remains too broad for a narrow pass.

  **What changed, across two corrective-blockers sprints**: `StorageService` gained
  `getObjectSize()` (a `HeadObjectCommand` against the real object) and `deleteIfExists()`
  (cleanup for a rejected upload). Every upload family that has a server-controlled
  persistence point (a create/register/update call this API itself executes after the
  client's PUT) now calls `getObjectSize()` there and rejects + deletes the object if its
  *real* size exceeds the type's limit — the client's declared size is never trusted for
  the DB row, storage-quota accounting, or the limit check itself:
  - Captures (`CapturesService.register()`) and BIM/IFC models (`BimService.registerModel()`)
    — first sprint.
  - Drawings (`DrawingsService.create()`), internal documents
    (`DocumentsService.create()` — external/metadata-only documents are correctly left
    alone, since they have no object of ours to verify), issue view-state screenshots and
    issue/RFI/snag attachments (`IssuesService.create()`/`addAttachment()`,
    `RfisService.addAttachment()`, `SnaggingService.addAttachment()`), and project/
    organization branding logos (`ProjectsService.update()`/`upsertOrganization()`,
    only when a logo/stamp value is actually present in that request) — second sprint.

  The same two sprints also added a project-(or entity-)company-ownership check to every
  one of those call sites that lacked one: `captures.controller.ts`, `bim.controller.ts`,
  `drawings.controller.ts`, `documents.controller.ts`, `issues.controller.ts`, and
  `snagging.controller.ts` have no `@RequireProjectPermission` gate on their
  upload/create/attach routes (unlike RFIs, whose attachment routes already carry
  `@RequireProjectPermission('manage_project_records')` — that path only needed the size
  fix, not a new ownership check). Verified with 47 new/updated passing tests across
  `captures.service.spec.ts`, `bim.service.spec.ts`, `drawings.service.spec.ts`,
  `documents.service.spec.ts` (new), `issues.service.spec.ts`, `rfis.service.spec.ts`,
  `snagging.service.spec.ts` (new), and `projects.service.spec.ts` (new).

  Nothing is left relying on client-declared size alone. True transport-level
  (presigned-POST signature) enforcement remains a deployment/provider-level task, not
  done here — see the note above on why that's a broader change than this pass's scope.
- **BIM model uploads had no file-extension validation before this pass.**
  Fixed here: `BimService.getModelUploadUrl()` now rejects anything but a
  `.ifc` filename before issuing a presigned URL. `NWD`/`RVT` remain valid
  `bim_models.format` *values* (a DB column, still accepted by
  `RegisterBimModelDto`) but were never actually parsed end-to-end by
  `apps/ifc-service` — its processor assumes IFC SPF syntax unconditionally
  and has no NWD/RVT code path. Restricting upload to `.ifc` does not
  remove any currently-working capability.
- **13 endpoints used inline TypeScript object types instead of DTO
  classes**, across `bim.controller.ts` (5), `buildings.controller.ts` (5),
  `drawings.controller.ts` (1), `documents.controller.ts` (1),
  `subscription.controller.ts` (1), `issues.controller.ts` (1). NestJS's
  global `ValidationPipe` (registered in `main.ts` with `whitelist: true,
  forbidNonWhitelisted: true, transform: true`) only validates parameters
  whose reflected type is an actual class — a plain inline object-literal
  type reflects as `Object` at runtime, which NestJS's `ValidationPipe`
  explicitly skips. In practice this meant these 13 endpoints accepted
  **any** JSON body shape with no type checking, no length limits, and no
  stripping of unexpected fields (confirmed concretely:
  `bim.controller.ts`'s `registerModel` had a narrower inline type than
  `BimService.registerModel()`'s own parameter type, meaning an `ifcSchema`
  field could already flow through to a raw SQL `INSERT` with zero
  validation — nothing exploited this, but nothing was stopping it either).
  **Fixed in this pass** — all 13 now use real DTO classes with
  `class-validator` decorators; see "Security changes" in the sprint
  report for the full list.
- **The `auth` rate-limit bucket existed but was never applied.**
  `app.module.ts`'s `ThrottlerModule.forRoot()` defines a stricter `auth`
  bucket (10 requests/min) alongside the `default` bucket (100/min), and
  `ThrottlerGuard` is registered globally via `APP_GUARD` — but no route
  actually referenced the `auth` bucket via `@Throttle()`, so `/auth/login`,
  `/auth/refresh`, `/auth/forgot-password`, and `/auth/reset-password` ran
  under the same 100/min limit as every other endpoint. **Fixed in this
  pass** — those four routes now carry `@Throttle({ auth: { limit: 10,
  ttl: 60_000 } })`, with a test asserting the metadata is actually
  present (`auth.controller.spec.ts`).
- **Invitation acceptance is already correct.** `AuthService.acceptInvitation()`
  uses a single atomic `UPDATE ... WHERE invitation_token = $1 AND
  invitation_expires_at > NOW() AND email_verified = false RETURNING *` —
  Postgres guarantees only one concurrent request can match that WHERE
  clause, closing the double-accept race at the database level. The
  method's own comment documents a prior version that raced (separate
  SELECT-then-UPDATE) and how it was confirmed and fixed. No change made
  here; this was verified, not assumed.
- **Root `pnpm lint` was red before this pass** — 3 pre-existing
  `@typescript-eslint/no-unused-vars` errors, unrelated to this sprint's
  own changes (`rfi-notice-letter-pdf.template.ts`: two unused brand-color
  constants; `rfis.service.ts`: an unused `pageWidth` destructure). Fixed
  (dead-code removal only, no behavior change) so a real, blocking lint
  step could be wired into CI. Two ESLint *warnings* remain in
  `apps/web` (a `react-refresh` export-shape hint in `RichTextEditor.tsx`,
  a `react-hooks/exhaustive-deps` hint in `BuildLensTimelinePage.tsx`) —
  left as-is; warnings don't fail the lint command and neither looked like
  a live bug worth a scope-creeping fix in this pass.

## 3. Authentication error disclosure — reviewed, not changed

`AuthService.login()` currently returns distinct, human-readable messages
for: wrong email/password ("Invalid email or password."), a deactivated
account ("Your account has been deactivated. Contact your administrator."),
an inactive company ("Your company account is inactive. Contact support."),
and an SSO-only account ("This account uses social login. Use the SSO
option."). This is a real trade-off, not an oversight: it reduces support
burden for confused legitimate users, at the cost of letting an anonymous
caller learn *why* a given email failed to log in (account exists but is
deactivated vs. wrong password, etc.) — a user-enumeration surface.

Per this sprint's own rules ("do not change behavior automatically; first
determine whether the product deliberately wants this"), this was left
unchanged. **This needs an explicit product decision**, not an engineering
default: collapse all four to one generic "Invalid email or password"
response (more secure, worse UX for legitimately locked-out users), or
keep the current messages (better UX, accepted enumeration risk — common
for B2B SaaS where email lists aren't public). Whoever owns that call
should make it deliberately.

## 4. Database role / row-level security — verified, documented, not changed

**Every environment in this repo — local dev, the Render production
deployment as configured, and this sprint's own test runs — connects to
Postgres as a superuser or table-owning role, not as the restricted
`app_user` role the schema defines. RLS is not currently a real security
boundary anywhere this application actually runs.**

Evidence:
- `apps/api/src/database/migrations/001_initial_schema.sql` enables RLS
  (`ALTER TABLE ... ENABLE ROW LEVEL SECURITY`) and a `tenant_isolation`
  policy on every tenant-scoped table, and separately creates a role:
  `CREATE ROLE app_user LOGIN;` with **no password**, and **no `GRANT`
  of any kind** on any table anywhere in the migration set (confirmed:
  no `GRANT ... TO app_user` exists in any of the 49 migration files).
  The only statement referencing it afterward is
  `REVOKE UPDATE, DELETE ON audit_log FROM app_user;` — revoking
  privileges it was never granted in the first place. As defined, this
  role cannot log in over password auth and would get "permission denied"
  on every table even if it could.
- `render.yaml`'s API service sets `DB_USER`/`DB_PASSWORD` via
  `fromDatabase: { name: engineeringos-db, property: user/password }` —
  Render's own auto-provisioned credentials for that managed Postgres
  instance, **not** `app_user`. Render's default database role owns the
  tables it creates (it's the role migrations run as), and Postgres RLS
  policies do not apply to a table's owner unless `FORCE ROW LEVEL
  SECURITY` is also set — which is never used anywhere in this schema.
  So even setting aside `app_user`'s missing password/grants, the
  role actually configured in production would bypass RLS entirely by
  ownership.
- Local dev (`apps/api/.env.example`, `infrastructure/docker/docker-compose.yml`)
  uses `DB_USER=postgres` — the container's own Postgres superuser.
  `docker-compose.prod.yml` sets `POSTGRES_USER: ${DB_USER}`, which makes
  *whatever* `DB_USER` is named the Postgres image's initial superuser —
  so naming it `app_user` there would not produce a restricted role either.
- `AuthService.acceptInvitation()`'s own code comment independently
  documents the same expectation from the opposite direction: it assumes
  `app_user` (no bypass RLS) is what's actually connecting in production,
  and states that invitation acceptance "is currently broken in
  production" under that assumption, since the cross-tenant lookup with no
  `app.current_company_id` session var set would match zero rows under
  real RLS enforcement. Reconciling that comment with the `render.yaml`
  evidence above: production likely does **not** hit that failure mode
  in practice, but only because RLS is bypassed by ownership, not because
  the security boundary is actually working as designed. The comment's
  premise (real RLS enforcement in production) and the actual deployment
  config disagree; this document is the reconciliation.
- Several existing code comments elsewhere in this codebase (issue
  auto-warning cron, workforce screenshot-retention cron, the new
  scheduled-reminders cron) already flag the same "cross-tenant query
  under RLS with no app_user bypass returns zero rows" concern as a known,
  documented, unfixed gap for background jobs that need to scan across
  companies. Given the evidence above, that specific failure mode is
  unlikely to manifest in the current production deployment (RLS is
  bypassed entirely), but the underlying architectural question — how a
  cross-tenant background job is supposed to authenticate once RLS *is*
  actually enforced — is still open and still worth solving before RLS is
  relied upon for real.

**What production should use, and how to verify it:** a Postgres role
that (a) can log in with a password, (b) has been explicitly `GRANT`ed
`SELECT/INSERT/UPDATE/DELETE` on the tenant tables (not table ownership),
and (c) does **not** have the `BYPASSRLS` attribute. An operator can check
role attributes directly: `SELECT rolname, rolsuper, rolbypassrls FROM
pg_roles WHERE rolname = current_user;` run as the API's actual configured
`DB_USER` — `rolbypassrls` must read `false` for RLS to mean anything.
Table ownership matters just as much as `BYPASSRLS`: `SELECT tableowner
FROM pg_tables WHERE tablename = 'issues';` should **not** match the
API's `DB_USER`.

No production credentials or infrastructure were changed to produce this
finding, and none should be changed without a deliberate, tested
migration of ownership/grants — doing this wrong (e.g., revoking access
the app actually needs) is a self-inflicted outage. This is flagged as a
priority operational item in NEXT_STEPS.md, not fixed here.

## 5. Migration behavior — documented

- Migrations live in `apps/api/src/database/migrations/*.sql`, numbered
  sequentially (currently through `049_snag_items_building_level.sql`),
  tracked in a `_migrations` table (filename + applied_at), applied via
  `apps/api/src/database/run-migrations.ts` (compiled to
  `dist/database/run-migrations.js`).
- **When they run in production:** `render.yaml`'s API service declares
  `preDeployCommand: node apps/api/dist/database/run-migrations.js` — Render
  runs this once per deploy, in the new release's own image/environment,
  **before** that release takes traffic. This directly contradicts
  `KNOWN_ISSUES.md`'s "Production deploys never run new migrations" entry,
  which is stale (that entry itself notes the underlying incident was
  "Confirmed fixed 2026-08-06"; `render.yaml`'s `preDeployCommand` appears
  to be that fix, added after `KNOWN_ISSUES.md` was last updated).
- **Startup itself does not run migrations** — `apps/api/Dockerfile`'s
  `CMD` is `node apps/api/dist/main`, nothing else. Only Render's
  `preDeployCommand` mechanism runs them, and only there. This is the
  right split: migrations are a release-gate concern, not a request-path
  concern, and re-running the API process (e.g. a crash restart) should
  never re-run schema changes.
- **Tracking:** the runner is idempotent — it reads `_migrations`, skips
  anything already applied, and inserts a row per newly-applied file
  inside the same failure-checked flow (`console.error` + `process.exit(1)`
  on any error, `sql.end()` in a `finally`). An operator can check status
  directly: `SELECT filename, applied_at FROM _migrations ORDER BY
  applied_at DESC;` — the most recent row should match the latest file in
  `apps/api/src/database/migrations/`.
- **On migration failure:** the process exits non-zero, which — per
  Render's own `preDeployCommand` semantics — blocks that deploy from
  going live at all. The previous release keeps serving traffic. No
  automatic rollback of already-applied migrations is attempted (none of
  the SQL files are written to be transactionally reversible as a set).
- **Backups/restore:** not configured or documented anywhere in this
  repository. `render.yaml`'s `engineeringos-db` declares no backup
  policy. This is a real operational gap, not verified further in this
  pass (it requires Render dashboard/account access this environment
  doesn't have) — tracked in NEXT_STEPS.md.

## 6. Workspace / tooling truth (what the root scripts actually cover)

Root `package.json`'s `typecheck`/`test`/`lint` all shell out to
`pnpm --recursive <script>`, which silently **skips** any workspace
package that doesn't declare that script — it is not an error, and it
gives no visible signal that a package was skipped. Verified directly
(`pnpm typecheck`, `pnpm test`, `pnpm lint`, `pnpm build`, each run for
real — see the Verification section of the sprint report for exact
output):

| Script | Packages it actually runs against | Packages silently skipped |
|---|---|---|
| `typecheck` | `packages/types`, `apps/api`, `apps/ifc-service`, `apps/mobile`, `apps/agent` | `apps/web` (has none — but see below), `apps/browser-extension`, `tools/bim-debug` |
| `test` | `apps/api` (Jest), `apps/ifc-service` (Jest), `apps/agent` (node:test via tsx), `apps/browser-extension` (node:test), `tools/bim-debug` (Jest, 1 spec self-skipped) | `apps/web`, `apps/mobile` |
| `build` | `packages/types`, `apps/api`, `apps/ifc-service`, `apps/web` | `apps/agent`, `apps/mobile`, `apps/browser-extension` |
| `lint` | `apps/api`, `apps/web` | `apps/ifc-service`, `apps/agent`, `apps/mobile`, `apps/browser-extension`, `tools/bim-debug` |

`apps/web` has no standalone `typecheck` script, but its `build` script
(`tsc -b && vite build`) performs the same check as a side effect — so
`pnpm build` passing is the only current signal that `apps/web`'s types
are sound. This is a real coverage gap worth closing (adding a plain
`"typecheck": "tsc -b --noEmit"`-equivalent to `apps/web/package.json`)
but was left alone in this pass to avoid touching the web build
config beyond what was needed.

`apps/web` and `apps/mobile` have **no automated test suite at all** —
this is the browser/device-verification gap the rest of this document
and NEXT_STEPS.md refer to repeatedly. No frontend testing framework
(Vitest, React Testing Library, Detox, etc.) exists in either package
today; introducing one is explicitly out of scope for this sprint (see
its own "do not implement" list) and is the single most valuable
follow-up — see the sprint report's "Recommended next step."

## 7. Known operational risks (not fixed this pass)

1. Presigned-upload size limits are not enforced at the transport
   (signature) level for any upload path — only a presigned POST supports a
   `Content-Length-Range` condition, and this codebase uses presigned PUT
   throughout (§2). Real, server-side post-upload verification against the
   actual stored object now exists for every upload family that has a
   safe, server-controlled persistence point: captures, BIM/IFC models,
   drawings, internal documents, issue screenshots, issue/RFI/snag
   attachments, and project/organization branding logos (§2). Nothing
   remains on the original "declared size only, trusted as-is" gap this
   line used to describe.
2. RLS provides no actual tenant-isolation boundary in any environment that
   currently exists (local, CI, or the `render.yaml` production config) —
   tenant isolation today rests entirely on the explicit `WHERE company_id
   = ...` clause in every query, which was spot-checked across Issues/
   Drawings/Snagging this session and appeared consistently applied, but
   was not exhaustively audited across every module (§4).
3. No backup/restore policy is documented or configured for the production
   database (§5).
4. No browser-level verification of BIM/360° viewer rendering, drawing
   pin placement, or responsive layout exists — everything in this repo's
   frontend is verified by `tsc`/`vite build` succeeding, which proves the
   code compiles, not that it renders or behaves correctly in a real
   browser (a real exception this session: the building/level grouping
   work on Floor Plans, Issues, and Snagging *was* verified against a real
   running browser via Playwright — see those PRs' descriptions — but that
   is the exception, not the rule, across this codebase).
5. No load testing exists anywhere in this repository (no k6/artillery/
   autocannon config found) — IFC processing throughput, Bull queue
   behavior under concurrent jobs, and API behavior under realistic
   concurrent load are all unverified.
6. **Fixed in the corrective-blockers sprint** (was stale here): `apps/mobile/app.json`'s
   dev-only API URL is now `expo.extra.developmentApiBaseUrl` (renamed from `apiBaseUrl`
   to make its dev-only role unambiguous from the file alone), and `src/lib/config.ts`
   resolves an explicit `EXPO_PUBLIC_APP_ENV` (development/preview/production, set per
   profile in `apps/mobile/eas.json`) and validates the API URL against it —
   rejecting empty values, localhost/loopback/emulator-host addresses, and
   `REPLACE_WITH_*`-style placeholders for preview/production, and additionally
   requiring HTTPS and rejecting bare private-network IPs for production. A prior
   version of this fix (from the launch-readiness sprint) added a `!__DEV__` throw
   check but placed it *after* a fallback to `app.json`'s hardcoded localhost value,
   which meant that fallback could still fire in a release build if
   `EXPO_PUBLIC_API_BASE_URL` weren't set — that ordering bug is what's fixed now.
   `eas.json`'s preview/production profiles no longer commit even a placeholder URL;
   the real value must be supplied via `eas env:create` (see `MOBILE_STORE_READINESS.md`).
   12 passing unit tests cover the validation logic (`apiConfigValidation.test.ts`).
7. `apps/ai-service`'s `ANTHROPIC_API_KEY` is `sync: false` with no value
   configured in `render.yaml` ("no key configured yet, /assistant will
   error until one is added") — the AI assistant feature is implemented
   but non-functional in the deployed environment as configured today.

## 8. Exact verification commands and results (this sprint)

All run from the repo root, no live Postgres/Redis/S3/Qdrant/AI credentials
available or required — every test mocks its infrastructure dependencies.

| Command | Result | Notes |
|---|---|---|
| `pnpm install --frozen-lockfile` | PASS | "Already up to date" |
| `pnpm typecheck` | PASS | 5 of 8 packages checked (see §6) |
| `pnpm test` | PASS | 8 of 8 packages with a test script ran; 249+ individual test cases passed across api/ifc-service/agent/browser-extension; 1 tools/bim-debug spec self-skipped (documented, deliberate) |
| `pnpm build` | PASS | packages/types, apps/api, apps/ifc-service, apps/web |
| `pnpm lint` | PASS (after this sprint's fixes; FAIL before) | apps/api, apps/web; 2 pre-existing warnings remain in apps/web, not errors |
| `pnpm --filter mobile typecheck` | PASS | standalone, same as the recursive run |

No e2e (`apps/api`'s `test:e2e` Jest config) run was attempted — it
requires a live database connection this environment isn't configured
to keep running persistently across a CI-style check, and was out of
scope for this sprint's "no live infra" constraint. Not claimed as
passing.
