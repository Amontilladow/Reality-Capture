# EngineeringOS — REMAINING_WORK.md

Priority order. Each item includes estimated complexity, dependencies,
and risks.

---

## 1. Issue Management integrated into the BIM viewer (NEXT OBJECTIVE)

**Complexity: Medium-High.**

Requirements (from the original phase spec, not yet built):
- GUID reference, camera position, screenshot capture
- Priority, status, assignee, due date, comments, attachments, history
- Reopening an issue must restore the exact camera view it was created from

**Dependencies:**
- Issues backend already exists and is frozen/working (creation,
  assignment, activity log) — this is additive, not a rebuild.
- Needs a way to capture the `@thatopen/components` camera state
  (position/target/zoom) from `BimViewer.tsx` — the component doesn't
  currently expose this; will need a new imperative method (e.g.
  `getCameraState()`/`setCameraState()`) alongside the existing
  `fitToModel()`/`selectByGuid()`.
- Screenshot capture: `world.renderer.three.domElement.toDataURL()` (or
  similar) — needs verification against `@thatopen/components`' actual
  renderer setup; not yet checked.
- Attachments likely reuse the existing document/capture storage pattern
  (S3-compatible storage, presigned URLs) rather than inventing a new one.

**Risks:**
- Camera-state serialization format needs to be stable/versioned since
  it'll be stored in the database and replayed later — get this right
  the first time rather than needing a migration later.
- No browser tool available to verify screenshot capture or camera
  restoration actually work visually — same limitation documented
  throughout this handover.

---

## 2. Dashboard KPIs

**Complexity: Medium.**

Requirements: Active Projects, Processing Queue, Import History, Open/
Closed Issues, Recently Updated Models, Activity Feed.

**Dependencies:**
- All underlying data already exists (projects, bim_models with status,
  issues with status, notifications/audit log for activity feed) — this
  is primarily aggregation queries + new frontend page, not new backend
  data model work.
- Currently `/projects` (ProjectList) is the landing page; decide whether
  the dashboard replaces it, precedes it, or is a separate route.

**Risks:** Low — mostly additive UI work over existing data.

---

## 3. ~~Reality Capture (image) processing~~ — Shipped

Real thumbnail/rendition pipeline (`sharp` + `exifr`, embedded in
`apps/api`, not a standalone service — resolves the open architecture
question below in favor of the faster-to-ship option) now generates
thumbnail_sm/thumbnail_lg/preview and validates/extracts EXIF GPS. See
`apps/api/src/modules/captures/processors/image-processing.processor.ts`
and its test suite. Video captures still pass straight through with no
thumbnailing — out of scope (would need ffmpeg).

---

## 4. AI search/assistant live verification

**Complexity: Low (if network access changes), otherwise blocked.**

Code exists (`apps/ai-service/app/routers/{search.py,assistant.py}`),
statically reviewed as sound. Qdrant itself is confirmed reachable in
this sandbox (downloaded via GitHub release binary — `dl.min.io` is
blocked but `release-assets.githubusercontent.com` is not). The embedding
step (`sentence-transformers` → HuggingFace model download) is blocked
because `huggingface.co` is outside this sandbox's network allowlist.

**Dependencies:** Either a network allowlist change, or a pre-cached
embedding model bundled into the environment.

**Risks:** None from a code-correctness standpoint — this is purely an
environment/verification gap, not a known defect.

---

## 5. Export functionality

**Complexity: Unknown — not yet investigated at all.**

**Dependencies:** None known yet — first step is investigation/scoping,
not implementation.

**Risks:** Unknown until scoped.

---

## 6. Extended BIM viewer features

**Complexity: Medium-High, several independent sub-features.**

Not built (explicitly out of scope for the v0.1 RC, not silently
stubbed): walk/first-person mode, section planes/box, explode, isolation,
hide/show, transparency, storey/discipline/category filter toggles.

**Dependencies:** Builds directly on the existing `BimViewer.tsx`
foundation (`@thatopen/components` world/camera/fragments setup already
in place). Each of these is a real, separately-scoped feature — recommend
tackling one at a time with its own verification pass, not as one large
batch.

**Risks:** `@thatopen/components`' API surface for these features hasn't
been explored yet in this project — budget time for the same kind of
empirical API verification (checking installed `.d.ts` files, writing
small test scripts) that was needed for the core viewer, rather than
assuming the API matches other ThatOpen tutorials exactly (version drift
is real — this project is on `3.4.7`/`3.4.6`).

---

## 7. UX polish

**Complexity: Medium, spans many small items.**

Dark/light mode, accessibility pass, mobile layouts, keyboard shortcuts,
additional empty states, loading skeletons beyond what exists.

**Dependencies:** None blocking — can be done incrementally alongside
other feature work rather than as one big effort.

**Risks:** Low individually; the main risk is scope creep if treated as
one undifferentiated task rather than broken into specific, verifiable
pieces.

---

## Cross-cutting: Browser-level verification

**Not a feature — a verification gap that applies to all frontend work
done in this environment.** No browser or screenshot tool is available.
Every piece of frontend work in this project has been verified via
typecheck, production build, dev-server module transforms, and live API
contract checks — but never via actual rendering or interaction. Strongly
recommend a human or browser-automation pass before/alongside any of the
above, especially before the BIM viewer is considered fully production-
verified.
