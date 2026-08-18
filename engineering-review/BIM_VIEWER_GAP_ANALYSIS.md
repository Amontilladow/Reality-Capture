# BIM Viewer Gap Analysis — xeokit-sdk / engine_components / engine_fragment vs. our viewer

Status: **Analysis only. No code changed.**

## Scope and method

Compared our BIM viewer (`apps/web/src/components/bim-viewer/BimViewer.tsx`, 302
lines, plus the server-side fragments generation in
`apps/ifc-service/src/ifc/ifc-fragments.service.ts`) against three reference
codebases, shallow-cloned and read directly (not from memory of docs/tutorials,
which our own `KNOWN_ISSUES.md` already warns can drift from the exact pinned
versions we run):

| Repo | Cloned at | Our pinned version | License |
|---|---|---|---|
| `xeokit/xeokit-sdk` | HEAD (2.6.112) | not a dependency — architecture reference only | MIT |
| `ThatOpen/engine_components` (`@thatopen/components`) | HEAD (3.4.0) | **3.4.7** (already a direct dependency) | MIT |
| `ThatOpen/engine_fragment` (`@thatopen/fragments`) | HEAD (3.4.7) | **3.4.6** (already a direct dependency, used both client- and server-side) | MIT |

**Both ThatOpen repos are libraries we already ship.** This is the single most
important framing fact in this whole analysis: most of what follows isn't "should
we adopt a new library," it's "we already have this code installed and are
calling a small fraction of its public API." xeokit-sdk is architecturally
unrelated (its own scene graph, own picking/culling/loading stack) and is not a
candidate for adoption — it's useful here only as an independent second opinion
on how a mature BIM-viewer SDK solves the same nine problems, and as a source of
patterns/algorithms worth studying even though its code itself isn't a drop-in.

Three research subagents were dispatched in parallel to do this reading
first, but all three hit this session's usage limit before producing findings
(genuine capacity failure, not a design problem with the approach) — the rest
of this document is LEAD's own direct reading of the same three repos,
file-by-file, with concrete citations, done as the fallback rather than waiting
for a session reset.

Every finding below is cited to a real file in the cloned repo, read directly.

---

## Finding zero, because it changes how to read everything after it

**We are not using the update loop `@thatopen/fragments` is designed around.**
The library's own canonical example
(`engine_fragment/packages/fragments/src/FragmentsModels/example.ts:67,78-87`)
wires exactly two things after loading a model:

```js
world.camera.controls.addEventListener("update", () => fragments.update());
// ...on each model load:
model.useCamera(world.camera.three);
fragments.update(true);
```

Our `BimViewer.tsx` calls neither. We call `fragments.core.load()` once, read
`model.box` once for the initial `fitToBox`, and never touch `update()` or
`useCamera()` again for the life of the component (`Hider.set()` in
`engine_components` also calls `fragments.core.update(true)`, but we don't use
`Hider` either, so in our shipped code `update()` never runs after the first
implicit call inside `load()`).

Tracing what `update()`/`useCamera()` actually drive
(`engine_fragment/.../model/view-manager.ts:27-97` and
`.../multithreading/thread-controllers/thread-view-refresher.ts`) shows this
isn't a minor omission: `useCamera()` registers the live camera; every
`update()` recomputes the real view frustum
(`frustum.setFromProjectionMatrix(...)`), camera position, FOV, active clipping
planes, an estimated device GPU capability
(`view.graphicThreshold = GPU.estimateCapacity()`), and a per-model
`graphicsQuality` setting, packages all of it into a `REFRESH_VIEW` request, and
sends it to the worker thread, which uses it to decide **which geometry tiles
to stream in, at what resolution, and which to cull** — off the main thread.
There is also an explicit `setLodMode(model, lodMode)` API
(`view-manager.ts:43-47`) for controlling LOD behavior per model.

None of this ever fires in our viewer. Practically: our viewer loads whatever
resolution/tile set the very first (pre-camera) refresh produced and then
never refines it — not on zoom, not on pan, not on orbit. For a small model
this is invisible. For a large model, this is very likely the single biggest
performance lever available, and it costs a few lines of code because the
mechanism is already fully built and already running in our own dependency
tree.

