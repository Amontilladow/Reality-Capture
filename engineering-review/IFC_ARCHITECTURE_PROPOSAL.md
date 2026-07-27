# IFC Parsing Architecture Proposal — EngineeringOS Reality Capture

Status: **Awaiting approval. No implementation started.**

## Scope of the decision

`BimService.registerModel()` currently has a single commented-out line
where IFC parsing should happen. This proposal covers: which library
parses the file, where it runs, and how the results (geometry, object
properties, quantities) get into Postgres and the AI search index. It does
**not** cover BIM authoring, clash detection algorithms, or viewer UX —
those are downstream of this decision, not part of it.

## Candidates evaluated

### 1. `web-ifc` (That Open Company, formerly IFC.js)

- **License**: MPL-2.0 — permissive, file-level weak copyleft. Safe for a
  closed-source commercial SaaS: you can link it into proprietary code
  without open-sourcing your application; only modifications to
  `web-ifc`'s own files would need to be shared.
- **Parsing speed**: C++ compiled to WASM, runs at near-native speed.
  Public benchmarks and community reports consistently show it opening
  large files (hundreds of MB) in single-digit seconds where IfcOpenShell
  takes tens of seconds to minutes on the same file.
- **Memory**: WASM linear memory is more constrained than a native
  process, but the library is specifically engineered for the browser's
  memory ceiling, which makes it efficient server-side too (same binary,
  more headroom).
- **Multi-GB files**: raw `web-ifc` still loads a full model into memory
  like any IFC parser — it does not itself solve multi-GB streaming. That
  Open Company's companion tool, **Fragments**, converts a parsed IFC
  model into a compact streamable binary specifically to solve this
  (typically a large reduction in in-browser memory footprint, loaded
  progressively). Recommendation below treats parsing and
  streaming-delivery as two separate concerns, both solved inside the same
  ecosystem.
- **Federated models**: not natively multi-model-aware inside one file
  (no IFC file format is), but because parsing and Fragment-generation are
  both fast and run per-file, federating multiple discipline models into
  one project view is a straightforward aggregation at the application
  layer (multiple `bim_models` rows already exist in the schema for this).
- **Stack fit**: pure JS/WASM, runs directly inside a Node/NestJS process
  — no second runtime, no cross-service RPC, no serialization overhead.
  Fits directly into a Bull processor the same way
  `image-processing.processor.ts` already works for captures.
- **Object properties & quantities**: full support for reading
  `IfcPropertySet` and `IfcElementQuantity` — everything needed for
  `bim_elements` population and quantity takeoff.
- **Roadmap / momentum**: actively released through 2026 (latest tag
  `0.77`, March 2026), and the wider That Open ecosystem is visibly
  investing in the web-native/streaming direction industry-wide commentary
  points to (including competitors' own roadmap posts framing this as
  where the field is headed).
- **Maturity**: production-proven — this is the engine behind most
  IFC-in-the-browser tools in the current BIM tooling ecosystem, not an
  experimental library.

### 2. IfcOpenShell (Python, C++/OpenCascade core)

- **License**: LGPL — also usable in a commercial product (dynamic
  linking doesn't require open-sourcing your app), but LGPL obligations
  are more commonly a legal-review trigger than MPL-2.0, and Python
  packaging/redistribution of an LGPL native extension needs more careful
  handling than an MPL WASM module.
- **Parsing speed**: consistently and substantially slower than
  alternatives on large files in independent benchmarks and the
  project's own open GitHub issues — file-opening on 200–700MB files
  reported taking a large fraction of total processing time, with
  third-party comparisons showing multi-minute opens where competing
  approaches finish in seconds.
- **Correctness/completeness**: this is IfcOpenShell's real strength — the
  most complete and battle-tested IFC schema coverage of any open-source
  library, including full geometry kernel support (OpenCascade) for
  arbitrary solid operations. If EngineeringOS ever needs full
  boundary-representation geometry export or IFC *authoring* (writing
  valid IFC back out, not just reading), this is the only candidate that
  does that well today.
- **Stack fit**: Python. The NestJS API would either need to shell out to
  a Python subprocess per file, or route parsing through the existing
  Python `ai-service` — adding a cross-service call into what is currently
  a synchronous-feeling BIM registration flow owned entirely by
  `apps/api`. Workable, but it's a second moving part and a second
  deployment/scaling concern for a feature that otherwise has no reason to
  leave the Node process.
- **Multi-GB / memory**: no built-in streaming story; large files are
  reported as a known pain point in the project's own issue tracker.

### 3. `ifc-lite-core` (Rust → WASM, newer entrant)

- **License**: needs direct confirmation before any commercial use — not
  verified in this pass.
- **Parsing/geometry speed**: the project's own claims are strong (STEP
  tokenization near 1.2 GB/s, full parse near 50 MB/s, native geometry
  reported faster than `web-ifc` on much of its benchmark corpus), and it
  specifically targets streaming first-render for large files, which is
  the multi-GB story `web-ifc` alone doesn't have.
