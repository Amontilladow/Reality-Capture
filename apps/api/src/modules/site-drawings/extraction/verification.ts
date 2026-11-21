import type { DrawingFieldName, ExtractedDrawingFields, FieldEvidence, FieldVerificationState } from '@engineeringos/types';
import { EXTRACTION_CONFIDENCE_CONFIRMED_THRESHOLD, isPlausibleRevision } from './title-block-extractor';

// Hybrid Drawing Intelligence Engine replacement, verification stage
// (brief section 3): assigns each field one of three states, independent
// of the extraction's overall confidence number. Never collapses "a
// value was extracted" into "it's trustworthy" -- those are different
// questions, and this module exists specifically to keep them separate.

const ALL_FIELD_NAMES: readonly DrawingFieldName[] = ['drawingNumber', 'drawingTitle', 'revisionNumber', 'issueDate', 'discipline', 'projectName'];

function getFieldValue(fields: ExtractedDrawingFields, name: DrawingFieldName): string | undefined {
  switch (name) {
    case 'drawingNumber': return fields.drawingNumber;
    case 'drawingTitle': return fields.drawingTitle;
    case 'revisionNumber': return fields.revisionNumber;
    case 'issueDate': return fields.issueDate;
    case 'discipline': return fields.discipline;
    case 'projectName': return fields.projectName;
  }
}

function withFieldValue(fields: ExtractedDrawingFields, name: DrawingFieldName, value: string): ExtractedDrawingFields {
  switch (name) {
    case 'drawingNumber': return { ...fields, drawingNumber: value };
    case 'drawingTitle': return { ...fields, drawingTitle: value };
    case 'revisionNumber': return { ...fields, revisionNumber: value };
    case 'issueDate': return { ...fields, issueDate: value };
    case 'discipline': return { ...fields, discipline: value };
    case 'projectName': return { ...fields, projectName: value };
  }
}

// VERIFIED requires real corroborating evidence, not just a successful
// regex match (brief: "never assign Verified simply because a value was
// extracted"):
//   1. It came from a SPECIFIC title-block cell/region, not a whole-page
//      fallback scan -- a whole-page match can still be matching the
//      wrong occurrence of a pattern elsewhere on the page (this file's
//      own header comment on why whole-page matching is a last resort).
//   2. It is NOT a supplementary-source hint (a revision-history table,
//      a filename guess) standing in alone -- those exist specifically
//      to fill a gap, never to BE the verified answer themselves (see
//      fillMissingFieldsFromSupplementarySources()'s own comment).
//   3. Its own match confidence clears the same bar every other
//      "trust this enough to show as confirmed" decision in this engine
//      already uses (EXTRACTION_CONFIDENCE_CONFIRMED_THRESHOLD) -- one
//      threshold, not a second one invented just for this.
function isStrongEnoughToVerify(evidence: FieldEvidence): boolean {
  if (evidence.location === 'whole_page') return false;
  if (evidence.method === 'filename' || evidence.method === 'revision_table') return false;
  return evidence.confidence >= EXTRACTION_CONFIDENCE_CONFIRMED_THRESHOLD;
}

export function determineFieldState(value: string | undefined, evidence: FieldEvidence | undefined): FieldVerificationState {
  if (!value) return 'MISSING';
  if (evidence && isStrongEnoughToVerify(evidence)) return 'VERIFIED';
  return 'UNVERIFIED';
}

// Computes every field's state from its current value + evidence and
// attaches the result as `fieldStates`. Pure and idempotent -- safe to
// call again after fillMissingFieldsFromSupplementarySources() changes
// which fields have a value at all.
export function applyFieldVerification(fields: ExtractedDrawingFields): ExtractedDrawingFields {
  const fieldStates: Partial<Record<DrawingFieldName, FieldVerificationState>> = {};
  for (const name of ALL_FIELD_NAMES) {
    fieldStates[name] = determineFieldState(getFieldValue(fields, name), fields.fieldEvidence?.[name]);
  }
  return { ...fields, fieldStates };
}

export interface SupplementaryFieldHint {
  value: string;
  evidence: FieldEvidence;
}

// Title-block evidence is primary; a supplementary source (a revision-
// history table elsewhere on the page, a filename-derived guess) can
// only FILL a field that is otherwise missing -- it is structurally
// incapable of overriding an existing title-block-sourced value here,
// confident or not (brief: "must not override stronger title-block
// evidence without explicit validation" -- "explicit validation" means
// a human in the Review Queue, never this function deciding for them).
// A filled-in field is also, by construction, never VERIFIED: see
// isStrongEnoughToVerify()'s own rule 2.
export function fillMissingFieldsFromSupplementarySources(
  fields: ExtractedDrawingFields,
  hints: Partial<Record<DrawingFieldName, SupplementaryFieldHint>>,
): ExtractedDrawingFields {
  let updated: ExtractedDrawingFields = { ...fields, fieldEvidence: { ...fields.fieldEvidence } };
  for (const [name, hint] of Object.entries(hints) as [DrawingFieldName, SupplementaryFieldHint | undefined][]) {
    if (!hint || getFieldValue(updated, name)) continue; // never overrides an existing value
    updated = withFieldValue(updated, name, hint.value);
    updated.fieldEvidence![name] = hint.evidence;
  }
  return applyFieldVerification(updated);
}

// A revision-history log (not the sheet's own current revision) is a
// small table elsewhere on the page -- the same shape
// title-block-extractor.ts's own isPlausibleRevision comment documents
// causing a false match when naively treated as the title block itself
// (a "Rev." column header paired with its "Date" neighbor). Used here
// for exactly the opposite, SAFE purpose: when the real title block
// genuinely has no revision at all, the LATEST row of a real revision-
// history table is legitimate supplementary evidence for what the
// current revision probably is -- never promoted above a human review,
// and never allowed to override a title-block value that does exist
// (see fillMissingFieldsFromSupplementarySources() above).
//
// Deliberately conservative: only recognizes a table whose header row's
// first two cells are exactly "Rev"/"Revision" and "Date" (the common
// shape), and only reads the LAST data row (a revision history is
// written chronologically, oldest first, in every real example seen in
// this engagement) -- it does not try to parse or sort dates, which
// would be guessing at a layout this hasn't been validated against.
export function extractSupplementaryRevisionFromHistoryTable(rows: string[][]): SupplementaryFieldHint | null {
  if (rows.length < 2) return null;
  const header = rows[0].map((cell) => cell.trim().toLowerCase());
  const looksLikeRevisionHeader = /^rev(ision)?\.?:?$/.test(header[0] ?? '') && /^date:?$/.test(header[1] ?? '');
  if (!looksLikeRevisionHeader) return null;

  const lastRow = rows[rows.length - 1];
  const candidate = lastRow?.[0]?.trim();
  if (!candidate || !isPlausibleRevision(candidate)) return null;

  return {
    value: candidate,
    evidence: { location: `row ${rows.length - 1}, col 0`, method: 'revision_table', rawText: candidate, confidence: 0.5 },
  };
}