This finding sits underneath the LOD, Culling, and Streaming sections below
rather than being repeated three times — treat "wire the camera update loop"
as the load-bearing prerequisite for all three.

---

## 1. Camera

**Ours:** `OBC.OrthoPerspectiveCamera` with `camera-controls`
(`BimViewer.tsx:139,154,171`) — orbit only. Two real bugs already found and
fixed this session (`dollyToCursor`, `infinityDolly` — see the code comments
at `BimViewer.tsx:144-171`). `fitToBox`, `getCameraState`/`setCameraState` for
issue-linked view restoration, `getScreenshotDataUrl`.

**What's already installed and unused:** the exact class we instantiate,
`OrthoPerspectiveCamera`, ships with three navigation modes, not one —
`OrbitMode`, `FirstPersonMode`, `PlanMode`
(`engine_components/.../OrthoPerspectiveCamera/index.ts:5-11,76-91`), switched
with a single call: `camera.set("FirstPerson")`. This is exactly the "walk
mode" our own `BimViewer.tsx:46` docstring lists as not implemented — and it's
not a gap in the library, it's a gap in wiring. `PlanMode` is a bonus we didn't
even know to ask for: floor-plan-style top-down navigation, useful for a
construction app specifically. The class also has its own `fit(meshes)` helper
(`index.ts:122-`) roughly equivalent to what we hand-roll via
`controls.fitToBox`.

**xeokit's approach (contrast only):** no dedicated first-person mode found in
the plugin list; xeokit expects `CameraControl` + manual eye/look/up
manipulation for anything beyond orbit. Not a stronger offering here — our
existing dependency is ahead of xeokit on this specific point.

**Gap:** walk/first-person and plan navigation modes — **available, not wired
up.**
**Effort:** Low (S). Add a UI toggle, call `camera.set(mode)`. No new geometry
processing, no worker changes. The main real work is deciding on/testing
collision behavior in FirstPersonMode (does it clip through walls? — needs a
direct check before shipping, not assumed).
**Reuse vs. scratch:** 100% reuse.

---

## 2. Rendering

**Ours:** `OBC.SimpleRenderer` — a plain Three.js `WebGLRenderer` wrapper, no
post-processing (`BimViewer.tsx:138`).

**engine_components:** a distinct, more capable renderer exists —
`PostproductionRenderer`
(`engine_components/packages/front/src/core/PostproductionRenderer/`), with
`edge-detection-pass.ts` and `simple-outline-pass.ts` — real post-processing
passes for edge/outline rendering (the "highlighted-object outline" and
"crisp edges on shaded geometry" look most professional BIM viewers have and
ours currently doesn't). This lives in the separate `packages/front` (not
`packages/core`), so it's a different import (`@thatopen/components-front`,
confirm the actual published package name before depending on it) — worth
flagging as a distinct dependency decision, not just an import change.

**xeokit's approach (contrast):** `FastNavPlugin`
(`xeokit-sdk/src/plugins/FastNavPlugin/FastNavPlugin.js:1-90`) is a genuinely
different idea worth borrowing even though the code itself doesn't port:
while the camera is actively moving, it hides edges/SAO/PBR/transparency and
optionally downscales the canvas resolution (`scaleCanvasResolutionFactor`),
then restores full quality after a configurable idle delay. This is a
main-thread renderer-settings toggle, trivial to reimplement against any
Three.js renderer (ours included) regardless of which BIM library is
underneath — it doesn't require adopting xeokit at all.

**Gap:** no edge/outline post-processing; no interaction-responsive quality
throttling.
**Effort:** Post-processing via `PostproductionRenderer` — Medium (M): new
package, new render pass wiring, visual QA. Interaction-quality throttling
(FastNav-style) — Low (S): reimplement the idea (pixel ratio downscale +
"is camera currently moving" flag from `controls.addEventListener('control'/'controlend', ...)`)
directly against our existing `SimpleRenderer`, no new dependency.
**Reuse vs. scratch:** post-processing = reuse (new ThatOpen package); quality
throttling = re-implement the idea from scratch (xeokit's code isn't portable
to our renderer, but the technique is simple enough not to need it to be).

---

## 3. LOD

