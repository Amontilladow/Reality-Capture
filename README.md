# EngineeringOS™ Reality Capture

A construction-project platform connecting site reality capture, spatial
context, and engineering action into one auditable workflow:

```
Capture → assign to project/location → view drawing/BIM/history context
→ create issue or snag → assign and track progress → verify with new
evidence → produce an auditable record
```

**Current status:** actively implemented, not a v1.0 foundation-phase
project. See [`engineering-review/CURRENT_STATUS.md`](engineering-review/CURRENT_STATUS.md)
for the authoritative, source-verified status of every module, including
what has and hasn't been browser/load-tested. This README gives the
architecture and local-dev setup; that document is the one to trust for
"is X actually built and does it actually work."

## Current architecture

Monorepo (pnpm workspaces):

| Path | What it is | Status |
|---|---|---|
| `apps/web` | React 18 + Vite + Tailwind SPA — the main product UI | Implemented but not browser-verified beyond the features explicitly noted in CURRENT_STATUS.md |
| `apps/api` | NestJS REST API (`/api/v1`), the system of record | Implemented |
| `apps/ifc-service` | NestJS worker consuming a Bull/Redis queue, parses IFC models into `.frag` geometry via `@thatopen/components`/`web-ifc` | Implemented |
| `apps/ai-service` | Python/FastAPI RAG service (Qdrant-backed search + an LLM assistant) | Implemented; unusable in the deployed environment today — no `ANTHROPIC_API_KEY` configured in `render.yaml` |
| `apps/mobile` | Expo/React Native field-capture companion (camera, offline SQLite queue, background sync) | Implemented, phone/tablet capture-focused; not full web feature parity |
| `apps/browser-extension` | Small browser extension | Implemented |
| `apps/agent` | Desktop workforce-activity agent (idle/active detection, screenshot capture) | Implemented |
| `packages/types` | Shared TypeScript types (`@engineeringos/types`) used by `api`/`web`/`mobile`/`ifc-service` | Implemented |
| `tools/bim-debug` | Forensic tooling for BIM geometry-pipeline regressions | Implemented; its regression test needs a real IFC fixture not committed to the repo (self-skips otherwise) |

Product modules implemented in `apps/api`/`apps/web` today (each with real
controllers/services/pages, not stubs): projects and building/level/location
hierarchy, reality capture (photo/video/360°), BuildLens location
timelines, IFC processing + BIM viewing, drawings and drawing pins, issues,
snagging, RFIs, submittals, transmittals, QA, documents, reports,
notifications/messages/chat, workforce/time tracking, and an AI assistant.
Full detail, including what's only partially wired up, is in
`engineering-review/CURRENT_STATUS.md`.

Deployment target is Render (`render.yaml`): a managed Postgres 16
instance, a Redis instance, the API as a Docker web service (with a
pre-deploy migration step), the IFC worker as a Docker background worker,
the AI service and its Qdrant vector DB as private services, and the web
app as a static site. See `CURRENT_STATUS.md` §5 for exactly when and how
migrations run in that deployment.

## Local development setup

### Prerequisites
- Node.js >= 22.13.0
- pnpm 11.15.1 (`corepack enable` or `npm install -g pnpm@11.15.1`)
- Docker Desktop (for local Postgres/Redis/MinIO/Qdrant)

### 1. Install
```bash
pnpm install
```
`postinstall` automatically builds `@engineeringos/types`, which every
other package depends on.

### 2. Environment
```bash
cp apps/api/.env.example apps/api/.env.local
# Defaults match infrastructure/docker/docker-compose.yml
```

### 3. Start infrastructure
```bash
docker compose -f infrastructure/docker/docker-compose.yml up -d
# Postgres (mapped to host port 5433, not 5432 — see the compose file's own
# comment), Redis, MinIO (S3-compatible), and Qdrant all start.
```

### 4. Run migrations
```bash
pnpm db:migrate
```
Applies every file in `apps/api/src/database/migrations/` in order,
tracked in a `_migrations` table. Safe to re-run — already-applied
migrations are skipped.

### 5. Start the API
```bash
pnpm dev:api
# http://localhost:3000, Swagger UI at http://localhost:3000/api/docs
# (Swagger is disabled when NODE_ENV=production)
```

### 6. Start the web app
```bash
pnpm dev:web
# http://localhost:5173, proxies /api to the API above (see apps/web/vite.config.ts)
```

### 7. Register a company and sign in
```bash
curl -X POST http://localhost:3000/api/v1/company/register \
  -H "Content-Type: application/json" \
  -d '{"companyName":"Demo Engineering","slug":"demo-engineering","adminEmail":"admin@demo.com","adminFirstName":"Admin","adminLastName":"User","adminPassword":"SecurePass123!"}'

curl -X POST http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@demo.com","password":"SecurePass123!"}'
# Returns accessToken — use as a Bearer token, or just sign in via the web UI.
```

## Services (local development)

| Service | URL | Credentials |
|---------|-----|-------------|
| API | http://localhost:3000 | JWT |
| Swagger | http://localhost:3000/api/docs | — |
| Web app | http://localhost:5173 | — |
| MinIO Console | http://localhost:9001 | minioadmin / minioadmin |
| Qdrant Dashboard | http://localhost:6333/dashboard | — |
| Postgres | localhost:5433 | postgres / postgres |
| Redis | localhost:6379 | — |

## Verification status

Continuous integration (`.github/workflows/ci.yml`) runs, on every PR and
push to `main`, against real repository scripts (no `|| true`, no
suppressed failures): install, build `@engineeringos/types`, typecheck,
test, build, and lint. See `engineering-review/CURRENT_STATUS.md` §6 and
§8 for exactly which packages each of those actually covers today (several
packages don't declare every script — this is documented, not hidden) and
the most recent verified pass/fail results.

**Implemented but not browser-verified:** the web app's rendering,
interaction, and responsive behavior beyond the specific features called
out as Playwright-verified in `CURRENT_STATUS.md`. Every frontend
correctness check in CI today is `tsc`/`vite build` succeeding — proof the
code compiles, not that it renders or behaves correctly.

**Implemented but not load-tested:** IFC processing at scale, Bull queue
behavior under concurrent jobs, and API behavior under realistic
concurrent request volume. No load-testing tooling exists in this
repository today.

## Known limitations

See `engineering-review/CURRENT_STATUS.md` (current, verified) and
`engineering-review/NEXT_STEPS.md` (prioritized follow-ups) for the full,
current list. Headline items:
- Presigned upload URLs don't enforce their declared size limits at the
  storage layer (a real, cross-cutting gap — not yet fixed).
- Postgres row-level security is not a real security boundary in any
  environment this app currently runs in (production included, as
  configured in `render.yaml`) — tenant isolation rests on application-level
  `WHERE company_id = ...` filtering today. See `CURRENT_STATUS.md` §4.
- No automated frontend or mobile test suite exists yet.
- The AI assistant has no API key configured in the current production
  deployment config.

## Deployment

Render, via `render.yaml`: push to the connected branch, or trigger a
manual deploy from the Render dashboard. Migrations run automatically as
a pre-deploy step, before the new release takes traffic (see
`CURRENT_STATUS.md` §5 for the exact mechanism). This document does not
cover changing production credentials, environment values, or
infrastructure — those require direct access to the Render dashboard and
are intentionally outside the scope of anything automated in this repo.
