import { stripPdfParseBoilerplate, hasUsableEmbeddedText, MIN_USABLE_TEXT_LENGTH } from './pdf-text-extractor';

// extractEmbeddedText() itself (the pdf-parse call) is not exercised here;
//; see its own comment in pdf-text-extractor.ts for why (a Jest/ESM
// incompatibility with pdf-parse's internal dynamic import, confirmed by
// hand against a real pdf-lib fixture under plain Node instead). These
// tests cover the pure logic this module adds on top of it.
//
// getTable() itself, and the structural fix to PdfTextResult.tableRows
// (rows preserved, not flattened into one string[]), are covered by that
// same hand-verification method instead of a Jest test, for the same
// reason. Both were confirmed against a pdf-lib fixture combining a
// bordered title-block grid with a few thousand unrelated vector lines --
// the shape that matters, since a bare grid alone never reproduced either
// issue:
//
// - pdf-parse's own table-detection code (geometry/Table.js) threw
//   "Cannot read properties of undefined (reading 'from')" on exactly
//   this shape of page in production, discarding the page's already-
//   successfully-extracted text along with it -- getTable()'s own
//   isolated try/catch inside extractEmbeddedText() degraded this to "no
//   detected table" rather than losing the page's text, but table-cell
//   extraction itself never once succeeded for a real file. Root-caused
//   to an unguarded -1 array index in Table.js's getRow() and patched in
//   the installed dependency itself (see patches/pdf-parse@2.4.5.patch) --
//   confirmed against this same fixture that getTable() no longer throws
//   and real cells come back.
// - Separately, getTable()'s own row-by-row flattening groups an entire
//   row's cells contiguously before the next row's: a title block whose
//   layout is "one row of labels, next row of values" (common; a label
//   directly above its value, not beside it) came back with every label
//   first and every value after, nowhere near each other -- impossible
//   for a flat cells: string[] to pair correctly no matter how the
//   matcher searched it. tableRows: string[][] (rows preserved) is what
//   makes title-block-extractor.ts's "next row, same column" check
//   possible at all; see its own spec for that fix's dedicated test.

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
