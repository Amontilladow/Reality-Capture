import type { ExtractedDrawingFields } from '@engineeringos/types';

// Common title-block field patterns (brief section 3/Decision 3: "support
// common drawing-number, title, revision and date patterns... do not
// assume all consultants use the same title-block layout"). Deliberately
// NOT a per-project configurable layout editor in this first release
// (Decision 3) -- these are the patterns that show up across most
// consultant-issued construction drawings regardless of discipline.
//
// Every pattern here is matched against the WHOLE page's extracted text
// (embedded or OCR'd), not a cropped title-block region -- this release
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
// discipline letter(s), separators, a sheet number -- e.g. "A-101",
// "S-2.03", "M4-C-0012", "ARC-00-101". Anchored to an explicit label when
// one is present (higher confidence); a bare pattern anywhere in the text
// scores lower, since it's more likely to be a false positive.
const DRAWING_NUMBER_LABELED = /(?:drawing|dwg|sheet)\s*(?:no\.?|number|#)\s*[:\-]?\s*([A-Z0-9][A-Z0-9\-./]{2,19})/i;
const DRAWING_NUMBER_BARE = /\b([A-Z]{1,4}-\d{1,4}(?:\.\d{1,2})?)\b/;

const REVISION_LABELED = /\brev(?:ision)?\.?\s*(?:no\.?)?\s*[:\-]?\s*([A-Z0-9]{1,3})\b/i;

const TITLE_LABELED = /(?:drawing\s*)?title\s*[:\-]\s*([^\n\r]{3,120})/i;

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

function extractDrawingNumber(text: string): FieldMatch | null {
  return matchLabeled(text, DRAWING_NUMBER_LABELED, 0.85) ?? matchLabeled(text, DRAWING_NUMBER_BARE, 0.55);
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
// itself -- the one field everything else is keyed on -- is treated as
// not found at all, same as an unrecognized layout.
const DRAWING_NUMBER_CONFIDENCE_THRESHOLD = 0.5;

// Returns null when the text doesn't contain anything recognizable as a
// drawing number at all -- an "unknown layout" (Decision 3: "flag unknown
// layouts... for review"), never a guess. A non-null result can still be
// low-confidence; the caller (the import processor) is the one that
// decides CONFIRMED vs. NEEDS_REVIEW from the reported confidence.
export function extractTitleBlockFields(text: string, source: 'embedded_text' | 'ocr'): ExtractedDrawingFields | null {
  const drawingNumberMatch = extractDrawingNumber(text);
  if (!drawingNumberMatch || drawingNumberMatch.confidence < DRAWING_NUMBER_CONFIDENCE_THRESHOLD) return null;

  const revisionMatch = matchLabeled(text, REVISION_LABELED, 0.75);
  const titleMatch = matchLabeled(text, TITLE_LABELED, 0.7);
  const issueDate = extractDate(text);

  // Overall confidence is the weakest link, not an average -- a confident
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

// The line between "trust this extraction enough to show it as confirmed"
// and "a human needs to look at this" -- one place, so the import
// processor and any future caller agree on exactly the same cutoff.
export const EXTRACTION_CONFIDENCE_CONFIRMED_THRESHOLD = 0.7;

export function isConfidentExtraction(fields: ExtractedDrawingFields): boolean {
  return fields.confidence >= EXTRACTION_CONFIDENCE_CONFIRMED_THRESHOLD && Boolean(fields.revisionNumber);
}
