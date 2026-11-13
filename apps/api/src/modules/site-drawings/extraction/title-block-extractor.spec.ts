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
    expect(result?.drawingTitle).toBe('GROUND FLOOR STEEL DOOR KEY PLAN');
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
  it('extracts a labeled drawing number, revision and title each from their own cell', () => {
    const cells = ['Drawing No: S-101', 'Rev: C', 'Drawing Title: GROUND FLOOR PLAN - STRUCTURAL LAYOUT', 'Date: 12/03/2025'];
    const result = extractTitleBlockFieldsFromCells(cells, 'embedded_text');
    expect(result?.drawingNumber).toBe('S-101');
    expect(result?.revisionNumber).toBe('C');
    expect(result?.drawingTitle).toBe('GROUND FLOOR PLAN - STRUCTURAL LAYOUT');
    expect(result?.issueDate).toBe('12/03/2025');
    expect(result?.discipline).toBe('Structural');
  });

  it('returns null when no cell contains a plausible drawing number', () => {
    const cells = ['Checked By: J. Smith', 'Scale: 1:100', 'Notes: see general notes'];
    expect(extractTitleBlockFieldsFromCells(cells, 'embedded_text')).toBeNull();
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
    const cells = [
      'Drawing No: M-05713',
      'Drawing Title: GROUND FLOOR STEEL DOOR KEY PLAN',
      'Revision: 00',
      'Equipment Schedule: AHU-04, AHU-05',
      'Project Code: SE45_01',
    ];
    const result = extractTitleBlockFieldsFromCells(cells, 'embedded_text');
    expect(result?.drawingNumber).toBe('M-05713');
    expect(result?.drawingTitle).toBe('GROUND FLOOR STEEL DOOR KEY PLAN');
    expect(result?.revisionNumber).toBe('00');
  });

  it('tries a labeled match across every cell before falling back to any bare match', () => {
    // The labeled drawing number lives in the LAST cell, a bare-pattern-
    // shaped token in the FIRST -- array order must not matter.
    const cells = ['A-999', 'Checked By: J. Smith', 'Drawing No: S-101'];
    const result = extractTitleBlockFieldsFromCells(cells, 'embedded_text');
    expect(result?.drawingNumber).toBe('S-101');
  });

  it('rejects an implausible labeled match (no digits) in one cell and falls back to a bare match in another', () => {
    const cells = ['Drawing No: Checked', 'M19-M4C-C0-PW-AX-SD-05713'];
    const result = extractTitleBlockFieldsFromCells(cells, 'embedded_text');
    expect(result?.drawingNumber).toBe('M19-M4C-C0-PW-AX-SD-05713');
  });

  it('pairs a bare label cell with the next cell as its value, for a layout where label and value are in separate adjacent cells', () => {
    // Confirmed by hand against a reproduction PDF built with a real
    // bordered grid (pdf-lib + pdf-parse's getTable()): a common title-
    // block layout puts a field's label and its value in two separate
    // cells side by side, not combined in one cell's text. getTable()'s
    // flattening walks a table row by row, left to right, so the value
    // cell is the very next entry after its label cell in this array.
    const cells = ['Drawing No:', 'S-101', 'Drawing Title:', 'GROUND FLOOR STEEL DOOR KEY PLAN', 'Revision:', '00', 'Equipment Schedule:', 'AHU-04'];
    const result = extractTitleBlockFieldsFromCells(cells, 'embedded_text');
    expect(result?.drawingNumber).toBe('S-101');
    expect(result?.drawingTitle).toBe('GROUND FLOOR STEEL DOOR KEY PLAN');
    expect(result?.revisionNumber).toBe('00');
  });

  it('never invents a revision or title that is not actually present in any cell', () => {
    const cells = ['DWG NO: M-301', 'Checked By: J. Smith'];
    const result = extractTitleBlockFieldsFromCells(cells, 'embedded_text');
    expect(result?.drawingNumber).toBe('M-301');
    expect(result?.revisionNumber).toBeUndefined();
    expect(result?.drawingTitle).toBeUndefined();
  });
});
