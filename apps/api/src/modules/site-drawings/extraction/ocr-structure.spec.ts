import { buildPseudoTableFromOcrWords, type OcrWord } from './ocr-structure';

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
function fixtureWords(): OcrWord[] {
  return [
    { text: 'Rev,', left: 912, top: 48, width: 27, height: 32, conf: 81 },
    { text: 'Date', left: 1002, top: 48, width: 35, height: 32, conf: 96 },
    { text: 'Reason', left: 1152, top: 58, width: 55, height: 12, conf: 96 },
    { text: 'For', left: 1215, top: 58, width: 24, height: 12, conf: 96 },
    { text: 'Issue', left: 1246, top: 58, width: 38, height: 12, conf: 91 },
    { text: '00', left: 911, top: 103, width: 18, height: 12, conf: 93 },
    { text: '13-02-2026', left: 1002, top: 103, width: 90, height: 12, conf: 96 },
    { text: 'Issued', left: 1152, top: 103, width: 48, height: 12, conf: 92 },
    { text: 'For', left: 1209, top: 103, width: 23, height: 12, conf: 95 },
    { text: 'Approval', left: 1237, top: 103, width: 69, height: 15, conf: 93 },
    { text: 'Drawing', left: 912, top: 714, width: 88, height: 22, conf: 96 },
    { text: 'No:', left: 1010, top: 715, width: 33, height: 16, conf: 96 },
    { text: 'Rev:', left: 1252, top: 715, width: 43, height: 16, conf: 96 },
    { text: 'M19-M4C-C0-PW-AX-SD-05731B', left: 912, top: 745, width: 352, height: 16, conf: 62 },
    { text: 'Title:', left: 910, top: 804, width: 52, height: 17, conf: 96 },
    { text: 'Single', left: 911, top: 834, width: 65, height: 22, conf: 96 },
    { text: 'Leaf', left: 987, top: 834, width: 45, height: 17, conf: 96 },
    { text: 'Steel', left: 1039, top: 834, width: 53, height: 17, conf: 96 },
    { text: 'Door', left: 1103, top: 835, width: 51, height: 16, conf: 96 },
  ];
}

describe('buildPseudoTableFromOcrWords', () => {
  it('returns an empty table for no words', () => {
    expect(buildPseudoTableFromOcrWords([])).toEqual([]);
  });

  it('reconstructs the exact row/column structure a real Tesseract run produced, in reading order, regardless of input order', () => {
    // Shuffled deliberately: the function must sort internally, never
    // rely on the caller already handing it words in reading order.
    const shuffled = [...fixtureWords()].reverse();
    const table = buildPseudoTableFromOcrWords(shuffled);

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
    const table = buildPseudoTableFromOcrWords(fixtureWords());
    const titleRowIndex = table.findIndex((row) => row.includes('Title:'));
    expect(titleRowIndex).toBeGreaterThanOrEqual(0);
    expect(table[titleRowIndex]).toEqual(['Title:']);
    expect(table[titleRowIndex + 1]).toEqual(['Single Leaf Steel Door']);
  });

  it('never relies on a single shared row/column boundary for every row -- a wide-spaced label row and a tightly-packed phrase row both split correctly', () => {
    const table = buildPseudoTableFromOcrWords(fixtureWords());
    // "Drawing No:" (two words, 10px gap at ~16-22px tall) merges into
    // one cell; "Rev:" (209px away) is correctly a separate cell on the
    // same row -- a single global gap threshold could not get both
    // right unless it scales with each word's own height, which is
    // exactly what CELL_GAP_HEIGHT_RATIO (relative, not absolute) does.
    expect(table.some((row) => row[0] === 'Drawing No:' && row[1] === 'Rev:')).toBe(true);
  });

  it('single word lines each become their own one-cell row', () => {
    const table = buildPseudoTableFromOcrWords([
      { text: 'A-101', left: 100, top: 100, width: 60, height: 20, conf: 95 },
      { text: 'B', left: 100, top: 200, width: 20, height: 20, conf: 95 },
    ]);
    expect(table).toEqual([['A-101'], ['B']]);
  });
});
