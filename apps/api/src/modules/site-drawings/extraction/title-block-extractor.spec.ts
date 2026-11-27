import {
  extractTitleBlockFields,
  extractTitleBlockFieldsFromCells,
  isConfidentExtraction,
  EXTRACTION_CONFIDENCE_CONFIRMED_THRESHOLD,
} from './title-block-extractor';

describe('extractTitleBlockFields', () => {
  it('extracts a labeled drawing number, revision, title and date from a typical title block', () => {
    const text = `
      PROJECT: M4 CONTRACTING
      DRAWING TITLE: GROUND FLOOR PLAN - STRUCTURAL LAYOUT
      DRAWING NO: S-101
      REV: C
      DATE: 12/03/2025
    `;
    const result = extractTitleBlockFields(text, 'embedded_text');
    expect(result).not.toBeNull();
    expect(result?.drawingNumber).toBe('S-101');
    expect(result?.revisionNumber).toBe('C');
    expect(result?.drawingTitle).toBe('GROUND FLOOR PLAN - STRUCTURAL LAYOUT');
    expect(result?.issueDate).toBe('12/03/2025');
    expect(result?.discipline).toBe('Structural');
    expect(result?.source).toBe('embedded_text');
  });

  it('returns null (an unknown layout) when no drawing number can be found at all', () => {
    const text = 'This page has no recognizable title block content whatsoever, just prose.';
    expect(extractTitleBlockFields(text, 'embedded_text')).toBeNull();
  });

  it('falls back to a bare drawing-number pattern at lower confidence when no label is present', () => {
    const result = extractTitleBlockFields('Some header text\nA-205\nmore text', 'embedded_text');
    expect(result?.drawingNumber).toBe('A-205');
    expect(result?.discipline).toBe('Architectural');
    expect(isConfidentExtraction(result!)).toBe(false); // no revision found either, so overall confidence is 0 (min of confidences)
  });

  it('never invents a revision number or title that is not actually present', () => {
    const result = extractTitleBlockFields('DWG NO: M-301', 'embedded_text');
    expect(result?.drawingNumber).toBe('M-301');
    expect(result?.revisionNumber).toBeUndefined();
    expect(result?.drawingTitle).toBeUndefined();
  });

  it('extracts a bare 1-2 digit drawing number when explicitly labeled (plenty of real projects number sheets this way)', () => {
    const text = 'Drawing No: 29\nRevision: 0\nDrawing Title: GROUND FLOOR PLAN';
    const result = extractTitleBlockFields(text, 'embedded_text');
    expect(result?.drawingNumber).toBe('29');
    expect(result?.revisionNumber).toBe('0');
    expect(isConfidentExtraction(result!)).toBe(true);
  });

  it('scores an OCR-sourced extraction lower than the same text from the embedded layer', () => {
    const text = 'DRAWING NO: E-110\nREV: B\nTITLE: LIGHTING LAYOUT';
    const embedded = extractTitleBlockFields(text, 'embedded_text')!;
    const ocr = extractTitleBlockFields(text, 'ocr')!;
    expect(ocr.confidence).toBeLessThan(embedded.confidence);
  });

  it('finds a labeled title with no colon/dash separator, printed on the line below its label', () => {
    // A real, common CAD title-block layout: "Drawing Title" as its own
    // label line, the actual title directly below it, no punctuation
    // between them at all.
    const text = 'Drawing No: M19-M4C-C0-PW-AX-SD-05713\nDrawing Title\nGROUND FLOOR STEEL DOOR KEY PLAN\nRevision: 00';
    const result = extractTitleBlockFields(text, 'embedded_text');
    // The drawing number itself, not just the title: this exact fixture
    // previously reproduced a real truncation bug (see the next test) that
    // this assertion alone would have caught from the start.
    expect(result?.drawingNumber).toBe('M19-M4C-C0-PW-AX-SD-05713');
    expect(result?.drawingTitle).toBe('GROUND FLOOR STEEL DOOR KEY PLAN');
  });

  it('does not truncate a long labeled multi-segment drawing number (previously cut off at 20 characters)', () => {
    // Reproduces a real production failure: a 25-character drawing number
    // ("M19-M4C-C0-PW-AX-SD-05729" from an actual title block) came back
    // as "M19-M4C-C0-PW-AX-SD-" -- the sheet number silently dropped --
    // because the labeled pattern's captured-value length was capped at
    // 20. Confirmed by hand that this exact drawing number, plain-text
    // extracted from a real CAD-exported PDF with a dense, line-heavy
    // drawing body around its title block, round-trips correctly now.
    const text = 'Drawing No.\nM19-M4C-C0-PW-AX-SD-05729\nRevision\n00\nDrawing Title\n60&90MIN FIRE RATED SINGLE LEAF STEEL DOOR';
    const result = extractTitleBlockFields(text, 'embedded_text');
    expect(result?.drawingNumber).toBe('M19-M4C-C0-PW-AX-SD-05729');
    expect(result?.revisionNumber).toBe('00');
    expect(result?.drawingTitle).toBe('60&90MIN FIRE RATED SINGLE LEAF STEEL DOOR');
  });

  it('rejects an implausible labeled drawing-number match (no digits) and falls back to a bare multi-segment code', () => {
    // Reproduces the real failure: embedded-text extraction order doesn't
    // have to match the title block's visual layout, so the token right
    // after a "Drawing No:" label can turn out to be an unrelated word
    // from a completely different field ("Checked", from "Checked By:").
    // A real drawing number always has a digit somewhere in it; this one
    // doesn't, so it's rejected and the real multi-segment code elsewhere
    // in the text is found instead, at the bare pattern's lower confidence.
    const text = 'Drawing No: Checked\nsome other text\nM19-M4C-C0-PW-AX-SD-05713\nmore text';
    const result = extractTitleBlockFields(text, 'embedded_text');
    expect(result?.drawingNumber).toBe('M19-M4C-C0-PW-AX-SD-05713');
  });

  it('rejects a date-shaped but calendar-invalid match instead of returning it (would crash the DB insert otherwise)', () => {
    // issue_date is a SQL DATE column; a string like "60/90/2025" is
    // date-SHAPED (matches the slash/dash pattern) but isn't a real date
    // under either DD/MM or MM/DD reading. Returning it as-is previously
    // reached the `postgres` driver's date serialization and threw
    // `RangeError: Invalid time value`, aborting the whole file's import --
    // reproduced against production logs for a recurring set of files.
    const text = 'Drawing No: S-101\nDate: 60/90/2025';
    const result = extractTitleBlockFields(text, 'embedded_text');
    expect(result?.issueDate).toBeUndefined();
  });

  it('accepts a numeric date under either DD/MM or MM/DD reading', () => {
    // "31/12/2025" is only valid as DD/MM (December 31st); MM/DD would
    // require a 31st month, so this also proves the fix doesn't require
    // BOTH readings to be valid, just one.
    const text = 'Drawing No: S-101\nDate: 31/12/2025';
    const result = extractTitleBlockFields(text, 'embedded_text');
    expect(result?.issueDate).toBe('31/12/2025');
  });

  it('isConfidentExtraction requires both a high confidence score AND a revision number', () => {
    expect(isConfidentExtraction({ drawingNumber: 'A-1', source: 'embedded_text', confidence: EXTRACTION_CONFIDENCE_CONFIRMED_THRESHOLD, revisionNumber: 'A' })).toBe(true);
    expect(isConfidentExtraction({ drawingNumber: 'A-1', source: 'embedded_text', confidence: EXTRACTION_CONFIDENCE_CONFIRMED_THRESHOLD })).toBe(false); // no revision
    expect(isConfidentExtraction({ drawingNumber: 'A-1', source: 'embedded_text', confidence: 0.1, revisionNumber: 'A' })).toBe(false); // too low
  });
});