**Ours:** whatever LOD the very first, pre-camera `refreshView` produces at
load time — see Finding Zero. No visible per-distance detail switching after
that, because the mechanism that would drive it is never invoked again.

**What's already installed and unused:** real, tunable, per-model LOD —
`view.graphicQuality = model.graphicsQuality * -1.5 + 2` and
`setLodMode(model, lodMode)`
(`engine_fragment/.../model/view-manager.ts:43-47,93`) — sent to the worker on
every `update()`. The `Clipper` component's own code comments
(`engine_components/.../Clipper/index.ts:304-307`) confirm there are
literally separate **"LOD line materials"** for far-distance geometry (a
simplified line/wireframe representation swapped in at distance, not just
"fewer tiles loaded") — this is genuine multi-representation LOD, not only
progressive streaming.

**xeokit's contrast:** no dedicated LOD *system* found as a separate
plugin — xeokit's own compact `.xkt` format and quantized geometry are its
primary large-model strategy, with `FastNavPlugin` (above) providing the
"look worse while moving" fallback instead of true geometric LOD swapping.
So on pure LOD sophistication, our own dependency (`@thatopen/fragments`) is
already ahead of xeokit — we're just not using it.

**Gap:** LOD exists, is sophisticated, and is inert in our app.
**Effort:** Low (S) — this is Finding Zero's wiring, plus optionally exposing
`setLodMode`/`graphicsQuality` as a user-facing quality setting.
**Reuse vs. scratch:** 100% reuse.

---

## 4. Culling

**Ours:** whatever Three.js's default per-`Mesh` frustum culling does
automatically (never disabled, never customized) — no application-level
culling logic exists in `BimViewer.tsx`.

**What's already installed and unused:** the same `refreshView` mechanism
computes a real `THREE.Frustum` from the live camera every `update()` call
(`view-manager.ts:134-145`) and sends it to the worker
(`thread-view-refresher.ts:20-23`), which uses it to decide what to stream —
this **is** the culling system, and it's currently never fed a live camera
(Finding Zero again).

**xeokit's contrast — a genuinely different technique worth knowing about:**
`ViewCullPlugin` (`xeokit-sdk/src/plugins/ViewCullPlugin/ViewCullPlugin.js:1-90`)
builds its own **kd-tree** (bounding volume hierarchy) over every `Entity`,
rebuilds the view frustum on every camera-matrix change, and on every scene
"tick" walks the kd-tree to mark objects `culled=true/false`. This is
CPU/main-thread, entity-granular (not tile-granular), and fully independent of
loading/streaming — a genuinely different architecture from fragments'
worker-side, tile-granular approach. Neither is strictly "better" — xeokit's
is finer-grained (per-object) and immediate (no worker round-trip); fragments'
is coarser (per-tile) but offloads the frustum test itself to a worker and
ties directly into what/whether geometry has even been *loaded* yet, which a
post-hoc CPU culler over already-loaded entities can't do.

