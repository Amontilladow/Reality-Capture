// Drawing Identification Engine replacement: reconstructs a title block's
// row/column structure from a flat list of text "runs" and their pixel
// bounding boxes -- regardless of whether those runs came from the PDF's
// own native text layer (apps/ai-service's pypdfium2-based extraction) or
// from targeted OCR on a cropped region (pytesseract, scoped to a
// detected title-block region, never the whole page). Both sources
// report runs in exactly the same shape (TextRun below), so this one
// function serves either -- there is no separate "OCR structure" vs.
// "native structure" reconstruction; the geometry-based grouping logic
// here doesn't care where a run's text came from.
//
// This produces the SAME string[][] shape extractTitleBlockFieldsFromCells()
// has always consumed, so that function needs no changes at all to
// accept either source -- full reuse of the existing title-block
// matching/validation engine.
//
// Originally written (and validated against a real Tesseract run) for
// OCR word boxes specifically, in the engineering improvement
// assignment's Phase 2; generalized here, with the exact same row/column
// clustering algorithm unchanged, now that apps/ai-service's native-text
// runs need the identical treatment -- a native text "run" (one line or
// contiguous text segment from the PDF's own content stream, per
// pypdfium2's own textpage.get_rect()) is geometrically no different
// from an OCR word for this purpose: both are "a piece of text with a
// bounding box," and row/column structure is purely a geometry problem.
export interface TextRun {
  text: string;
  left: number;
  top: number;
  width: number;
  height: number;
  conf: number;
  method: 'native' | 'ocr';
}

// Two runs on the same visual row are merged into one cell ("Drawing" +
// "No:" -> "Drawing No:") when the horizontal gap between them is small
// relative to their own text height; a gap at or beyond this ratio is
// read as a real column boundary instead ("No:" + "Rev:" on the same
// row, far apart, must stay two separate cells, not one run-on string).
// 1.3 is the midpoint of what was actually observed on this engagement's
// Phase 2 validation fixture: every genuine same-field run gap measured
// well under 1.0x height (0.41-0.75x); every genuine column boundary
// measured well over 1.3x height (1.97x and up). An empirically-grounded
// starting point, not a benchmarked constant -- a real-drawing benchmark
// pass is what should confirm or retune it.
const CELL_GAP_HEIGHT_RATIO = 1.3;

function runsOverlapVertically(a: TextRun, b: TextRun): boolean {
  const aBottom = a.top + a.height;
  const bBottom = b.top + b.height;
  return a.top < bBottom && b.top < aBottom;
}

// Groups runs into rows by vertical (top/bottom) bounding-box overlap
// alone. A row's own span is the union of every run added to it, so a
// row of runs at slightly different heights (common with mixed label/
// value font sizes on the same line) still groups correctly as long as
// each new run overlaps the row's accumulated span, not just its very
// first run.
function groupIntoRows(runs: TextRun[]): TextRun[][] {
  const sorted = [...runs].sort((a, b) => a.top - b.top || a.left - b.left);
  const rows: TextRun[][] = [];
  let currentRow: TextRun[] = [];
  let rowTop = 0;
  let rowBottom = 0;

  for (const run of sorted) {
    if (currentRow.length === 0) {
      currentRow = [run];
      rowTop = run.top;
      rowBottom = run.top + run.height;
      continue;
    }
    const rowSpan: TextRun = { ...run, top: rowTop, height: rowBottom - rowTop };
    if (runsOverlapVertically(run, rowSpan)) {
      currentRow.push(run);
      rowTop = Math.min(rowTop, run.top);
      rowBottom = Math.max(rowBottom, run.top + run.height);
    } else {
      rows.push(currentRow);
      currentRow = [run];
      rowTop = run.top;
      rowBottom = run.top + run.height;
    }
  }
  if (currentRow.length > 0) rows.push(currentRow);
  return rows;
}

// Within one row (already top-to-bottom grouped), splits left-to-right
// into cells: consecutive runs merge into the same cell (space-joined,
// preserving reading order) until a gap wide enough to read as a real
// column boundary.
function splitRowIntoCells(row: TextRun[]): string[] {
  const sorted = [...row].sort((a, b) => a.left - b.left);
  const cells: string[] = [];
  let currentCellText: string[] = [];
  let previousRun: TextRun | null = null;

  for (const run of sorted) {
    if (previousRun) {
      const gap = run.left - (previousRun.left + previousRun.width);
      const threshold = Math.max(previousRun.height, run.height) * CELL_GAP_HEIGHT_RATIO;
      if (gap >= threshold) {
        cells.push(currentCellText.join(' '));
        currentCellText = [];
      }
    }
    currentCellText.push(run.text);
    previousRun = run;
  }
  if (currentCellText.length > 0) cells.push(currentCellText.join(' '));
  return cells;
}

// The one entry point: a flat list of text runs (any order; this sorts
// internally) in, a string[][] pseudo-table out.
export function buildPseudoTableFromTextRuns(runs: TextRun[]): string[][] {
  if (runs.length === 0) return [];
  return groupIntoRows(runs).map(splitRowIntoCells);
}
