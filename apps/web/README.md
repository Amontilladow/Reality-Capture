# EngineeringOS — Reality Capture Web App

React + TypeScript + Vite + Tailwind frontend for the Reality Capture Module.

## Stack
- Vite + React 18 + TypeScript (strict)
- Tailwind CSS — custom "blueprint" design tokens in `tailwind.config.js`
- React Router v6 for routing, Zustand for auth session state
- TanStack Query for server state / caching
- `react-hook-form` for forms, `react-dropzone` for upload UI
- `three` for the 360° equirectangular viewer, `pdfjs-dist` for floor plan rendering
- `@engineeringos/types` (workspace package) — single source of truth for API contracts

## Run locally
From the monorepo root, with the API already running on `:3000`:

```
pnpm install
pnpm dev:web
```

The dev server runs on `http://localhost:5173` and proxies `/api/*` to
`http://localhost:3000` (see `vite.config.ts`), so no CORS setup is needed in dev.

## What's implemented
- **Auth**: Login, Accept Invitation, Forgot Password, Reset Password — JWT session
  held in Zustand + localStorage, axios interceptor auto-refreshes on 401.
- **Project browser**: list + create projects, subscription usage panel.
- **Project detail**: building → level → location hierarchy tree (expand/add nodes inline),
  capture grid filtered by selected location.
- **Capture upload**: drag-drop modal → `POST /captures/upload-url` → direct `PUT` to
  S3/MinIO → `POST /captures` to register. Per-file progress bars.
- **360° viewer**: Three.js equirectangular sphere, drag to look around, scroll to zoom
  (via FOV), clickable hotspot markers (info/annotation/issue/navigation), navigation
  hotspots jump between captures/locations.
- **Floor plan viewer**: pdf.js renders the drawing PDF to canvas, SVG overlay draws
  capture pins at their normalized coordinates; "place pin" mode links a selected
  capture to a clicked point on the plan.

## Not yet built (out of scope for this pass)
Issues, BIM viewer, and project timeline have nav placeholders removed until those
screens are scoped — the API supports them (see `packages/types/src/issue.types.ts`,
`bim.types.ts`) but no UI was requested for this task.

## Notes on the API contract
Every request/response type is imported from `@engineeringos/types` — never redefined
locally. If you add a new screen that needs a field the API doesn't return yet, add it
to the shared package first so the backend and frontend stay in sync.
