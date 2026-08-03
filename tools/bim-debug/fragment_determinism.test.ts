/**
 * Regression test for the geometry-generation consistency finding in
 * engineering-review/ROOT_CAUSE_REPORT_BIM_VIEWER.md (Hypothesis 7).
 *
 * Blocked by upstream issue:
 * https://github.com/ThatOpen/engine_fragment/issues/260
 *
 * What this actually verifies, once enabled: that `IfcImporter.process()`,
 * run N times against the same source IFC, produces a `.frag` where every
 * fragment local id resolves to non-empty geometry via
 * `model.getItemsGeometry()` -- and that this holds identically across all
 * N runs (same set of any failures, if there are any at all).
 *
 * IMPORTANT if you're the one re-enabling this: `getItemsGeometry(ids)` can
 * return an array SHORTER than `ids` -- it omits entries for zero-geometry
 * items rather than padding them. Index by request (`meshData[j] ?? []`),
 * never `for (const x of meshData)`. Getting this wrong is exactly what
 * produced the incorrect "0 failures" result that had to be retracted
 * during the original investigation -- see README.md's "Critical gotcha"
 * section before touching this file.
 *
 * This test needs a real source IFC file, which is not committed to the
 * repo (it's a real customer file). Point BIM_DEBUG_SOURCE_IFC at a local
 * copy to run it for real; it's skipped entirely otherwise.
 */

import * as fs from 'fs';
import * as path from 'path';

const SOURCE_IFC = process.env.BIM_DEBUG_SOURCE_IFC;
const RUN_COUNT = 5;

async function generateFragment(sourcePath: string): Promise<Uint8Array> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { IfcImporter } = require('@thatopen/fragments');
  const importer = new IfcImporter();
  const wasmDir = path.dirname(require.resolve('web-ifc/web-ifc-node.wasm'));
  importer.wasm = { path: `${wasmDir}/`, absolute: true };
  const bytes = new Uint8Array(fs.readFileSync(sourcePath));
  return importer.process({ bytes });
}

function sha256(buffer: Uint8Array): string {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const crypto = require('crypto');
  return crypto.createHash('sha256').update(Buffer.from(buffer)).digest('hex');
}

/**
 * Loads a .frag buffer and returns the sorted set of local ids that have
 * zero triangles, plus the total triangle count across the whole model.
 * NOTE: this needs @thatopen/fragments' client-side FragmentsManager +
 * a Worker, which this repo has only ever exercised in a real browser
 * (see apps/web/dev-harness/). Whether @thatopen/fragments' Node story
 * supports this without a browser is unverified -- flagged here rather
 * than assumed, since asserting it works without having run it would be
 * exactly the kind of unverified claim this whole investigation was
 * about avoiding.
 */
async function verifyEveryGuidHasGeometry(_fragBuffer: Uint8Array): Promise<{
  zeroGeometryLocalIds: number[];
  totalTriangles: number;
}> {
  throw new Error(
    'Not implemented: loading .frag and calling getItemsGeometry() has only ' +
    'been exercised in a real browser in this investigation (see ' +
    'apps/web/dev-harness/repro-main.ts). Port that logic here once ' +
    '@thatopen/fragments\' Node-side loading path is confirmed to work ' +
    'without a browser, or run this check via a headless-browser test ' +
    'runner instead of plain Jest.',
  );
}

const describeOrSkip = SOURCE_IFC ? describe : describe.skip;

describeOrSkip('fragment generation determinism (blocked by engine_fragment#260)', () => {
  it.todo('produces the same zero-geometry local-id set across 5 consecutive runs');

  // Left in place, not deleted, so re-enabling this is "remove .skip /
  // replace .todo with the body below" rather than rewriting from scratch.
  // eslint-disable-next-line jest/no-disabled-tests
  it.skip('produces the same zero-geometry local-id set across 5 consecutive runs (real body)', async () => {
    if (!SOURCE_IFC) throw new Error('BIM_DEBUG_SOURCE_IFC not set');

    const runs: { hash: string; zeroGeometryLocalIds: number[]; totalTriangles: number }[] = [];
    for (let i = 0; i < RUN_COUNT; i++) {
      const fragBuffer = await generateFragment(SOURCE_IFC);
      const hash = sha256(fragBuffer);
      const { zeroGeometryLocalIds, totalTriangles } = await verifyEveryGuidHasGeometry(fragBuffer);
      runs.push({ hash, zeroGeometryLocalIds, totalTriangles });
    }

    // Total triangle count should be identical across all runs regardless
    // of anything else -- geometry isn't created or destroyed, only
    // (potentially) misattributed between items.
    for (const run of runs.slice(1)) {
      expect(run.totalTriangles).toEqual(runs[0].totalTriangles);
    }

    // The actual claim under test: the same set of items has geometry
    // (ideally: all of them) on every run.
    for (const run of runs.slice(1)) {
      expect(run.zeroGeometryLocalIds).toEqual(runs[0].zeroGeometryLocalIds);
    }

    // The end goal once the upstream bug is fixed: nothing should be
    // missing at all.
    expect(runs[0].zeroGeometryLocalIds).toEqual([]);
  });
});
