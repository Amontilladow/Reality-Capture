import { assessIdentityMatch } from './identity-match';

const existingTitle = 'Ground Floor Plan';

describe('assessIdentityMatch', () => {
  it('confirms when the title matches and the extraction is confident', () => {
    const result = assessIdentityMatch({ drawingTitle: 'Ground Floor Plan', confidence: 0.85, source: 'embedded_text' }, existingTitle);
    expect(result.verdict).toBe('confirmed');
  });

  it('confirms through minor normalization differences (case/whitespace) in the title', () => {
    const result = assessIdentityMatch({ drawingTitle: '  ground   floor plan ', confidence: 0.85, source: 'embedded_text' }, existingTitle);
    expect(result.verdict).toBe('confirmed');
  });

  // Site Drawing Hub integrity hardening, Phase 1, Test 2: an incompatible
  // title is a real conflict.
  it('Test 2: flags a materially different title as a conflict', () => {
    const result = assessIdentityMatch({ drawingTitle: 'Mechanical Schematic', confidence: 0.85, source: 'embedded_text' }, existingTitle);
    expect(result.verdict).toBe('title_conflict');
  });

  // Phase 1, Test 3: a missing title must never be read as agreement.
  it('Test 3: treats a missing title as uncertain, never as a confirmed match', () => {
    const result = assessIdentityMatch({ confidence: 0.85, source: 'embedded_text' }, existingTitle);
    expect(result.verdict).toBe('uncertain');
  });

  it('treats no extraction at all (null fields) as uncertain', () => {
    const result = assessIdentityMatch(null, existingTitle);
    expect(result.verdict).toBe('uncertain');
  });

  it('treats a matching but low-confidence title as uncertain, not confirmed', () => {
    const result = assessIdentityMatch({ drawingTitle: 'Ground Floor Plan', confidence: 0.4, source: 'ocr' }, existingTitle);
    expect(result.verdict).toBe('uncertain');
  });
});
