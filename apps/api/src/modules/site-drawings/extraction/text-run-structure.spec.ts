import { buildPseudoTableFromTextRuns, type TextRun } from './text-run-structure';

// The word list below is the ACTUAL pytesseract image_to_data output
// (not invented) for a synthetic title-block fixture rendered by hand:
// a revision-history mini-table ("Rev. | Date | Reason For Issue" header
// row, one data row beneath it) and a title block with a label-above-
// value layout ("Title:" directly above "Single Leaf Steel Door") and a
// "Drawing No:"/"Rev:" label row immediately above its own value row.
// Confirmed by running the real engine (tesseract-ocr + pytesseract)
// against this exact fixture; "Rev," (a comma, not the period actually
// drawn) and the drawing-number/revision value fusing into one token
// ("M19-M4C-C0-PW-AX-SD-05731B", no real gap between them in the source
// image) are both genuine OCR artifacts from that real run, kept here
// verbatim rather than cleaned up, since they're exactly the kind of
// real-world noise this function has to cope with.
function ocrFixtureRuns(): TextRun[] {
  return [
    { text: 'Rev,', left: 912, top: 48, width: 27, height: 32, conf: 81, method: 'ocr' },
    { text: 'Date', left: 1002, top: 48, width: 35, height: 32, conf: 96, method: 'ocr' },
    { text: 'Reason', left: 1152, top: 58, width: 55, height: 12, conf: 96, method: 'ocr' },
    { text: 'For', left: 1215, top: 58, width: 24, height: 12, conf: 96, method: 'ocr' },
    { text: 'Issue', left: 1246, top: 58, width: 38, height: 12, conf: 91, method: 'ocr' },
    { text: '00', left: 911, top: 103, width: 18, height: 12, conf: 93, method: 'ocr' },
    { text: '13-02-2026', left: 1002, top: 103, width: 90, height: 12, conf: 96, method: 'ocr' },
    { text: 'Issued', left: 1152, top: 103, width: 48, height: 12, conf: 92, method: 'ocr' },
    { text: 'For', left: 1209, top: 103, width: 23, height: 12, conf: 95, method: 'ocr' },
    { text: 'Approval', left: 1237, top: 103, width: 69, height: 15, conf: 93, method: 'ocr' },
    { text: 'Drawing', left: 912, top: 714, width: 88, height: 22, conf: 96, method: 'ocr' },
    { text: 'No:', left: 1010, top: 715, width: 33, height: 16, conf: 96, method: 'ocr' },
    { text: 'Rev:', left: 1252, top: 715, width: 43, height: 16, conf: 96, method: 'ocr' },
    { text: 'M19-M4C-C0-PW-AX-SD-05731B', left: 912, top: 745, width: 352, height: 16, conf: 62, method: 'ocr' },
    { text: 'Title:', left: 910, top: 804, width: 52, height: 17, conf: 96, method: 'ocr' },
    { text: 'Single', left: 911, top: 834, width: 65, height: 22, conf: 96, method: 'ocr' },
    { text: 'Leaf', left: 987, top: 834, width: 45, height: 17, conf: 96, method: 'ocr' },
    { text: 'Steel', left: 1039, top: 834, width: 53, height: 17, conf: 96, method: 'ocr' },
    { text: 'Door', left: 1103, top: 835, width: 51, height: 16, conf: 96, method: 'ocr' },
  ];
}

describe('buildPseudoTableFromTextRuns', () => {
  it('returns an empty table for no runs', () => {
    expect(buildPseudoTableFromTextRuns([])).toEqual([]);
  });

  it('reconstructs the exact row/column structure a real Tesseract run produced, in reading order, regardless of input order', () => {
    // Shuffled deliberately: the function must sort internally, never
    // rely on the caller already handing it runs in reading order.
    const shuffled = [...ocrFixtureRuns()].reverse();
    const table = buildPseudoTableFromTextRuns(shuffled);

    expect(table).toEqual([
      ['Rev,', 'Date', 'Reason For Issue'], // revision-history table: header row
      ['00', '13-02-2026', 'Issued For Approval'], // revision-history table: its one data row
      ['Drawing No:', 'Rev:'], // title block's own labels (label-above-value layout)
      ['M19-M4C-C0-PW-AX-SD-05731B'], // the label row's value, one row down
      ['Title:'],
      ['Single Leaf Steel Door'],
    ]);
  });

  it('keeps a label directly above its value on separate rows even with tight line spacing (13px gap, 17-22px tall text)', () => {
    const table = buildPseudoTableFromTextRuns(ocrFixtureRuns());
    const titleRowIndex = table.findIndex((row) => row.includes('Title:'));
    expect(titleRowIndex).toBeGreaterThanOrEqual(0);
    expect(table[titleRowIndex]).toEqual(['Title:']);
    expect(table[titleRowIndex + 1]).toEqual(['Single Leaf Steel Door']);
  });

  it('never relies on a single shared row/column boundary for every row -- a wide-spaced label row and a tightly-packed phrase row both split correctly', () => {
    const table = buildPseudoTableFromTextRuns(ocrFixtureRuns());
    expect(table.some((row) => row[0] === 'Drawing No:' && row[1] === 'Rev:')).toBe(true);
  });

  it('single-run lines each become their own one-cell row', () => {
    const table = buildPseudoTableFromTextRuns([
      { text: 'A-101', left: 100, top: 100, width: 60, height: 20, conf: 95, method: 'ocr' },
      { text: 'B', left: 100, top: 200, width: 20, height: 20, conf: 95, method: 'ocr' },
    ]);
    expect(table).toEqual([['A-101'], ['B']]);
  });

  it('treats native-text runs identically to OCR runs -- the clustering is pure geometry, source-agnostic', () => {
    // Same shape a pypdfium2 native-text rect would produce: method
    // 'native', conf 100 (not a recognition guess). Two runs on one row,
    // a wide gap between them -- must still split into two cells exactly
    // like the OCR case above.
    const table = buildPseudoTableFromTextRuns([
      { text: 'Drawing No:', left: 100, top: 100, width: 150, height: 20, conf: 100, method: 'native' },
      { text: 'Rev:', left: 400, top: 101, width: 60, height: 20, conf: 100, method: 'native' },
    ]);
    expect(table).toEqual([['Drawing No:', 'Rev:']]);
  });

  it('merges mixed native+OCR runs on the same row by geometry alone, with no special-casing for mixed sources', () => {
    const table = buildPseudoTableFromTextRuns([
      { text: 'Drawing', left: 100, top: 100, width: 70, height: 20, conf: 100, method: 'native' },
      { text: 'No:', left: 175, top: 101, width: 30, height: 20, conf: 93, method: 'ocr' },
    ]);
    expect(table).toEqual([['Drawing No:']]);
  });
});