describe('extractTitleBlockFieldsFromCells', () => {
  // These fixtures wrap each flat list of cells as a SINGLE row: they only
  // ever rely on same-row (array-adjacent) behavior, which single-row
  // framing preserves exactly. The row-above/row-below case gets its own,
  // genuinely multi-row fixtures further down.
  it('extracts a labeled drawing number, revision and title each from their own cell', () => {
    const rows = [['Drawing No: S-101', 'Rev: C', 'Drawing Title: GROUND FLOOR PLAN - STRUCTURAL LAYOUT', 'Date: 12/03/2025']];
    const result = extractTitleBlockFieldsFromCells(rows, 'embedded_text');
    expect(result?.drawingNumber).toBe('S-101');
    expect(result?.revisionNumber).toBe('C');
    expect(result?.drawingTitle).toBe('GROUND FLOOR PLAN - STRUCTURAL LAYOUT');
    expect(result?.issueDate).toBe('12/03/2025');
    expect(result?.discipline).toBe('Structural');
  });

  it('does not truncate a long labeled multi-segment drawing number combined with its label in one cell', () => {
    const rows = [['Drawing No: M19-M4C-C0-PW-AX-SD-05729', 'Revision: 00']];
    const result = extractTitleBlockFieldsFromCells(rows, 'embedded_text');
    expect(result?.drawingNumber).toBe('M19-M4C-C0-PW-AX-SD-05729');
  });

  it('returns null when no cell contains a plausible drawing number', () => {
    const rows = [['Checked By: J. Smith', 'Scale: 1:100', 'Notes: see general notes']];
    expect(extractTitleBlockFieldsFromCells(rows, 'embedded_text')).toBeNull();
  });

  it('is immune to a bare-pattern-shaped token sitting in an unrelated cell (the AHU-04/SE45_01 regression)', () => {
    // Reproduces the real report: a value belonging to one field ("AHU-04",
    // an equipment tag mentioned in a schedule cell) must never be picked up
    // as the drawing number, and a value belonging to another field
    // ("SE45_01") must never be picked up as the title, just because
    // whole-page text order happened to put them near those labels. Scoping
    // every match to its own cell makes this impossible: the labeled match
    // in the drawing-number cell wins regardless of what unrelated text
    // lives in other cells of the same table.
    const rows = [[
      'Drawing No: M-05713',
      'Drawing Title: GROUND FLOOR STEEL DOOR KEY PLAN',
      'Revision: 00',
      'Equipment Schedule: AHU-04, AHU-05',
      'Project Code: SE45_01',
    ]];
    const result = extractTitleBlockFieldsFromCells(rows, 'embedded_text');
    expect(result?.drawingNumber).toBe('M-05713');
    expect(result?.drawingTitle).toBe('GROUND FLOOR STEEL DOOR KEY PLAN');
    expect(result?.revisionNumber).toBe('00');
  });

  it('tries a labeled match across every cell before falling back to any bare match', () => {
    // The labeled drawing number lives in the LAST cell, a bare-pattern-
    // shaped token in the FIRST -- array order must not matter.
    const rows = [['A-999', 'Checked By: J. Smith', 'Drawing No: S-101']];
    const result = extractTitleBlockFieldsFromCells(rows, 'embedded_text');
    expect(result?.drawingNumber).toBe('S-101');
  });

  it('rejects an implausible labeled match (no digits) in one cell and falls back to a bare match in another', () => {
    const rows = [['Drawing No: Checked', 'M19-M4C-C0-PW-AX-SD-05713']];
    const result = extractTitleBlockFieldsFromCells(rows, 'embedded_text');
    expect(result?.drawingNumber).toBe('M19-M4C-C0-PW-AX-SD-05713');
  });

  it('rejects a revision-HISTORY table\'s own "Rev." column header paired with its "Date" column neighbor, never reporting "Date" as the revision', () => {
    // Reproduces a real production bug found by hand against actual
    // extracted title-block files: a revision-history log ("Rev. | Date
    // | Reason For Issue", tracking every past issue of the drawing) is
    // a separate small table that can appear anywhere on the page, and
    // its own "Rev." column header is itself a bare REVISION_LABEL_ONLY
    // match -- completely unrelated to the sheet's OWN current revision
    // field. Pairing it with the next cell ("Date", that table's own
    // next column header) produced a drawing whose revisionNumber was
    // literally the word "Date". The real per-sheet revision field in
    // the source file wasn't separately matchable at all (merged into
    // an unrelated blob cell) -- the correct, honest result here is no
    // revision found, not a wrong one.
    //
    // Row order below matches what pdf-parse's getTable() actually
    // emits for the real file this reproduces (confirmed by hand): the
    // history table's data rows come BEFORE its own header row, not
    // after -- so "the row below the header" is the unrelated blob
    // cell, never a coincidentally plausible-looking "00".
    const rows = [
      ['00', '------', '', 'ISSUED FOR APPROVAL'],
      ['00', '13-02-2026', '', 'ISSUED FOR APPROVAL'],
      ['Rev.', 'Date', '', 'Reason For Issue'],
      ['Drawing No: M19-M4C-C0-PW-AX-SD-05731'],
    ];
    const result = extractTitleBlockFieldsFromCells(rows, 'embedded_text');
    expect(result?.drawingNumber).toBe('M19-M4C-C0-PW-AX-SD-05731');
    expect(result?.revisionNumber).toBeUndefined();
  });

  it('rejects a "Drawing Title" label paired with an ADJACENT field\'s own label+value pair, never reporting a project/drawing/revision reference as the title', () => {
    // Reproduces a real production bug, user-reported against an actual
    // imported drawing: on a real title block, the row/column
    // reconstruction (text-run-structure.ts) paired the "Drawing Title"
    // label with "Project No. PR-169" -- an entirely different field's
    // own label+value pair -- instead of the real title text, because
    // that was whatever cell the geometry-based row/column grouping
    // placed next to it. The drawing number itself matched correctly;
    // only the title was wrong, which previously surfaced as a false
    // "drawing number collision" in the Review Queue (the existing
    // drawing's real title didn't match this wrong one). Same class of
    // bug as the "Rev."/"Date" case above, just a different field
    // substituted in, and the same fix: reject a value that IS another
    // field's own labeled shape and keep looking, rather than reporting
    // it with confidence.
    const rowsWithWrongNeighbor = [
      ['Drawing No:', 'M19-M4C-C0-PW-AX-DD-16300'],
      ['Drawing Title', 'Project No.: PR-169'],
    ];
    const result = extractTitleBlockFieldsFromCells(rowsWithWrongNeighbor, 'embedded_text');
    expect(result?.drawingNumber).toBe('M19-M4C-C0-PW-AX-DD-16300');
    expect(result?.drawingTitle).toBeUndefined();
  });

  it('keeps searching past a rejected title candidate and finds a later, genuine one', () => {
    const rows = [
      ['Drawing No:', 'M19-M4C-C0-PW-AX-DD-16300'],
      ['Drawing Title', 'Project No.: PR-169'], // same-row neighbor: rejected
      ['Revision: 00'], // next-row-same-column neighbor: also rejected
      ['Drawing Title: Single Leaf Steel Door BS 90 Min Fire Rated'], // the real one, found elsewhere on the page
    ];
    const result = extractTitleBlockFieldsFromCells(rows, 'embedded_text');
    expect(result?.drawingTitle).toBe('Single Leaf Steel Door BS 90 Min Fire Rated');
  });

  it('does not reject a genuine title that merely mentions "project" mid-sentence', () => {
    const rows = [[
      'Drawing No: M-05713',
      'Drawing Title: New Project Office Extension - Ground Floor Plan',
    ]];
    const result = extractTitleBlockFieldsFromCells(rows, 'embedded_text');
    expect(result?.drawingTitle).toBe('New Project Office Extension - Ground Floor Plan');
  });

  it('pairs a bare label cell with the next cell as its value, for a layout where label and value are in separate adjacent cells of the SAME row', () => {
    // Confirmed by hand against a reproduction PDF built with a real
    // bordered grid (pdf-lib + pdf-parse's getTable()): a common title-
    // block layout puts a field's label and its value in two separate
    // cells side by side, not combined in one cell's text. getTable()'s
    // row flattening walks a row's cells left to right, so the value
    // cell is the very next entry after its label cell within that row.
    const rows = [['Drawing No:', 'S-101', 'Drawing Title:', 'GROUND FLOOR STEEL DOOR KEY PLAN', 'Revision:', '00', 'Equipment Schedule:', 'AHU-04']];
    const result = extractTitleBlockFieldsFromCells(rows, 'embedded_text');
    expect(result?.drawingNumber).toBe('S-101');
    expect(result?.drawingTitle).toBe('GROUND FLOOR STEEL DOOR KEY PLAN');
    expect(result?.revisionNumber).toBe('00');
  });

  it('pairs a bare label cell with the cell directly below it in the NEXT row, same column -- a layout a flat cell list cannot recover at all', () => {
    // Reproduces a real bug found by hand (not just a hypothetical): a
    // bordered grid with ALL of one row's labels, then ALL of the next
    // row's values -- confirmed against pdf-parse's actual getTable()
    // output for a reproduction fixture laid out this way. A flattened
    // cells: string[] (the previous shape of this data) makes "the next
    // array entry" after a label be the NEXT COLUMN'S LABEL in the same
    // row, never the value below it -- this layout was previously
    // impossible to match correctly despite this file's own comment
    // claiming to support "a label cell beside, OR ABOVE, an otherwise-
    // blank value cell". Preserving row boundaries (tableRows: string[][])
    // is what makes checking "next row, same column" possible at all.
    const rows = [
      ['Drawing No:', 'Revision:', 'Drawing Title:'],
      ['S-101', '00', 'GROUND FLOOR STEEL DOOR KEY PLAN'],
    ];
    const result = extractTitleBlockFieldsFromCells(rows, 'embedded_text');
    expect(result?.drawingNumber).toBe('S-101');
    expect(result?.revisionNumber).toBe('00');
    expect(result?.drawingTitle).toBe('GROUND FLOOR STEEL DOOR KEY PLAN');
  });

  it('never invents a revision or title that is not actually present in any cell', () => {
    const rows = [['DWG NO: M-301', 'Checked By: J. Smith']];
    const result = extractTitleBlockFieldsFromCells(rows, 'embedded_text');
    expect(result?.drawingNumber).toBe('M-301');
    expect(result?.revisionNumber).toBeUndefined();
    expect(result?.drawingTitle).toBeUndefined();
  });

  it('extracts a bare 1-2 digit drawing number from a labeled cell', () => {
    const rows = [['Drawing No: 29', 'Revision: 0']];
    const result = extractTitleBlockFieldsFromCells(rows, 'embedded_text');
    expect(result?.drawingNumber).toBe('29');
    expect(result?.revisionNumber).toBe('0');
  });
});

