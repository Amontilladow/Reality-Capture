import { extractTitleBlockFields, isConfidentExtraction, EXTRACTION_CONFIDENCE_CONFIRMED_THRESHOLD } from './title-block-extractor';

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

  it('isConfidentExtraction requires both a high confidence score AND a revision number', () => {
    expect(isConfidentExtraction({ drawingNumber: 'A-1', source: 'embedded_text', confidence: EXTRACTION_CONFIDENCE_CONFIRMED_THRESHOLD, revisionNumber: 'A' })).toBe(true);
    expect(isConfidentExtraction({ drawingNumber: 'A-1', source: 'embedded_text', confidence: EXTRACTION_CONFIDENCE_CONFIRMED_THRESHOLD })).toBe(false); // no revision
    expect(isConfidentExtraction({ drawingNumber: 'A-1', source: 'embedded_text', confidence: 0.1, revisionNumber: 'A' })).toBe(false); // too low
  });
});
