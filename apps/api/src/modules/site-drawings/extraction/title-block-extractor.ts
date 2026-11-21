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
// The captured value's minimum length is deliberately 1, not the 3+ an
// earlier version required: plenty of real projects number sheets with
// nothing but a bare 1-2 digit number ("Drawing No: 29"), and that
// previous minimum silently rejected every one of them, with no fallback
// -- DRAWING_NUMBER_BARE below requires a letter prefix or multiple
// dash-separated segments, neither of which a bare "29" has either, so a
// labeled short number had nowhere left to be recognized at all. Safe to
// relax here specifically because this pattern is anchored to an explicit
// label (unlike the bare pattern, which has no anchor and must stay
// conservative to avoid matching random short numbers elsewhere on the
// page); isPlausibleDrawingNumber()'s digit requirement below still
// rejects a labeled non-numeric false positive like "Drawing No: Checked".
//
// The maximum is 60, not the 20 an earlier version capped it at: the
// longer multi-segment codes common on larger CAD-template-driven
// projects (this file's own DRAWING_NUMBER_BARE comment gives
// "M19-M4C-C0-PW-AX-SD-05713" as exactly this shape) regularly run past
// 20 characters -- that example is 25 -- and the old cap silently
// truncated the captured value mid-token instead of failing outright
// (confirmed by hand: it returned "M19-M4C-C0-PW-AX-SD-", missing the
// sheet number entirely, for a drawing labeled with its own real number).
// A regex quantifier only bounds how much it CAN consume, not how much it
// has to -- a short labeled value like "29" still matches exactly "29";
// this only raises the ceiling for one that's genuinely longer.
const DRAWING_NUMBER_LABELED = /(?:drawing|dwg|sheet)\s*(?:no\.?|number|#)\s*[:\-]?\s*([A-Z0-9][A-Z0-9\-./]{0,59})/i;
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
const ANY_LABEL_ONLY_PATTERNS = [DRAWING_NUMBER_LABEL_ONLY, REVISION_LABEL_ONLY, TITLE_LABEL_ONLY];

// A real "label row, then value row" layout (confirmed by hand: a
// bordered grid whose top row is nothing but labels -- "Drawing No:",
// "Rev:", "Title:" -- and whose next row is nothing but their values)
// means the cell immediately after a label, in the SAME row, is very
// often ANOTHER LABEL, not that label's own value: there is no `validate`
// function for revision/title (unlike the drawing number's digit check)
// to reject that wrong candidate on its own. A real value should never
// itself be nothing but one of these three known label shapes, so
// rejecting a same-row/next-row candidate that matches ANY of them is a
// general-purpose way to tell "this is someone else's label cell" apart
// from "this is an actual value" regardless of which field is being
// matched.
function looksLikeLabelCell(value: string): boolean {
  return ANY_LABEL_ONLY_PATTERNS.some((pattern) => pattern.test(value));
}

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

// A real production failure, confirmed by hand: a title block's own
// revision-HISTORY log (tracking every past issue -- "Rev. | Date |
// Reason For Issue", not the sheet's OWN current revision value) is a
// separate small table that can appear anywhere on the same page, and
// its "Rev." column header is itself a bare REVISION_LABEL_ONLY match.
// Pairing that header with the cell beside it (the "Date" column's own
// header, not a revision value at all) via the same label-adjacency
// logic every other field uses produced a drawing whose revision number
// was literally the word "Date". REVISION_LABELED's own capture group
// already bounds a real value to 1-3 alphanumeric characters; applying
// that same shape check here rejects exactly this false positive and
// falls through to no-revision-found (honest, review-routed) rather
// than a wrong, confident-looking value -- the same defense
// isPlausibleDrawingNumber already gives the drawing-number field.
function isPlausibleRevision(value: string): boolean {
  return /^[A-Z0-9]{1,3}$/i.test(value.trim());
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

// `issue_date` is a SQL DATE column (migration 072); the `postgres` driver
// serializes a matched string via `new Date(value).toISOString()`, which
// THROWS `RangeError: Invalid time value` for a string that is date-SHAPED
// but not a real calendar date (day/month out of range) -- confirmed by
// hand against production: the same "Invalid time value" crash recurred
// deterministically for the same handful of files across every reimport,
// aborting that file's entire import (never reaching the Review Queue at
// all, unlike every other uncertain-field case, which degrades to
// NEEDS_REVIEW instead of throwing). A bad date must fail the SAME way an
// implausible drawing number does: rejected here and treated as "no date
// found", never propagated to crash the file's own DB insert.
function isValidCalendarDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const date = new Date(year, month - 1, day);
  // Rolls over out-of-range days (e.g. Feb 30 -> Mar 2) instead of
  // throwing; comparing the components back out catches that roll-over.
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

// The numeric slash/dash pattern doesn't know if it's DD/MM or MM/DD
// (both appear on consultant-issued drawings internationally), so a match
// is accepted as long as EITHER reading is a real date -- only rejecting a
// value where NEITHER order could possibly be valid.
function isValidExtractedDate(value: string): boolean {
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (iso) return isValidCalendarDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  const numeric = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(value);
  if (numeric) {
    const [, a, b, year] = numeric;
    return isValidCalendarDate(Number(year), Number(a), Number(b)) || isValidCalendarDate(Number(year), Number(b), Number(a));
  }

  // The remaining two patterns are English month-name forms ("12 Mar
  // 2025", "March 12, 2025"), which JS's Date constructor parses
  // reliably; no day/month ambiguity to resolve since the month is named.
  return !isNaN(new Date(value).getTime());
}

function extractDate(text: string): string | undefined {
  for (const pattern of DATE_PATTERNS) {
    const match = pattern.exec(text);
    if (match && isValidExtractedDate(match[1])) return match[1];
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

function cellAt(rows: string[][], r: number, c: number): string | undefined {
  return rows[r]?.[c]?.trim();
}

// A labeled match from ANY cell is tried across every cell before a bare
// match from ANY cell is tried at all -- not "the first cell's own best
// match". A stray bare-pattern-shaped token sitting in some other cell of
// the same title-block table (an equipment tag in an embedded schedule, a
// project code in a notes cell) must never outrank a real "Drawing No:"
// label elsewhere in the grid just because it happens to live in a cell
// this function reaches first.
//
// Tries three shapes at each cell, in order, before moving to the next:
// a combined "label: value" cell; then, when the cell is nothing but the
// bare label, the next cell in the SAME ROW (a label beside its value);
// then the cell directly below it in the NEXT ROW, same column (a label
// above its value). Both of the latter two are real, common title-block
// layouts -- see PdfTextResult.tableRows's own comment for why only
// having rows (not a flat cell list) makes the second one detectable at
// all. Either shape can win at any position; what matters is that a
// labeled match (of any shape) from an earlier cell always outranks a
// bare match from a later one.
function matchLabeledAcrossCells(
  rows: string[][], combinedPattern: RegExp, labelOnlyPattern: RegExp, confidence: number, validate?: (value: string) => boolean,
): FieldMatch | null {
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    for (let c = 0; c < row.length; c++) {
      const combined = matchLabeled(row[c], combinedPattern, confidence);
      if (combined && (!validate || validate(combined.value))) return combined;

      if (labelOnlyPattern.test(row[c].trim())) {
        const sameRowNext = cellAt(rows, r, c + 1);
        if (sameRowNext && !looksLikeLabelCell(sameRowNext) && (!validate || validate(sameRowNext))) return { value: sameRowNext, confidence };

        const nextRowSame = cellAt(rows, r + 1, c);
        if (nextRowSame && !looksLikeLabelCell(nextRowSame) && (!validate || validate(nextRowSame))) return { value: nextRowSame, confidence };
      }
    }
  }
  return null;
}

function extractDrawingNumberFromCells(rows: string[][], flatCells: string[]): FieldMatch | null {
  const labeled = matchLabeledAcrossCells(rows, DRAWING_NUMBER_LABELED, DRAWING_NUMBER_LABEL_ONLY, 0.85, isPlausibleDrawingNumber);
  if (labeled) return labeled;
  return firstMatchAcrossCells(flatCells, (cell) => matchLabeled(cell, DRAWING_NUMBER_BARE, 0.55));
}

// A tempting next step here would be "guess the title from whichever
// cell is left over once every other known field is excluded" -- tried
// by hand and deliberately NOT shipped: there is no way to tell an
// actually-unlabeled title apart from any other unrelated field with
// ordinary prose text (confirmed against this file's own "Checked By: J.
// Smith" test fixture, which such a guess picks up as a "title" with
// nothing to distinguish it from a real one). That's exactly the
// "invent a missing value" this module's header comment rules out, so
// an unlabeled title still correctly falls through to no title at all,
// same as a revision with no plausible value -- not a guess that could
// be visibly wrong in the Review Queue.

// The table-grid counterpart to extractTitleBlockFields() above: scopes
// every field regex to one detected table cell's own text at a time
// (pdf-parse's getTable(), via PdfTextResult.tableRows -- see that type's
// own comment for why this is more reliable than matching across the
// whole page, and why rows, not a flat cell list). A title block's label
// and its value are visually always in the same bordered cell or an
// immediately adjacent one, so confining the search this way makes the
// cross-field contamination plain getText()-based matching is vulnerable
// to structurally impossible for any two DIFFERENT fields, regardless of
// how the PDF's content stream happened to serialize them. Returns null
// (falls back to extractTitleBlockFields() against the whole page) when no
// cell contains a plausible drawing number at all -- an untabled layout,
// or a table that isn't actually the title block.
export function extractTitleBlockFieldsFromCells(rows: string[][], source: 'embedded_text' | 'ocr'): ExtractedDrawingFields | null {
  const flatCells = rows.flat();
  const drawingNumberMatch = extractDrawingNumberFromCells(rows, flatCells);
  if (!drawingNumberMatch || drawingNumberMatch.confidence < DRAWING_NUMBER_CONFIDENCE_THRESHOLD) return null;

  const revisionMatch = matchLabeledAcrossCells(rows, REVISION_LABELED, REVISION_LABEL_ONLY, 0.75, isPlausibleRevision);
  const titleMatch = matchLabeledAcrossCells(rows, TITLE_LABELED, TITLE_LABEL_ONLY, 0.7);
  const issueDate = firstMatchAcrossCells(flatCells, (cell) => {
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