describe('fieldEvidence (Drawing Identification Engine replacement: per-field source location/method/evidence)', () => {
  it('records a whole-page match\'s location as "whole_page" and its method as the extraction source', () => {
    const result = extractTitleBlockFields('DRAWING NO: S-101\nREV: C\nTITLE: ROOF PLAN', 'embedded_text')!;
    expect(result.fieldEvidence?.drawingNumber).toEqual({ location: 'whole_page', method: 'native_text', rawText: 'S-101', confidence: 0.85 });
    expect(result.fieldEvidence?.revisionNumber).toEqual({ location: 'whole_page', method: 'native_text', rawText: 'C', confidence: 0.75 });
  });

  it('tags an OCR whole-page match\'s method as "ocr", distinct from a native-text match', () => {
    const result = extractTitleBlockFields('DRAWING NO: S-101\nREV: C', 'ocr')!;
    expect(result.fieldEvidence?.drawingNumber?.method).toBe('ocr');
  });

  it('records a cell-based match\'s exact row/col location, not "whole_page"', () => {
    const rows = [['Drawing No: S-101', 'Rev: C', 'Drawing Title: ROOF PLAN']];
    const result = extractTitleBlockFieldsFromCells(rows, 'embedded_text')!;
    expect(result.fieldEvidence?.drawingNumber).toEqual({ location: 'row 0, col 0', method: 'native_text', rawText: 'S-101', confidence: 0.85 });
    expect(result.fieldEvidence?.revisionNumber).toEqual({ location: 'row 0, col 1', method: 'native_text', rawText: 'C', confidence: 0.75 });
    expect(result.fieldEvidence?.drawingTitle).toEqual({ location: 'row 0, col 2', method: 'native_text', rawText: 'ROOF PLAN', confidence: 0.7 });
  });

  it('records the correct adjacent-cell location for a label-above-value layout (next row, same column)', () => {
    const rows = [
      ['Drawing No:', 'Revision:'],
      ['S-101', '00'],
    ];
    const result = extractTitleBlockFieldsFromCells(rows, 'embedded_text')!;
    expect(result.fieldEvidence?.drawingNumber?.location).toBe('row 1, col 0');
    expect(result.fieldEvidence?.revisionNumber?.location).toBe('row 1, col 1');
  });

  it('records discipline as derived from the drawing number, not an independent match', () => {
    const result = extractTitleBlockFields('DRAWING NO: S-101\nREV: C', 'embedded_text')!;
    expect(result.discipline).toBe('Structural');
    expect(result.fieldEvidence?.discipline).toEqual({ location: 'derived_from_drawing_number', method: 'native_text', rawText: 'S-101', confidence: 0.85 });
  });

  it('has no evidence entry at all for a field that was never found', () => {
    const result = extractTitleBlockFields('DRAWING NO: S-101', 'embedded_text')!;
    expect(result.fieldEvidence?.drawingTitle).toBeUndefined();
    expect(result.fieldEvidence?.projectName).toBeUndefined();
  });

  it('extracts an informational project name, labeled, whole-page', () => {
    const result = extractTitleBlockFields('PROJECT: HARBOUR VIEW TOWER\nDRAWING NO: S-101\nREV: C', 'embedded_text')!;
    expect(result.projectName).toBe('HARBOUR VIEW TOWER');
    expect(result.fieldEvidence?.projectName).toEqual({ location: 'whole_page', method: 'native_text', rawText: 'HARBOUR VIEW TOWER', confidence: 0.6 });
  });

  it('extracts a labeled project name from its own cell', () => {
    const rows = [['Drawing No: S-101', 'Project: HARBOUR VIEW TOWER']];
    const result = extractTitleBlockFieldsFromCells(rows, 'embedded_text')!;
    expect(result.projectName).toBe('HARBOUR VIEW TOWER');
    expect(result.fieldEvidence?.projectName?.location).toBe('row 0, col 1');
  });
});

