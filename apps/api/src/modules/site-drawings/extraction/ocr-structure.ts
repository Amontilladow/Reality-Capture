// Engineering improvement assignment, Phase 2: gives the OCR fallback
// the same row/column structural awareness the embedded-text path
// already has from pdf-parse's vector-geometry table detection (see
// pdf-text-extractor.ts's own comment on PdfTextResult.tableRows).
// OCR has no vector draw operators to scan for a bordered grid -- the
// only real geometric evidence Tesseract gives is each recognized
// word's own (left, top, width, height) bounding box (image_to_data,
// now returned by the ai-service's /ocr/extract-text alongside its
// existing flat text). This reconstructs the SAME string[][] shape
// extractTitleBlockFieldsFromCells() already consumes, purely from that
// word-box geometry, so the embedded-text path's entire label/value
// matching engine is reused completely unchanged -- no new matching
// logic, no duplicated regex set.
//
// Validated against a real Tesseract run (not assumed): a synthetic
// title-block fixture with a label-above-value field ("Title:" /
// "Single Leaf Steel Door") and a small revision-history table
// ("Rev. | Date | Reason For Issue"), fed through actual pytesseract
// image_to_data output. Two things confirmed by hand, not guessed:
// (1) row separation by vertical bounding-box overlap correctly keeps
// a label and the value stacked directly beneath it on separate rows
// even with tight line spacing (13px gap between a 17-22px-tall label
// and the value below it); (2) Tesseract's own block_num/par_num
// grouping is NOT reliable for this -- it split "Title:" and "Single
// Leaf Steel Door" into two different blocks despite them being
// visually one field, so row/column reconstruction here is done purely
// from raw (left, top, width, height) geometry, ignoring Tesseract's
// own block/paragraph/line assignment entirely.
export interface OcrWord {
  text: string;
  left: number;
  top: number;
  width: number;
  height: number;
  conf: number;
}

// Two words on the same visual row are merged into one cell ("Drawing"
// + "No:" -> "Drawing No:") when the horizontal gap between them is
// small relative to their own text height; a gap at or beyond this
// ratio is read as a real column boundary instead ("No:" + "Rev:" on
// the same row, 209px apart at ~16-22px tall, must stay two separate
// cells, not one run-on string). 1.3 is the midpoint of what was
// actually observed on the validation fixture above: every genuine
// same-field word gap measured well under 1.0x height (0.41-0.75x);
// every genuine column boundary measured well over 1.3x height
// (1.97x and up). This is an empirically-grounded starting point, not
// a benchmarked constant -- Phase 3's real drawing set is what should
// confirm or retune it.
const CELL_GAP_HEIGHT_RATIO = 1.3;

function wordsOverlapVertically(a: OcrWord, b: OcrWord): boolean {
  const aBottom = a.top + a.height;
  const bBottom = b.top + b.height;
  return a.top < bBottom && b.top < aBottom;
}

// Groups words into rows by vertical (top/bottom) bounding-box overlap
// alone -- never by Tesseract's own line_num/par_num/block_num (see this
// file's own header comment on why those don't reliably track a title
// block's actual visual rows). A row's own span is the union of every
// word added to it, so a row of words at slightly different heights
// (common with mixed label/value font sizes on the same line) still
// groups correctly as long as each new word overlaps the row's
// accumulated span, not just its very first word.
function groupIntoRows(words: OcrWord[]): OcrWord[][] {
  const sorted = [...words].sort((a, b) => a.top - b.top || a.left - b.left);
  const rows: OcrWord[][] = [];
  let currentRow: OcrWord[] = [];
  let rowTop = 0;
  let rowBottom = 0;

  for (const word of sorted) {
    if (currentRow.length === 0) {
      currentRow = [word];
      rowTop = word.top;
      rowBottom = word.top + word.height;
      continue;
    }
    const rowSpan: OcrWord = { ...word, top: rowTop, height: rowBottom - rowTop };
    if (wordsOverlapVertically(word, rowSpan)) {
      currentRow.push(word);
      rowTop = Math.min(rowTop, word.top);
      rowBottom = Math.max(rowBottom, word.top + word.height);
    } else {
      rows.push(currentRow);
      currentRow = [word];
      rowTop = word.top;
      rowBottom = word.top + word.height;
    }
  }
  if (currentRow.length > 0) rows.push(currentRow);
  return rows;
}

// Within one row (already top-to-bottom grouped), splits left-to-right
// into cells: consecutive words merge into the same cell (space-joined,
// preserving reading order) until a gap wide enough to read as a real
// column boundary.
function splitRowIntoCells(row: OcrWord[]): string[] {
  const sorted = [...row].sort((a, b) => a.left - b.left);
  const cells: string[] = [];
  let currentCellWords: string[] = [];
  let previousWord: OcrWord | null = null;

  for (const word of sorted) {
    if (previousWord) {
      const gap = word.left - (previousWord.left + previousWord.width);
      const threshold = Math.max(previousWord.height, word.height) * CELL_GAP_HEIGHT_RATIO;
      if (gap >= threshold) {
        cells.push(currentCellWords.join(' '));
        currentCellWords = [];
      }
    }
    currentCellWords.push(word.text);
    previousWord = word;
  }
  if (currentCellWords.length > 0) cells.push(currentCellWords.join(' '));
  return cells;
}

// The one entry point: a flat list of OCR word boxes (any order; this
// sorts internally) in, a string[][] pseudo-table out -- the exact same
// shape pdf-text-extractor.ts's own tableRows produces, so
// extractTitleBlockFieldsFromCells() needs no changes at all to accept
// either source.
export function buildPseudoTableFromOcrWords(words: OcrWord[]): string[][] {
  if (words.length === 0) return [];
  return groupIntoRows(words).map(splitRowIntoCells);
}
