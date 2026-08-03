# bim-debug

Forensic tooling for investigating the BIM viewer's geometry/fragment pipeline
(`@thatopen/fragments` + `web-ifc`). Built during the investigation documented
in `engineering-review/ROOT_CAUSE_REPORT_BIM_VIEWER.md` — read that first for
context on *why* these exist and what they found.

These are kept as permanent assets, not one-off debug scripts. Pin exact
dependency versions in `package.json` matching whatever `apps/ifc-service`
currently uses, so results stay comparable to production.

## Node-side scripts (this directory)

Run from `tools/bim-debug/` after `pnpm install` at the repo root.

- **`generate-fragment.cjs <source.ifc> <output.frag>`** — runs the exact
  `IfcImporter.process()` code path `apps/ifc-service` uses in production, so
  you can generate a `.frag` locally, offline, from any source IFC file. Note:
  a known, real `@thatopen/fragments` bug throws
  `TypeError: Cannot read properties of null (reading 'value') at
  GridReader.getGridAxes` for files containing an `IFCGRID` — this is
  non-fatal, the `.frag` still gets written.

- **`hash-compare.cjs <file1> <file2> ...`** — prints size + SHA-256 for each
  given file. Used to check whether repeated generations of the same source
  produce byte-identical output (they currently do not — see the root cause
  report).

- **`extract-minimal-repro.cjs <source.ifc> <output.ifc> <targetGuid>`** —
  extracts a single IFC entity plus the full transitive closure of everything
  it references (geometry, placement, representation context) plus a minimal
  spatial chain (storey → building → site → project), into a small,
  standalone, still-valid IFC file. Used to build Minimal Reproducible
  Examples for upstream bug reports.

- **`extract-sized-subset.cjs <source.ifc> <output.ifc> <targetGuid> <otherElementCount>`**
  — same as above, plus the closures of the first N other building elements
  (by file order), for testing whether a bug is scale-dependent.

- **`extract-prefix-subset.cjs <source.ifc> <output.ifc> <targetGuid> <maxId>`**
  — includes every entity with STEP id ≤ `maxId`, plus whatever the target
  entity's closure needs regardless of id, guaranteeing a valid file at any
  cutoff point. Used for binary-searching a scale/content trigger.

- **`reserialize-full.cjs <source.ifc> <output.ifc>`** — re-emits every
  entity in the source file, unfiltered, through the same
  parse-then-rewrite path as the other extractors. Useful as a sanity check
  that re-serialization alone isn't the differentiator when comparing against
  a "real" reconstruction.

## Browser-side harness

Lives at `apps/web/dev-harness/repro.html` + `repro-main.ts` (needs Vite's
dev server and the app's resolved `node_modules`, so it can't live purely
under `tools/`). Excluded from production builds explicitly in
`apps/web/vite.config.ts` (`rollupOptions.input` pins `index.html` only).

```
pnpm --filter web dev
# then open http://localhost:5173/dev-harness/repro.html?file=<name>
```

`<name>.frag` must exist under `apps/web/public/repro/` (gitignored — put
your own generated fragments there; nothing here is committed).

The harness's current form does a full per-item geometry scan of the loaded
model and reports zero-geometry counts. **If you modify or reuse this
scanning logic, read the caveat below first** — getting this wrong is
exactly what produced two incorrect findings during the original
investigation.

## Critical gotcha: `getItemsGeometry()` returns a sparse array

`model.getItemsGeometry(localIds)` can return an array **shorter** than the
`localIds` array you passed in. It appears to omit entries entirely for
items with no geometry, rather than returning an empty placeholder for each
requested id.

```js
// WRONG -- silently skips (undercounts) zero-geometry items whenever the
// returned array is shorter than requested. This produced two false
// "clean" results during the original investigation.
for (const chunks of meshData) { ... }

// RIGHT -- index by what you actually asked for.
for (let j = 0; j < chunkIds.length; j++) {
  const chunks = meshData[j] ?? [];
  ...
}
```

If you're auditing this pipeline again, verify your script against this
before trusting any "zero variance" or "all clean" result.

## Known findings (see the root cause report for full detail)

- The BIM viewer's camera losing the model on extreme zoom was a real bug
  in our own code (`infinityDolly` default) — fixed, deployed, unrelated to
  the items below.
- `IFCELEMENTASSEMBLY` containers legitimately having zero geometry is
  normal IFC behavior (they're logical groupings; `Representation = $` at
  the source), not a bug.
- A real, reproducible geometry-generation gap exists: ~57% of items in a
  specific real-world structural-steel model consistently get zero
  geometry across repeated local generations. Filed upstream as
  [ThatOpen/engine_fragment#260](https://github.com/ThatOpen/engine_fragment/issues/260),
  corrected in-thread after finding the sparse-array counting bug above.
  Whether this is fully deterministic across environments (not just
  same-machine reruns) is still open — see "Still open" in the root cause
  report.
- A separate, not-yet-investigated persistent zero-geometry
  `IFCMECHANICALFASTENER` is tracked in `engineering-review/KNOWN_ISSUES.md`.
