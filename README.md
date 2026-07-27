# EngineeringOS™ Reality Capture Module

Architecture Specification v1.1 — Phase 1 Foundation

## Quick Start (5 minutes)

### Prerequisites
- Node.js >= 20
- pnpm >= 9 (`npm install -g pnpm`)
- Docker Desktop

### 1. Clone and install
```bash
cd engineeringos-reality
pnpm install
```

### 2. Environment
```bash
cp apps/api/.env.example apps/api/.env.local
# Edit .env.local if needed — defaults work with docker-compose
```

### 3. Start infrastructure
```bash
docker compose -f infrastructure/docker/docker-compose.yml up -d
# Postgres, Redis, MinIO (S3), Qdrant all start
# First start auto-runs 001_initial_schema.sql
```

### 4. Verify database
```bash
# Connect to Postgres and check tables
docker exec -it engineeringos-postgres psql -U postgres -d engineeringos -c "\dt"
# Should show all 34 tables
```

### 5. Start the API
```bash
pnpm dev:api
# API runs on http://localhost:3000
# Swagger UI at http://localhost:3000/api/docs
```

### 6. Register first company
```bash
curl -X POST http://localhost:3000/api/v1/company/register \
  -H "Content-Type: application/json" \
  -d '{
    "companyName": "Demo Engineering",
    "slug": "demo-engineering",
    "adminEmail": "admin@demo.com",
    "adminFirstName": "Admin",
    "adminLastName": "User",
    "adminPassword": "SecurePass123!"
  }'
```

### 7. Sign in
```bash
curl -X POST http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "admin@demo.com", "password": "SecurePass123!"}'
# Returns accessToken — use as Bearer token for all subsequent requests
```

---

## Architecture

See `docs/architecture/` for full Architecture Specification v1.1.

## Phase Status

| Phase | Status |
|-------|--------|
| 0 — Architecture | ✅ Complete |
| 1 — Foundation | ✅ Complete |
| 2 — Reality Capture MVP | 🔜 Next |
| 3 — Drawing + BIM | 🔜 Planned |
| 4 — Timeline + Issues | 🔜 Planned |
| 5 — AI Layer | 🔜 Planned |
| MVP Gate | 🔜 Planned |

## Services (local development)

| Service | URL | Credentials |
|---------|-----|-------------|
| API | http://localhost:3000 | JWT |
| Swagger | http://localhost:3000/api/docs | — |
| MinIO Console | http://localhost:9001 | minioadmin / minioadmin |
| Qdrant Dashboard | http://localhost:6333/dashboard | — |
| Postgres | localhost:5432 | postgres / postgres |
| Redis | localhost:6379 | — |