**Gap:** same as LOD — the capability exists and is unused. A kd-tree/
occlusion-style *additional* culler on top (xeokit-style) is a separate,
larger undertaking with no ThatOpen equivalent found.
**Effort:** Wiring the existing mechanism — Low (S), same fix as Finding Zero.
A xeokit-style additional entity-level kd-tree culler on top — Large (L), and
lower priority: our library's tile-level culling already gets most of the
practical benefit for a BIM-model use case (as opposed to xeokit's
"thousands of individually clickable furniture items in a huge facilities
model" use case, which is what actually motivated `ViewCullPlugin`).
**Reuse vs. scratch:** wiring = reuse; kd-tree culler = would be built from
scratch (xeokit's implementation isn't portable — different scene graph,
different `Entity` model — though the *algorithm* is well-documented and could
be reimplemented against Three.js objects directly if ever needed).

---

## 5. Selection

**Ours:** single-click CPU raycast via `fragments.raycast()`
(`BimViewer.tsx:191-226`), with a 13-point offset retry ring for thin
elements — a real, already-tested workaround for a real problem (conduit/
rebar/cable being a couple of pixels wide). Single highlight color via
`fragments.highlight()`/`resetHighlight()`. No multi-select, no box-select, no
isolate/hide-others in the viewer itself (though `Hider.isolate()`, below,
already exists and is unused).

**What's already installed and unused:**
- **Isolation**: `Hider.isolate(modelIdMap)`
  (`engine_components/.../fragments/Hider/index.ts:57-63`) — hides everything
  except the given selection, in two lines. `Hider.toggle()`/`.set()` for
  general show/hide, `Hider.getVisibilityMap()` to query current state. This
  is the entire "isolate"/"hide selected" feature our own docstring lists as
  not implemented, already sitting in `node_modules`.
- Where our raycast actually runs: `FragmentsManager.raycast()`
  (`engine_components/.../FragmentsManager/index.ts:115-153`) delegates,
  per-model, to `model.raycast()`/`model.raycastWithSnapping()` — confirmed
  this happens **on the worker thread**
  (`engine_fragment/.../multithreading/thread-controllers/thread-raycaster.ts`
  exists as a dedicated thread controller), not a main-thread CPU raycast
  against live Three.js geometry the way a plain `THREE.Raycaster` would do
  it. Our own 13-point retry-ring workaround is layered on top of this and
  stays exactly as necessary/valid either way — this doesn't change that
  finding, just explains why a single ray already costs a worker round-trip.

**xeokit's contrast — a real gap, on both sides:** `MarqueePicker`
(`xeokit-sdk/src/extras/MarqueePicker/MarqueePicker.js:1-50`) is genuine
box/marquee multi-select — drag a rectangle, CAD-standard
left-to-right-intersects vs. right-to-left-contains convention, CTRL for
additive multi-pick, kd-tree accelerated. **Nothing equivalent exists in
`engine_components` or `engine_fragment`** (checked: no marquee/box-select
component in either `packages/core` or `packages/front`). This is a real,
build-from-scratch item regardless of which BIM library we're on.

**Gap:** isolation — available, not wired up (trivial). Box-select — not
present anywhere in our stack, would be new code.
**Effort:** Isolation — Low (S), a UI button and two `Hider` calls. Box-select
— Medium (M): screen-space marquee rect → per-model bounding-box/position
query (`FragmentsManager.getBBoxes()`/`getPositions()`, already available,
`engine_components/.../FragmentsManager/index.ts:155-206`) → intersect test.
Doesn't need a new kd-tree from scratch since our own element counts are
almost certainly smaller than xeokit's target "thousands of furniture items"
scale — a brute-force per-visible-element bbox test against the marquee
rectangle is likely fine to start, with the kd-tree only becoming worth
adding if it measurably isn't.
**Reuse vs. scratch:** isolation = reuse. box-select = mostly new code, built
on top of already-available bbox/position query primitives; the *pattern*
(not the code) can be borrowed from xeokit's docs/example for the
left-to-right vs. right-to-left convention.

---

## 6. Clipping

**Ours:** none. Explicitly listed as not implemented
(`BimViewer.tsx:46`), confirmed again in `KNOWN_ISSUES.md:228-229`.

**What's already installed and unused:** `Clipper`
(`engine_components/.../core/Clipper/index.ts:1-541`) is a complete,
production-grade, interactive clipping-plane component — click-to-create a
plane from a raycast hit (`create()`, line 340), drag-to-reposition
(`onBeforeDrag`/`onAfterDrag` events), delete/delete-all, a visible colored
plane gizmo with configurable size/opacity/material, and — critically — it's
**already camera-and-clip-plane aware inside the fragments worker**: the
`ViewManager` we read for Finding Zero already collects
`getClippingPlanesEvent()` and forwards clip planes to the worker
(`view-manager.ts:8,94,115-124`), and `Clipper`'s own code comments
(`Clipper/index.ts:296-317`) explicitly describe applying clipping to "LOD
line materials" too, so a clip plane correctly cuts every LOD representation,
not just the highest-detail one. Multiple `Clipper` planes = a de facto
section box (create several planes, no separate "box" API needed). A
companion `ClipStyler`
(`engine_components/packages/front/src/core/ClipStyler/src/clip-edges.ts`)
renders the actual cut-line/cap edges at the intersection — the visual
"section cut" look, not just an invisible clip.

**xeokit's contrast:** `SectionPlanesPlugin` and
`FaceAlignedSectionPlanesPlugin` exist and are broadly equivalent in concept
(interactive plane widgets, drag-to-reposition) — xeokit is not ahead of our
own dependency here; if anything `Clipper`'s explicit LOD-material and
worker-integration awareness is more sophisticated than what a quick read of
xeokit's plugin suggested (not deeply read given the time budget — flagged as
"observed, not confirmed" per this repo's own investigation standards; worth
a closer look only if `Clipper` turns out to have some gap `SectionPlanesPlugin`
doesn't).

**Gap:** entirely available, entirely unused. This is very likely the single
best effort-to-impact ratio in this whole analysis — a fully-built,
interactive, worker-integrated feature that our own docstring already flags
as the top deferred item.
**Effort:** Low–Medium (S/M). The component itself is zero-effort (import,
instantiate, wire a "create plane" toolbar button + delete button). The
work is UI: a plane-list panel, drag affordance is already built in, `ClipStyler`
for the cut-edge visual is a second small import. No worker/backend changes
needed at all — this is 100% client-side wiring against an existing
dependency.
**Reuse vs. scratch:** 100% reuse.

---

## 7. Worker lifecycle

**Ours:** one worker per `BimViewer` mount, created via
`fragments.init(await OBC.FragmentsManager.getWorker())`
(`BimViewer.tsx:232`), torn down via `components.dispose()` in the effect
cleanup (`BimViewer.tsx:282`). No pooling across multiple viewer instances
(not currently a problem — we only ever mount one viewer at a time — but
worth stating precisely rather than assuming).

**Confirmed from source, not docs:**
- `FragmentsManager.getWorker()` (`engine_components/.../FragmentsManager/index.ts:24-26`)
  delegates to `FRAGS.FragmentsModels.getWorker()`, whose own doc comment
  (`engine_fragment/.../FragmentsModels/index.ts:41-49`) says plainly: **it
  fetches the worker script from unpkg at runtime** and caches the resulting
  blob URL. This is a real, concrete production consideration our app
  currently inherits silently: every fresh page load's *first* model load
  makes an external network request to a third-party CDN before the viewer
  can initialize. `new FragmentsModels(workerUrl)` also accepts a
  self-hosted URL directly — self-hosting the worker file (copy it into our
  own `apps/web` build output, point at that instead) removes this external
  dependency entirely and is a small, mechanical change.
- The actual worker entry point is
  `engine_fragment/.../FragmentsModels/src/multithreading/fragments-thread.ts` —
  a single `FragmentsThread` singleton per worker, registering `globalThis.onmessage`
  gated on `typeof window === "undefined"` so the same module is safely
  importable from the main bundle too. Message protocol: monotonic `seq`
  numbers per RPC (`lastSeenSeq`, lines 14-25,49-51) so the main thread can
  implement a "wait until everything I've sent up to N is processed" fence —
  we don't currently use this fencing at all (not needed for our current
  single-load-then-idle usage pattern, but relevant context if we ever add
  rapid successive operations, e.g. fast isolate/hide toggling, that could
  race).
