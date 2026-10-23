import { stripPdfParseBoilerplate, hasUsableEmbeddedText, MIN_USABLE_TEXT_LENGTH } from './pdf-text-extractor';

// extractEmbeddedText() itself (the pdf-parse call) is not exercised here
// -- see its own comment in pdf-text-extractor.ts for why (a Jest/ESM
// incompatibility with pdf-parse's internal dynamic import, confirmed by
// hand against a real pdf-lib fixture under plain Node instead). These
// tests cover the pure logic this module adds on top of it.

describe('stripPdfParseBoilerplate', () => {
  it('removes the "-- N of M --" page marker pdf-parse always appends, regardless of real content', () => {
    expect(stripPdfParseBoilerplate('DRAWING NO: A-101\n\n-- 1 of 1 --\n\n')).toBe('DRAWING NO: A-101');
  });

  it('leaves a page with no real content, once the boilerplate is stripped, genuinely empty', () => {
    expect(stripPdfParseBoilerplate('\n\n-- 5 of 120 --\n\n')).toBe('');
  });

  it('is a no-op on text that never had the marker', () => {
    expect(stripPdfParseBoilerplate('DRAWING NO: A-101')).toBe('DRAWING NO: A-101');
  });
});

describe('hasUsableEmbeddedText', () => {
  it('requires at least MIN_USABLE_TEXT_LENGTH characters', () => {
    expect(hasUsableEmbeddedText('A'.repeat(MIN_USABLE_TEXT_LENGTH))).toBe(true);
    expect(hasUsableEmbeddedText('A'.repeat(MIN_USABLE_TEXT_LENGTH - 1))).toBe(false);
  });

  it('never treats a page-marker-only (post-strip-empty) string as usable -- this is exactly the bug the boilerplate strip fixes', () => {
    const rawFromPdfParse = stripPdfParseBoilerplate('\n\n-- 1 of 1 --\n\n');
    expect(hasUsableEmbeddedText(rawFromPdfParse)).toBe(false);
  });
});