- **Maturity**: this is a genuinely new project (recent activity, small
  install base relative to `web-ifc`/IfcOpenShell). Promising design, but
  no production track record to point to yet. Betting v1.0 on it carries
  real risk: fewer eyes have found its edge cases, and its API surface
  could still change.
- **Recommendation**: not for v1.0. Worth a follow-up evaluation once it
  has a longer track record — flagged in the backlog as a future
  enhancement, not discarded.

### 4. xBIM (.NET)

- Reported faster than IfcOpenShell in some third-party comparisons, but
  requires a .NET runtime in a stack that has none anywhere else
  (NestJS/Node + Python). Introducing a third language runtime purely for
  one feature is a much larger operational cost than the benefit justifies
  here. Not evaluated further for that reason.

## Comparison summary

| Criterion | web-ifc | IfcOpenShell | ifc-lite-core |
|---|---|---|---|
| Parsing speed (large files) | Fast (native-speed WASM) | Slow on large files (documented) | Claims fastest, unproven at scale in production |
| Memory footprint | Good, browser-optimized | Higher, no streaming | Designed for streaming |
| Multi-GB handling | Via companion Fragments format | Weak — known pain point | Native design goal |
| License risk | Low (MPL-2.0) | Medium (LGPL + Python packaging) | Unconfirmed |
| Stack fit (Node/NestJS) | Native — same runtime | Needs cross-service call | Native (WASM) |
| Object properties/quantities | Full support | Full support (best schema coverage) | Supported, less battle-tested |
| Federated models | App-layer aggregation, straightforward | Same | Same |
| Maturity/production track record | High | Highest | Low — too new |
| IFC authoring (write-back) | Limited | Best-in-class | Limited |
| Cloud deployment | Trivial (WASM in any Node container) | Needs native deps in image | Trivial (WASM) |

## Recommendation

**`web-ifc`, run server-side inside `apps/api` as a new Bull processor**
(structurally mirroring `captures/processors/image-processing.processor.ts`),
paired with **Fragments conversion** for large/multi-model delivery to the
web and mobile viewers.

Reasoning, in priority order:

1. **Stack fit is the deciding factor for v1.0.** Every other completed
   module lives inside `apps/api`'s Node process. IfcOpenShell would be
   the only feature requiring a cross-service Python round trip for a
   core, synchronous-feeling user action (uploading a BIM model). That's
   added operational surface (scaling, deployment, failure modes) for a
   feature that doesn't need it.
2. **License is the safest of the three or four options** for a
   closed-source commercial SaaS being sold to construction enterprises,
   some of whom will have their own legal review of the vendor's stack.
3. **Performance is not just adequate but a genuine win** — the exact
   documented weakness of the strongest alternative (IfcOpenShell on large
   files) is `web-ifc`'s strength, and multi-GB/large-model handling is a
   real requirement here given construction BIM models routinely exceed
   several hundred MB.
4. **It doesn't foreclose IfcOpenShell later.** If a future requirement
   needs full IFC *authoring* (round-tripping edits back into valid IFC,
   not just reading), that's a genuinely different capability this
   recommendation doesn't try to solve — and adding IfcOpenShell as a
   second, specialized service at that point remains straightforward,
   because nothing here is exclusive.
5. **`ifc-lite-core` is the one to watch, not adopt yet.** Its numbers are
   compelling but it's too new to bet a v1.0 launch on. Revisit in a
   future quality/enhancement pass once it has more production mileage.

## What this does NOT decide yet

- Exact Fragments storage format/location (S3 alongside the original IFC,
  presumably — to be confirmed against the existing capture-rendition
  pattern once approved).
- Whether quantity takeoff results get their own table or extend
  `bim_elements` — a schema question for the implementation phase, not the
  library choice.
- Timeline/effort estimate for implementation — will follow once scope is
  confirmed.

## Requesting approval

Please confirm `web-ifc` + Fragments is the right call before I install
anything or touch `BimService`. If approved, implementation proceeds as
the next backlog item exactly as scoped in
`engineering-review/MASTER_BACKLOG.md`.