- Per-model lifecycle is real and granular: `disposeModel(modelId)`
  (`engine_fragment/.../FragmentsModels/index.ts:359-364`) frees one model
  without tearing down the worker/connection, and there's an explicit
  in-flight-load abort path ("Aborts an in-flight `load()`... any partial
  state (on both the main thread and the worker) is disposed" —
  `index.ts:366-374`) — none of which we use since we only ever load exactly
  one model per mount today, but both become directly relevant the moment
  multi-model support (next section) is considered.

**Gap:** no functional gap for our current one-model-per-viewer usage. Two
concrete, low-risk hardening items: (1) self-host the worker file instead of
depending on unpkg at runtime, (2) if multi-model loading is ever built, the
per-model dispose/abort APIs are already there and should be used instead of
tearing down the whole `FragmentsManager`.
**Effort:** Self-hosting the worker — Low (S), a build step to copy the
worker asset + a config change. Not urgent, but cheap enough that it's worth
bundling into whatever the first roadmap item's PR is.
**Reuse vs. scratch:** reuse (config change only).

---

## 8. Memory management

**Ours:** `components.dispose()` on unmount (`BimViewer.tsx:282`) — full
teardown, correct for our current single-model-per-mount usage, matches the
library's own intended top-level dispose path
(`FragmentsManager.dispose()`, `engine_components/.../FragmentsManager/index.ts:79-90`,
which itself calls `this.core.dispose()`).

