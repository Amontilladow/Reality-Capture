import { describe, expect, it } from 'vitest';
import { siteDrawingOverlay } from './siteDrawingDisplay';

// The PDF viewer's on-canvas status stamp (brief: "system-generated digital
// status overlays... without modifying the original consultant-issued
// PDF") is computed by this function alone; SiteDrawingPdfViewer just
// draws whatever it returns. Covering the mapping here is covering the
// actual decision logic without needing a canvas/pdf.js in the test
// environment.
describe('siteDrawingOverlay', () => {
  const base = { workflowStatus: 'APPROVED_FOR_CONSTRUCTION' as const, isSuperseded: false, documentClassification: 'CONSTRUCTION' as const };

  it('supersession outranks everything else, including an otherwise-approved status', () => {
    expect(siteDrawingOverlay({ ...base, isSuperseded: true }).label).toBe('SUPERSEDED — DO NOT USE FOR CONSTRUCTION');
  });

  it('withdrawn and rejected both read as explicit do-not-use', () => {
    expect(siteDrawingOverlay({ ...base, workflowStatus: 'WITHDRAWN' }).label).toBe('WITHDRAWN — DO NOT USE');
    expect(siteDrawingOverlay({ ...base, workflowStatus: 'REJECTED' }).label).toBe('REJECTED — DO NOT USE');
  });

  it('document classification (FINAL/AS_BUILT) overrides a plain approval label', () => {
    expect(siteDrawingOverlay({ ...base, documentClassification: 'AS_BUILT' }).label).toBe('AS-BUILT');
    expect(siteDrawingOverlay({ ...base, documentClassification: 'FINAL' }).label).toBe('FINAL');
  });

  it('APPROVED_FOR_CONSTRUCTION, not superseded, construction classification -> Good For Construction', () => {
    expect(siteDrawingOverlay(base).label).toBe('GOOD FOR CONSTRUCTION');
  });

  it('a plain APPROVED status is distinct from APPROVED_FOR_CONSTRUCTION -- never implies site-use', () => {
    expect(siteDrawingOverlay({ ...base, workflowStatus: 'APPROVED' }).label).toBe('APPROVED — NOT FOR CONSTRUCTION');
  });

  it('under review and unknown both surface an explicit warning, never a silent default', () => {
    expect(siteDrawingOverlay({ ...base, workflowStatus: 'UNDER_REVIEW' }).label).toBe('UNDER REVIEW');
    expect(siteDrawingOverlay({ ...base, workflowStatus: 'UNKNOWN' }).label).toBe('STATUS UNVERIFIED');
  });

  it('every branch returns a real color, never an empty/undefined value', () => {
    for (const status of ['UNDER_REVIEW', 'APPROVED', 'APPROVED_FOR_CONSTRUCTION', 'REJECTED', 'SUPERSEDED', 'WITHDRAWN', 'UNKNOWN'] as const) {
      const overlay = siteDrawingOverlay({ ...base, workflowStatus: status });
      expect(overlay.color).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});
