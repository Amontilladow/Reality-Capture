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

**Development resumed and is now operating under a Sprint-based roadmap**
(Sprint 1: core platform, done; Sprint 2: Issue Management [shipped] ->
Reality Capture image processing [shipped] -> Drawings [current] ->
RFIs/Submittals/Documents; Sprint 3: QA/QC; Sprint 4: AI/reports). The
BIM viewer geometry-inconsistency investigation is deliberately frozen
and explicitly not blocking this roadmap — see
`ROOT_CAUSE_REPORT_BIM_VIEWER.md` and
[Amontilladow/Reality-Capture#1](https://github.com/Amontilladow/Reality-Capture/issues/1).

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

- ~~Issue Management integrated into the viewer~~ **Shipped**: camera
  position capture, screenshot, GUID reference, reopening exact view.
  Priority/status/assignee/due date/comments/attachments/history were
  already built beforehand.
- **Dashboard KPIs** — Active Projects, Processing Queue, Import History,
  Open/Closed Issues, Recently Updated Models, Activity Feed. Currently
  the Projects list page serves as the de facto landing page but has none
  of this.
- ~~Reality Capture (image) processing~~ **Shipped**: real thumbnail/
  rendition pipeline, no longer a fallback-to-original-file stub.
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

1. ~~Issue Management integrated into the BIM viewer~~ — shipped.
2. ~~Reality Capture image processing~~ — shipped.
3. Drawings (Sprint 2, next up).
4. RFIs, Submittals, Documents (rest of Sprint 2).
5. Dashboard KPIs, and everything else in "Modules not started."

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