**What's already installed and unused:** `Disposer`
(`engine_components/.../core/Disposer/index.ts:1-108`) — a generic, correct
Three.js dispose utility (geometry + material + BVH-bounds-tree + recursive
children), the same category of manual cleanup our *other* viewer
(`ThreeJsViewer.tsx`, the 360° panorama viewer, unrelated to BIM) already
hand-rolls inline. `BimViewer.tsx` currently adds nothing to the scene graph
outside of what `FragmentsManager` itself owns and disposes, so `Disposer`
has nothing extra to clean up today — but the moment any additional
Three.js objects get added directly to `world.scene.three` (e.g. clip-plane
gizmos from `Clipper` above, or a custom annotation/marker system), `Disposer`
is the correct, already-available tool rather than another hand-rolled
`geometry.dispose()`/`material.dispose()` pass.

**xeokit's contrast:** not deeply investigated given time budget (memory
management in xeokit is architecturally tied to its own `VBOSceneModel`
buffer-sharing scheme, which has no equivalent shape in our stack) — flagged
as unread rather than assumed equivalent.

**Gap:** none currently active; a dependency to reach for as soon as
`Clipper`/annotations/any custom geometry lands (see roadmap — sequencing
matters here, `Disposer` should go in *with* `Clipper`, not after).
**Effort:** N/A today; near-zero incremental cost when bundled with whatever
first adds custom scene objects.
**Reuse vs. scratch:** 100% reuse, when needed.

---

## 9. Streaming

**Ours:** whatever `.frag` loading does by default —
`apps/ifc-service/src/ifc/ifc-fragments.service.ts:9-27` calls
`new IfcImporter().process({ bytes: data })` with zero custom options. We do
not tune anything about how the generated `.frag` file is structured for
streaming; we just take the importer's defaults. Client-side, `core.load()`
resolves once the model object exists, but — per our own code's comment at
`BimViewer.tsx:245-249` — the actual mesh children populate asynchronously
afterward "via an internal tile/view-refresh cycle," which we now know (per
Finding Zero) is the same camera-driven `refreshView` mechanism we never
re-trigger.

**Confirmed from source:** the `.frag` format and its worker pipeline were
purpose-built for this — our own `IFC_ARCHITECTURE_PROPOSAL.md:33,96`
independently documents that Fragments was chosen specifically because it
"specifically targets streaming first-render for large files," which the
source confirms is real, not marketing: `thread-model-creator.ts` handles
progressive model construction on the worker,
`thread-view-refresher.ts`/`view-manager.ts` (Finding Zero) drive what
streams in next based on the live camera, and `FragmentsModels` exposes an
explicit **cancel-in-flight-load** path (`index.ts:366-374`) for
back-pressure when a load is no longer wanted. `view.graphicThreshold = GPU.estimateCapacity()`
(`view-manager.ts:92`) means streaming quality is already meant to adapt to
the *viewing device's* estimated capability, not just model size — another
already-built capability we get for free the moment the update loop is
wired.

**xeokit's contrast:** its `.xkt` format is the equivalent "purpose-built
compact/streamable binary" answer to the same problem, but the streaming
*trigger* is different — xeokit's docs (per our own architecture proposal's
prior research, not re-verified line-by-line here) is more about compact
initial payload size than continuous camera-driven refinement; `.frag`'s
worker-refresh model is the more actively adaptive of the two designs.