describe('bare drawing-number pattern never matches a plain calendar date (Drawing Identification Engine replacement regression)', () => {
  // A real false-positive risk discovered while building region-scoped
  // matching: a dash-formatted date ("13-02-2026") coincidentally
  // satisfies DRAWING_NUMBER_BARE's multi-segment shape (three
  // dash-separated alphanumeric segments) exactly as well as a real
  // drawing number like "M19-M4C-SD". Previously masked in whole-page
  // text by other, usually-present labeled fields nearby; surfaced for
  // real once a cell/region (e.g. a revision-history table's own "Date"
  // column) could be scoped and matched on its own, with nothing else
  // around to out-rank it.
  it('never extracts a bare numeric date as a drawing number, on the whole-page path', () => {
    expect(extractTitleBlockFields('13-02-2026\nsome other unrelated text', 'embedded_text')).toBeNull();
  });

  it('never extracts a bare numeric date as a drawing number, on the cell-based path', () => {
    const rows = [['Rev.', 'Date'], ['00', '13-02-2026']];
    expect(extractTitleBlockFieldsFromCells(rows, 'embedded_text')).toBeNull();
  });

  it('still extracts a real bare drawing number that merely LOOKS multi-segmented, not a date', () => {
    // "M19-M4C-SD" has 3 dash-separated segments like the date above, but
    // contains letters -- isNumericDateShape()'s regexes require purely
    // numeric segments, so this is correctly accepted.
    expect(extractTitleBlockFields('M19-M4C-SD appears here', 'embedded_text')?.drawingNumber).toBe('M19-M4C-SD');
  });

  it('still extracts a real bare drawing number shaped like an ISO date numerically but out of calendar range', () => {
    // "99-99-9999" has the right shape but is not a real calendar date in
    // either DD-MM or MM-DD reading -- isNumericDateShape() correctly
    // reports false, so this is NOT rejected as a date and is accepted
    // as a bare drawing-number-shaped match.
    expect(extractTitleBlockFields('99-99-9999 appears here', 'embedded_text')?.drawingNumber).toBe('99-99-9999');
  });
});
