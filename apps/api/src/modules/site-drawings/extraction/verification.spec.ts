import type { ExtractedDrawingFields, FieldEvidence } from '@engineeringos/types';
import {
  applyFieldVerification,
  determineFieldState,
  extractSupplementaryRevisionFromHistoryTable,
  fillMissingFieldsFromSupplementarySources,
} from './verification';

function evidence(overrides: Partial<FieldEvidence> = {}): FieldEvidence {
  return { location: 'row 0, col 0', method: 'native_text', confidence: 0.85, ...overrides };
}

function baseFields(overrides: Partial<ExtractedDrawingFields> = {}): ExtractedDrawingFields {
  return { drawingNumber: 'S-101', source: 'embedded_text', confidence: 0.85, ...overrides };
}

describe('determineFieldState', () => {
  it('is MISSING when there is no value at all, regardless of evidence', () => {
    expect(determineFieldState(undefined, evidence())).toBe('MISSING');
    expect(determineFieldState(undefined, undefined)).toBe('MISSING');
  });

  it('is VERIFIED for a cell-scoped match with confidence at or above the confirmed threshold', () => {
    expect(determineFieldState('S-101', evidence({ confidence: 0.85 }))).toBe('VERIFIED');
  });

  it('is never VERIFIED for a whole-page match, however confident -- "extracted" is not "verified"', () => {
    expect(determineFieldState('S-101', evidence({ location: 'whole_page', confidence: 0.99 }))).toBe('UNVERIFIED');
  });

  it('is never VERIFIED for a filename-sourced hint', () => {
    expect(determineFieldState('S-101', evidence({ method: 'filename', confidence: 0.99 }))).toBe('UNVERIFIED');
  });

  it('is never VERIFIED for a revision-table supplementary hint', () => {
    expect(determineFieldState('C', evidence({ method: 'revision_table', confidence: 0.99 }))).toBe('UNVERIFIED');
  });

  it('is UNVERIFIED for a cell-scoped match below the confirmed-confidence threshold', () => {
    expect(determineFieldState('S-101', evidence({ confidence: 0.4 }))).toBe('UNVERIFIED');
  });

  it('is UNVERIFIED when a value exists with no evidence recorded at all', () => {
    expect(determineFieldState('S-101', undefined)).toBe('UNVERIFIED');
  });
});

describe('applyFieldVerification', () => {
  it('computes a state for every known field, including ones with no value (MISSING)', () => {
    const fields = baseFields({ fieldEvidence: { drawingNumber: evidence() } });
    const result = applyFieldVerification(fields);
    expect(result.fieldStates?.drawingNumber).toBe('VERIFIED');
    expect(result.fieldStates?.drawingTitle).toBe('MISSING');
    expect(result.fieldStates?.revisionNumber).toBe('MISSING');
    expect(result.fieldStates?.projectName).toBe('MISSING');
  });

  it('is idempotent -- calling it again after nothing changed gives the same states', () => {
    const fields = baseFields({ fieldEvidence: { drawingNumber: evidence() } });
    const once = applyFieldVerification(fields);
    const twice = applyFieldVerification(once);
    expect(twice.fieldStates).toEqual(once.fieldStates);
  });
});

describe('fillMissingFieldsFromSupplementarySources', () => {
  it('fills a MISSING field from a supplementary hint', () => {
    const fields = baseFields({ fieldEvidence: { drawingNumber: evidence() } });
    const result = fillMissingFieldsFromSupplementarySources(fields, {
      revisionNumber: { value: 'C', evidence: evidence({ method: 'revision_table', location: 'row 2, col 0', confidence: 0.5 }) },
    });
    expect(result.revisionNumber).toBe('C');
    expect(result.fieldEvidence?.revisionNumber?.method).toBe('revision_table');
    expect(result.fieldStates?.revisionNumber).toBe('UNVERIFIED'); // a supplementary fill is never VERIFIED
  });

  it('NEVER overrides a field that already has a title-block-sourced value, even a confident supplementary hint', () => {
    const fields = baseFields({ revisionNumber: 'B', fieldEvidence: { drawingNumber: evidence(), revisionNumber: evidence({ confidence: 0.9 }) } });
    const result = fillMissingFieldsFromSupplementarySources(fields, {
      revisionNumber: { value: 'Z', evidence: evidence({ method: 'revision_table', confidence: 0.99 }) },
    });
    expect(result.revisionNumber).toBe('B'); // untouched
    expect(result.fieldEvidence?.revisionNumber?.method).toBe('native_text'); // original evidence untouched too
  });

  it('leaves every field untouched when no hints are given', () => {
    const fields = baseFields({ fieldEvidence: { drawingNumber: evidence() } });
    const result = fillMissingFieldsFromSupplementarySources(fields, {});
    expect(result.drawingNumber).toBe('S-101');
    expect(result.revisionNumber).toBeUndefined();
  });
});

describe('extractSupplementaryRevisionFromHistoryTable', () => {
  it('reads the LATEST row of a real revision-history table (Rev./Date header)', () => {
    const rows = [
      ['Rev.', 'Date', 'Reason For Issue'],
      ['00', '13-02-2026', 'Issued For Approval'],
      ['A', '20-03-2026', 'Issued For Construction'],
    ];
    const hint = extractSupplementaryRevisionFromHistoryTable(rows);
    expect(hint?.value).toBe('A');
    expect(hint?.evidence.method).toBe('revision_table');
    expect(hint?.evidence.location).toBe('row 2, col 0');
  });

  it('returns null for a table that is not shaped like a revision-history log', () => {
    const rows = [['Drawing No:', 'Rev:'], ['S-101', 'C']];
    expect(extractSupplementaryRevisionFromHistoryTable(rows)).toBeNull();
  });

  it('returns null when the header matches but the last row\'s value is not a plausible revision shape', () => {
    const rows = [
      ['Revision', 'Date'],
      ['Issued For Approval, see notes', '13-02-2026'],
    ];
    expect(extractSupplementaryRevisionFromHistoryTable(rows)).toBeNull();
  });

  it('returns null for a single-row or empty table', () => {
    expect(extractSupplementaryRevisionFromHistoryTable([])).toBeNull();
    expect(extractSupplementaryRevisionFromHistoryTable([['Rev.', 'Date']])).toBeNull();
  });
});