**Gap:** the format and pipeline are already streaming-first by design; the
missing piece is, once again, Finding Zero — without the camera update loop,
"streaming" degrades to "one big load, then static," which defeats much of
the point of having chosen this format. A secondary, smaller gap: we've never
looked at whether `IfcImporter.process()` takes options that affect tiling/
quality at generation time (not confirmed either way in the time available —
worth a direct check of the importer's TypeScript types before assuming
defaults are optimal, rather than guessing).
**Effort:** Wiring the update loop — Low (S), same fix as Finding Zero
(this is genuinely one fix that resolves LOD + Culling + Streaming
simultaneously, which is why it's called out once at the top). Investigating
`IfcImporter` generation-time options — Low (S), a read-only follow-up, not
a code change by itself.
**Reuse vs. scratch:** 100% reuse.

---

## Bonus findings (outside the original 9, surfaced while reading)

- **Multi-model federation is already supported and unused.**
  `FragmentsManager`/`FragmentsModels` are built around a `list` of models
  keyed by ID, with base-coordination-matrix logic to align multiple models
  loaded together (`FragmentsManager/index.ts:59-113`). We only ever load one
  model (`modelIdRef.current = 'main'`, `BimViewer.tsx:58`). Not in scope of
  the original 9 dimensions, but directly relevant to a real BIM workflow
  (architecture + structure + MEP loaded together) and costs nothing extra to
  keep in mind while implementing any of the above, since `disposeModel`/
  per-model APIs already assume multi-model usage.
- **GPU-capability-adaptive quality is already built in and unused**
  (`GPU.estimateCapacity()`, `view-manager.ts:92`) — ties directly into the
  Finding Zero fix, no separate work needed to get it, just don't build a
  redundant device-capability detector later without checking this first.

---

## Ranked implementation roadmap

Ranked by impact-to-effort, not raw impact — a few of the highest-raw-impact
items (box-select, post-processing) rank below several near-zero-effort items
that unlock more practical value per hour spent.

| # | Item | Dimensions resolved | Effort | Reuse |
|---|---|---|---|---|
| 1 | **Wire the camera→fragments update loop** (`useCamera` + `controls` `"update"` listener + `fragments.update()`) | LOD, Culling, Streaming (Finding Zero) | **S** | 100% reuse — a few lines |
| 2 | **Add `Clipper` + `ClipStyler`** (interactive clip planes, section-box via multiple planes) | Clipping | **S/M** | 100% reuse — fully-built component |
| 3 | **Add `Hider`** (isolate / hide-show / toggle) | Selection (isolation) | **S** | 100% reuse |
| 4 | **Wire `FirstPersonMode`/`PlanMode`** on the existing camera | Camera (walk mode) | **S** | 100% reuse — verify collision behavior before shipping |
| 5 | **Self-host the fragments worker** (stop depending on unpkg at runtime) | Worker lifecycle | **S** | Reuse, config-only |
| 6 | **Interaction-responsive quality throttling** (FastNav-style: downscale/hide effects while camera is moving) | Rendering | **S** | Re-implement the *idea*, not the xeokit code |
| 7 | **Add `Disposer`, bundled with item 2 or 3** (whichever lands first and starts adding custom scene objects) | Memory management | **~0** incremental | 100% reuse |
| 8 | **Investigate `IfcImporter` generation-time options** (read-only spike, no code change) | Streaming | **S** | N/A (research) |
| 9 | **Add `PostproductionRenderer` edge/outline pass** | Rendering | **M** | Reuse, new package + wiring |
| 10 | **Box/marquee multi-select** | Selection (multi-select) | **M** | Mostly new code on top of already-available bbox/position queries; borrow xeokit's UX convention, not its code |
| 11 | **Multi-model federation in the viewer UI** (load 2+ disciplines together) | (bonus, not in original 9) | **M** | Reuse of already-multi-model-aware APIs; UI work is new |
| 12 | **Entity-level kd-tree culler on top of tile-level culling** (xeokit `ViewCullPlugin`-style) | Culling (additional layer) | **L** | Build from scratch; only pursue if #1 turns out insufficient at real scale |

**Items 1–7 are all Small effort, all high-confidence (verified against real,
current source, not documentation), and together cover 7 of the 9 requested
dimensions plus two bonus hardening items.** They do not depend on each other
and can ship independently and incrementally. Item 1 alone is the highest-
leverage single change in this analysis: it activates LOD, culling, and true
streaming behavior that already exists in a dependency we already ship, for
the cost of roughly five lines of code, and should be verified live (does
FPS/frame time on a real large model actually improve, measured, not assumed)
before being called done — per this project's own stated investigation
standards, "confirmed" requires reproduction, not a single plausible-looking
change.
