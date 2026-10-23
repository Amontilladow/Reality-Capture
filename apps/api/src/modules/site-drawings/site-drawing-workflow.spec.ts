import { isValidForSiteUse, isConfirmedCurrent, needsApprovalWarning, fallbackMapSourceStatus, documentClassificationLabel } from './site-drawing-workflow';
import { SITE_DRAWING_WORKFLOW_STATUSES, type SiteDrawingWorkflowStatus } from '@engineeringos/types';

describe('isValidForSiteUse', () => {
  it('is true only for APPROVED and APPROVED_FOR_CONSTRUCTION', () => {
    const valid: SiteDrawingWorkflowStatus[] = ['APPROVED', 'APPROVED_FOR_CONSTRUCTION'];
    for (const status of SITE_DRAWING_WORKFLOW_STATUSES) {
      expect(isValidForSiteUse(status)).toBe(valid.includes(status));
    }
  });

  it('acceptance test 4: an Under Review or Rejected revision is never valid for site use', () => {
    expect(isValidForSiteUse('UNDER_REVIEW')).toBe(false);
    expect(isValidForSiteUse('REJECTED')).toBe(false);
  });

  it('treats an unmapped/unknown status as not valid for site use, never as a silent pass', () => {
    expect(isValidForSiteUse('UNKNOWN')).toBe(false);
  });
});

describe('isConfirmedCurrent', () => {
  it('requires both a valid-for-site-use status AND not superseded', () => {
    expect(isConfirmedCurrent('APPROVED_FOR_CONSTRUCTION', false)).toBe(true);
    expect(isConfirmedCurrent('APPROVED_FOR_CONSTRUCTION', true)).toBe(false);
    expect(isConfirmedCurrent('UNDER_REVIEW', false)).toBe(false);
  });

  it('acceptance test 5: a superseded drawing is never confirmed current, even if its own status is approved', () => {
    expect(isConfirmedCurrent('APPROVED', true)).toBe(false);
  });

  it('defaults documentClassification to CONSTRUCTION when omitted, preserving every pre-migration-075 call site\'s behavior', () => {
    expect(isConfirmedCurrent('APPROVED_FOR_CONSTRUCTION', false)).toBe(true);
  });

  it('a FINAL or AS_BUILT document is never confirmed current, even when approved and not superseded (Decision 2)', () => {
    expect(isConfirmedCurrent('APPROVED_FOR_CONSTRUCTION', false, 'FINAL')).toBe(false);
    expect(isConfirmedCurrent('APPROVED_FOR_CONSTRUCTION', false, 'AS_BUILT')).toBe(false);
  });

  it('a CONSTRUCTION-classified document with an otherwise-valid status is confirmed current', () => {
    expect(isConfirmedCurrent('APPROVED_FOR_CONSTRUCTION', false, 'CONSTRUCTION')).toBe(true);
  });
});

describe('documentClassificationLabel', () => {
  it('labels every classification', () => {
    expect(documentClassificationLabel('CONSTRUCTION')).toBe('Construction');
    expect(documentClassificationLabel('FINAL')).toBe('Final');
    expect(documentClassificationLabel('AS_BUILT')).toBe('As-Built');
  });
});

describe('needsApprovalWarning', () => {
  it('flags UNKNOWN and UNDER_REVIEW for an explicit warning', () => {
    expect(needsApprovalWarning('UNKNOWN')).toBe(true);
    expect(needsApprovalWarning('UNDER_REVIEW')).toBe(true);
  });

  it('does not flag a definite status either way', () => {
    expect(needsApprovalWarning('APPROVED_FOR_CONSTRUCTION')).toBe(false);
    expect(needsApprovalWarning('REJECTED')).toBe(false);
    expect(needsApprovalWarning('SUPERSEDED')).toBe(false);
    expect(needsApprovalWarning('WITHDRAWN')).toBe(false);
  });
});

describe('fallbackMapSourceStatus', () => {
  it('maps common IFC/approved-for-construction phrasing', () => {
    expect(fallbackMapSourceStatus('Issued for Construction')).toBe('APPROVED_FOR_CONSTRUCTION');
    expect(fallbackMapSourceStatus('IFC')).toBe('APPROVED_FOR_CONSTRUCTION');
    expect(fallbackMapSourceStatus('Approved for Construction')).toBe('APPROVED_FOR_CONSTRUCTION');
  });

  it('maps a plain "Approved" without construction wording to APPROVED, not APPROVED_FOR_CONSTRUCTION', () => {
    expect(fallbackMapSourceStatus('Approved')).toBe('APPROVED');
  });

  it('maps rejected/returned phrasing to REJECTED', () => {
    expect(fallbackMapSourceStatus('Rejected')).toBe('REJECTED');
    expect(fallbackMapSourceStatus('Returned for revision')).toBe('REJECTED');
  });

  it('never infers a confident status from an empty, null, or unrecognized string', () => {
    expect(fallbackMapSourceStatus(null)).toBe('UNKNOWN');
    expect(fallbackMapSourceStatus(undefined)).toBe('UNKNOWN');
    expect(fallbackMapSourceStatus('')).toBe('UNKNOWN');
    expect(fallbackMapSourceStatus('Draft v3 - client copy')).toBe('UNKNOWN');
  });
});
