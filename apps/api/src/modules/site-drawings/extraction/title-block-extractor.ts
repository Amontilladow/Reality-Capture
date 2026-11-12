import type { ExtractedDrawingFields } from '@engineeringos/types';

// Common title-block field patterns (brief section 3/Decision 3: "support
// common drawing-number, title, revision and date patterns... do not
// assume all consultants use the same title-block layout"). Deliberately
// NOT a per-project configurable layout editor in this first release
// (Decision 3): these are the patterns that show up across most
// consultant-issued construction drawings regardless of discipline.
//
// Every pattern here is matched against the WHOLE page's extracted text
// (embedded or OCR'd), not a cropped title-block region; this release
// has no layout-position awareness, so a drawing number/revision that
// appears only in a different context (e.g. referenced in a general note)
// could occasionally be picked up. That risk is exactly why extraction
// never writes straight to the authoritative fields and is always scored
// by confidence (section 3: "AI may assist with extraction, but it must
// not invent missing values; flag uncertain... fields for review").

interface FieldMatch {
  value: string;
  confidence: number;
}

// Drawing numbers in construction practice are short, structured codes:
// discipline letter(s), separators, a sheet number, e.g. "A-101",
// "S-2.03", "M4-C-0012", "ARC-00-101". Anchored to an explicit label when
// one is present (higher confidence); a bare pattern anywhere in the text
// scores lower, since it's more likely to be a false positive.
const DRAWING_NUMBER_LABELED = /(?:drawing|dwg|sheet)\s*(?:no\.?|number|#)\s*[:\-]?\s*([A-Z0-9][A-Z0-9\-./]{2,19})/i;
// Two shapes, tried in order: the short "LETTERS-DIGITS" code
// (`A-101`, `S-2.03`) common on simpler consultant title blocks, and a
// longer multi-segment code (`M19-M4C-C0-PW-AX-SD-05713`) common on
// larger CAD-template-driven projects -- at least 3 dash-separated
// segments total, so an incidental two-word hyphenated phrase elsewhere
// on the page ("AS-BUILT") doesn't false-positive as a drawing number.
const DRAWING_NUMBER_BARE = /\b([A-Z]{1,4}-\d{1,4}(?:\.\d{1,2})?|[A-Z0-9]{1,8}(?:-[A-Z0-9]{1,8}){2,8})\b/i;

const REVISION_LABELED = /\brev(?:ision)?\.?\s*(?:no\.?)?\s*[:\-]?\s*([A-Z0-9]{1,3})\b/i;

// A table-grid title block commonly puts a field's label and its value in
// two ADJACENT cells (a label cell beside, or above, an otherwise-blank
// value cell) rather than both in one cell -- confirmed by hand against a
// reproduction fixture built with a real bordered grid. These match a cell
// that is NOTHING BUT the label itself (anchored start-to-end, so a cell
// that happens to contain both label and value text together is left to
// the *_LABELED patterns above instead). Paired with the next cell in
// pdf-parse's getTable() flattening, which walks a table row by row,
// left to right -- the same order a label-then-value pair appears in.
const DRAWING_NUMBER_LABEL_ONLY = /^(?:drawing|dwg|sheet)\s*(?:no\.?|number|#)\s*[:\-]?$/i;
const REVISION_LABEL_ONLY = /^rev(?:ision)?\.?\s*(?:no\.?)?\s*[:\-]?$/i;
const TITLE_LABEL_ONLY = /^(?:drawing\s*)?title\s*[:\-]?$/i;

// Separator kept optional (`[:\-]?`, not `[:\-]`): a common CAD
// title-block layout prints "Drawing Title" as its own label line with
// the actual title directly below it on the next line, no colon or dash
// at all. `\s*` already spans the newline between them (JS `\s` matches
// `\n`), so this one change is enough to capture that layout -- the
// mandatory separator was the entire reason it previously returned
// nothing for an unmistakably present, clearly labeled title.
const TITLE_LABELED = /(?:drawing\s*)?title\s*[:\-]?\s*([^\n\r]{3,120})/i;

// Common construction date formats: 12/03/2025, 12-03-2025, 2025-03-12,
// 12 Mar 2025, March 12, 2025.
const DATE_PATTERNS: RegExp[] = [
  /\b(\d{4}-\d{2}-\d{2})\b/,
  /\b(\d{1,2}[/\-]\d{1,2}[/\-]\d{4})\b/,
  /\b(\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{4})\b/i,
  /\b((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+\d{4})\b/i,
];

const DISCIPLINE_LABELS: Record<string, string> = {
  A: 'Architectural', S: 'Structural', M: 'Mechanical', E: 'Electrical',
  P: 'Plumbing', C: 'Civil', L: 'Landscape', FP: 'Fire Protection',
};

function matchLabeled(text: string, pattern: RegExp, confidence: number): FieldMatch | null {
  const match = pattern.exec(text);
  return match ? { value: match[1].trim(), confidence } : null;
}

// A real drawing number always contains at least one digit (a sheet
// number, revision index, or project code segment). Embedded-text
// extraction order isn't guaranteed to match the title block's visual
// layout (confirmed by hand against a CAD-style fixture whose label and
// value text runs are written to the PDF content stream in two separate
// passes): the token immediately following a "Drawing No:" label can
// turn out to be an unrelated all-letters word from a totally different
// field ("Checked", "Approved") that happened to land next to the label
// once stream order and visual order diverge. Rejecting a labeled match
// with no digits at all and falling through to the bare pattern catches
// exactly that failure mode without needing real layout/position data.
function isPlausibleDrawingNumber(value: string): boolean {
  return /\d/.test(value);
}

function extractDrawingNumber(text: string): FieldMatch | null {
  const labeled = matchLabeled(text, DRAWING_NUMBER_LABELED, 0.85);
  if (labeled && isPlausibleDrawingNumber(labeled.value)) return labeled;
  return matchLabeled(text, DRAWING_NUMBER_BARE, 0.55);
}

function extractDiscipline(drawingNumber: string | undefined): string | undefined {
  if (!drawingNumber) return undefined;
  const prefix = drawingNumber.match(/^([A-Z]{1,2})-/)?.[1];
  return prefix ? DISCIPLINE_LABELS[prefix] : undefined;
}

function extractDate(text: string): string | undefined {
  for (const pattern of DATE_PATTERNS) {
    const match = pattern.exec(text);
    if (match) return match[1];
  }
  return undefined;
}

// A confidence threshold decision, not a hardcoded magic number scattered
// across call sites (Decision 1: "use confidence thresholds to flag
// uncertain metadata for human review"). Below this, the drawing number
// itself (the one field everything else is keyed on) is treated as
// not found at all, same as an unrecognized layout.
const DRAWING_NUMBER_CONFIDENCE_THRESHOLD = 0.5;

// Shared by extractTitleBlockFields() and extractTitleBlockFieldsFromCells()
// below: both find the same shape of result (a drawing number plus
// whatever else was found alongside it), just by searching different text
// scopes.
function buildResult(
  drawingNumberMatch: FieldMatch, revisionMatch: FieldMatch | null, titleMatch: FieldMatch | null,
  issueDate: string | undefined, source: 'embedded_text' | 'ocr',
): ExtractedDrawingFields {
  // Overall confidence is the weakest link, not an average; a confident
  // drawing-number match next to a missing revision is still an uncertain
  // record overall (there's nothing to compare a re-import's revision
  // against without one).
  const confidences = [drawingNumberMatch.confidence, revisionMatch?.confidence ?? 0, titleMatch?.confidence ?? 0.5];
  const confidence = Math.min(...confidences) * (source === 'ocr' ? 0.85 : 1); // OCR is inherently less certain than the embedded text layer

  return {
    drawingNumber: drawingNumberMatch.value,
    drawingTitle: titleMatch?.value,
    revisionNumber: revisionMatch?.value,
    issueDate,
    discipline: extractDiscipline(drawingNumberMatch.value),
    source,
    confidence,
  };
}

// Returns null when the text doesn't contain anything recognizable as a
// drawing number at all; an "unknown layout" (Decision 3: "flag unknown
// layouts... for review"), never a guess. A non-null result can still be
// low-confidence; the caller (the import processor) is the one that
// decides CONFIRMED vs. NEEDS_REVIEW from the reported confidence.
export function extractTitleBlockFields(text: string, source: 'embedded_text' | 'ocr'): ExtractedDrawingFields | null {
  const drawingNumberMatch = extractDrawingNumber(text);
  if (!drawingNumberMatch || drawingNumberMatch.confidence < DRAWING_NUMBER_CONFIDENCE_THRESHOLD) return null;

  const revisionMatch = matchLabeled(text, REVISION_LABELED, 0.75);
  const titleMatch = matchLabeled(text, TITLE_LABELED, 0.7);
  const issueDate = extractDate(text);
  return buildResult(drawingNumberMatch, revisionMatch, titleMatch, issueDate, source);
}

function firstMatchAcrossCells(cells: string[], matcher: (cell: string) => FieldMatch | null): FieldMatch | null {
  for (const cell of cells) {
    const match = matcher(cell);
    if (match) return match;
  }
  return null;
}

// A labeled match from ANY cell is tried across every cell before a bare
// match from ANY cell is tried at all -- not "the first cell's own best
// match". A stray bare-pattern-shaped token sitting in some other cell of
// the same title-block table (an equipment tag in an embedded schedule, a
// project code in a notes cell) must never outrank a real "Drawing No:"
// label elsewhere in the grid just because it happens to live in a cell
// this function reaches first.
//
// Tries both label shapes at each cell before moving to the next: a
// combined "label: value" cell first, then (when the cell is nothing but
// the bare label) the next cell in array order as the value, since
// getTable()'s flattening walks a row's cells left to right -- the same
// order a label-then-value pair is laid out in. Either shape can win at
// any position; what matters is that a labeled match (of either shape)
// from an earlier cell always outranks a bare match from a later one.
function matchLabeledAcrossCells(
  cells: string[], combinedPattern: RegExp, labelOnlyPattern: RegExp, confidence: number, validate?: (value: string) => boolean,
): FieldMatch | null {
  for (let i = 0; i < cells.length; i++) {
    const combined = matchLabeled(cells[i], combinedPattern, confidence);
    if (combined && (!validate || validate(combined.value))) return combined;

    if (labelOnlyPattern.test(cells[i].trim())) {
      const next = cells[i + 1]?.trim();
      if (next && (!validate || validate(next))) return { value: next, confidence };
    }
  }
  return null;
}

function extractDrawingNumberFromCells(cells: string[]): FieldMatch | null {
  const labeled = matchLabeledAcrossCells(cells, DRAWING_NUMBER_LABELED, DRAWING_NUMBER_LABEL_ONLY, 0.85, isPlausibleDrawingNumber);
  if (labeled) return labeled;
  return firstMatchAcrossCells(cells, (cell) => matchLabeled(cell, DRAWING_NUMBER_BARE, 0.55));
}

// The table-grid counterpart to extractTitleBlockFields() above: scopes
// every field regex to one detected table cell's own text at a time
// (pdf-parse's getTable(), via PdfTextResult.tableCells -- see that type's
// own comment for why this is more reliable than matching across the
// whole page). A title block's label and its value are visually always in
// the same bordered cell, so confining the search this way makes the
// cross-field contamination plain getText()-based matching is vulnerable
// to structurally impossible for any two DIFFERENT fields, regardless of
// how the PDF's content stream happened to serialize them. Returns null
// (falls back to extractTitleBlockFields() against the whole page) when no
// cell contains a plausible drawing number at all -- an untabled layout,
// or a table that isn't actually the title block.
export function extractTitleBlockFieldsFromCells(cells: string[], source: 'embedded_text' | 'ocr'): ExtractedDrawingFields | null {
  const drawingNumberMatch = extractDrawingNumberFromCells(cells);
  if (!drawingNumberMatch || drawingNumberMatch.confidence < DRAWING_NUMBER_CONFIDENCE_THRESHOLD) return null;

  const revisionMatch = matchLabeledAcrossCells(cells, REVISION_LABELED, REVISION_LABEL_ONLY, 0.75);
  const titleMatch = matchLabeledAcrossCells(cells, TITLE_LABELED, TITLE_LABEL_ONLY, 0.7);
  const issueDate = firstMatchAcrossCells(cells, (cell) => {
    const date = extractDate(cell);
    return date ? { value: date, confidence: 1 } : null;
  })?.value;
  return buildResult(drawingNumberMatch, revisionMatch, titleMatch, issueDate, source);
}

// The line between "trust this extraction enough to show it as confirmed"
// and "a human needs to look at this"; one place, so the import
// processor and any future caller agree on exactly the same cutoff.
export const EXTRACTION_CONFIDENCE_CONFIRMED_THRESHOLD = 0.7;

export function isConfidentExtraction(fields: ExtractedDrawingFields): boolean {
  return fields.confidence >= EXTRACTION_CONFIDENCE_CONFIRMED_THRESHOLD && Boolean(fields.revisionNumber);
}
