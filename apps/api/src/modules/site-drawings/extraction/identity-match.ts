import type { ExtractedDrawingFields } from '@engineeringos/types';
import { EXTRACTION_CONFIDENCE_CONFIRMED_THRESHOLD } from './title-block-extractor';

// Whether an incoming file's extracted metadata is strong enough evidence
// that it's really the SAME drawing as an existing register entry matched
// by drawing_number alone (Site Drawing Hub integrity hardening, Phase 1).
//
// A matching drawing_number is necessary but was previously treated as
// SUFFICIENT on its own: reconcile() only escalated to CONFLICT when the
// incoming title was PRESENT and incompatible, never when it was simply
// missing or unreliable. Two different physical drawings whose title-block
// text happens to share an incidental match elsewhere on the page (the
// extraction architecture's own documented risk -- see
// title-block-extractor.ts's header comment) produce exactly this shape:
// the same (wrong) drawing_number, and often no usable title at all for the
// second file. That combination used to sail straight through as a
// confirmed revision; this makes "no corroborating evidence" its own
// distinct, non-promoting outcome instead of being silently read as
// agreement.
export type IdentityAssessment =
  | { verdict: 'confirmed' }
  | { verdict: 'title_conflict'; existingTitle: string; incomingTitle: string }
  | { verdict: 'uncertain'; reason: string };

// Same normalization as reconcile()'s own titlesCompatible(): a difference
// in case/whitespace alone is not a real conflict, anything else is.
function titlesCompatible(a: string, b: string): boolean {
  const normalize = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
  return normalize(a) === normalize(b);
}

export function assessIdentityMatch(fields: ExtractedDrawingFields | null, existingDrawingTitle: string): IdentityAssessment {
  // Extraction found nothing at all for this file; the only reason it
  // matched an existing drawing is that its FILENAME happened to equal
  // that drawing's number (reconcile()'s own fallback-to-filename). That's
  // circumstantial, not corroborating evidence of a real match.
  if (!fields) return { verdict: 'uncertain', reason: 'Extraction found nothing in this file at all; it only matched the existing drawing because its filename happens to equal that drawing\'s number.' };

  if (!fields.drawingTitle) {
    return { verdict: 'uncertain', reason: 'This file\'s title could not be read, so there is nothing to compare against the existing drawing\'s title.' };
  }

  if (!titlesCompatible(existingDrawingTitle, fields.drawingTitle)) {
    return { verdict: 'title_conflict', existingTitle: existingDrawingTitle, incomingTitle: fields.drawingTitle };
  }

  // Title matched, but the extraction behind it (title included) wasn't
  // confident overall -- isConfidentExtraction() already folds the title
  // match's own confidence into fields.confidence via the minimum-across-
  // fields rule (title-block-extractor.ts's buildResult()), so a low
  // number here means the title match itself wasn't a strong one, not
  // just some unrelated field.
  if (fields.confidence < EXTRACTION_CONFIDENCE_CONFIRMED_THRESHOLD) {
    return { verdict: 'uncertain', reason: `This file's title appears to match, but the extraction behind it was low-confidence (${Math.round(fields.confidence * 100)}%) -- not strong enough on its own to confirm this is the same drawing.` };
  }

  return { verdict: 'confirmed' };
}
