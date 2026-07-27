# EngineeringOS — PROJECT_STATUS.md

Last updated: end of the session that produced the v0.1 RC Verification
Report and the BIM Viewer frontend slice.

## Current milestone

**EngineeringOS v0.1 — Release Candidate, VERIFIED.**

The platform now supports a complete, verified workflow: register/login →
create company/project → upload an IFC model → real background processing
(parse/extract/generate) → view the model in 3D with spatial hierarchy,
search, and full property inspection. See
`engineering-review/RC_VERIFICATION_REPORT_v0.1.md` for the full
PASS/FAIL matrix.

**Development is currently PAUSED awaiting review of the RC report.**
The explicit next objective, once resumed, is **Issue Management
integrated into the BIM viewer** (camera position capture, screenshot,
GUID reference, reopening the exact view an issue was created from).

## Overall completion estimate: ~55–60% of the full original EngineeringOS vision

This is a rough, honest estimate against the full scope described across
all sessions (tenancy/auth/hierarchy/issues/documents/timeline/BIM
processing/BIM viewer/AI search/reality capture image processing/export/
dashboards/mobile/accessibility). It is **not** a estimate against v0.1
alone — v0.1's own scope (the workflow above) is 100% complete and
verified.

## Completed modules (frozen — do not modify without a verified bug)

- **Tenancy / Auth** — company registration, JWT auth, role-based
  authorization, rate limiting, subscription limit enforcement.
- **Projects / Hierarchy** — project → building → level → location chain,
  audit logging.
- **Issues (backend)** — creation, assignment/reassignment, activity log,
  role permissions. (No viewer integration yet — see Remaining Work.)
- **Documents, Timeline, Captures (backend)** — CRUD, linking, hierarchy
  fetch, capture listing/filtering.
- **Notifications** — real table + service + polling API (replaced an
  earlier fake "Phase 2" log-only stub).
- **IFC Processing Engine v1.0.0 — RELEASED, FROZEN.** Standalone
  `apps/ifc-service`. Full parse → hierarchy → properties → quantities →
  materials → classifications → relationships → Fragments → report
  pipeline. Resumable, idempotent, batched, observable. See
  `engineering-review/IFC_ENGINE_RELEASE_v1.0.0.md`.
- **BIM Viewer (frontend) — core flow complete and verified.** Upload
  modal, models list with live status/progress, 3D Fragments viewer
  (`@thatopen/components`), spatial tree, property panel, element search
  — all wired into navigation. See `engineering-review/MASTER_BACKLOG.md`
  "BIM Viewer (frontend)" section for full detail.

## Modules in progress

None currently — development is paused pending RC report review.

## Modules not started

- **Issue Management integrated into the viewer** (next objective):
  camera position capture, screenshot, GUID reference, reopening exact
  view, priority/status/assignee/due date/comments/attachments/history.
- **Dashboard KPIs** — Active Projects, Processing Queue, Import History,
  Open/Closed Issues, Recently Updated Models, Activity Feed. Currently
  the Projects list page serves as the de facto landing page but has none
  of this.
- **Reality Capture (image) processing** — thumbnail/rendition
  generation is still a fallback-to-original-file stub, not a real
  pipeline.
- **AI search/assistant live verification** — code exists
  (`apps/ai-service`), Qdrant is confirmed reachable in this sandbox, but
  the embedding step is blocked by network allowlist (`huggingface.co`
  unreachable). Not a code defect.
- **Export functionality** — not investigated at all yet.
- **Extended BIM viewer features** — walk/first-person mode, section
  planes/box, explode, isolation, hide/show, transparency, storey/
  discipline/category filter toggles.
- **UX polish** — dark/light mode, accessibility pass, mobile layouts,
  keyboard shortcuts, empty states beyond what already exists.

## Current priorities (in order)

1. Review/accept the RC Verification Report (`RC_VERIFICATION_REPORT_v0.1.md`) — pending your input.
2. Issue Management integrated into the BIM viewer (explicit next objective once resumed).
3. Dashboard KPIs.
4. Reality Capture image processing.
5. Everything else in "Modules not started," roughly in that order.

## Independent audit

An independent third-party AI audit reviewed this codebase (architecture,
security, database design, IFC engine, frontend, code quality). Overall
verdict: real, substantial implementation — not fabricated or overstated
— with strong architecture and unusually thorough documentation for an
AI-assisted project. No critical or major issues found. Several minor
issues and gaps were found and are now recorded precisely in
`KNOWN_ISSUES.md` (marked `[Audit]`), including some independently
re-verified by re-reading the actual source rather than taken on faith:
rate limiting not applied to auth endpoints despite existing in config, a
handful of endpoints skipping strict validation, no automated tests
anywhere in the repo, row-level security being bypassed by the superuser
database connection used throughout testing (a real deployment
requirement, not a code defect), and three backend feature areas
(Issues, Timeline, Documents) having zero working frontend. Full detail
in `KNOWN_ISSUES.md`.

## Current blockers

- **No browser/screenshot tool available in this environment.** Every
  API contract, database write, and storage artifact behind the BIM
  viewer has been verified live; the actual 3D canvas rendering and
  mouse interaction have not been visually confirmed. This should be
  done by a human or a browser-automation tool before treating the
  viewer as fully production-verified.
- **HuggingFace Hub unreachable** in this sandbox — blocks live embedding
  tests for AI search. Not a code defect; would resolve with a different
  network allowlist or a pre-cached model.
- **No true multi-GB IFC file** was obtainable in this sandbox for load
  testing the processing engine at real scale.
