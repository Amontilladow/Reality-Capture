import { describe, expect, it } from 'vitest';
import { splitRiskTitle } from './risk-title';

describe('splitRiskTitle', () => {
  it('moves the source record out of an engine-generated title', () => {
    expect(splitRiskTitle('Unresolved RFI: TGAD-GEN-RFI-ARC-0001 — FOH Entrance')).toEqual({
      subject: 'FOH Entrance', source: 'RFI · TGAD-GEN-RFI-ARC-0001',
    });
    expect(splitRiskTitle('Open NCR: NCR-001 — Concrete cover below spec at TB-07')).toEqual({
      subject: 'Concrete cover below spec at TB-07', source: 'NCR · NCR-001',
    });
    expect(splitRiskTitle('Unresolved Issue: TGAD-OTHER-0003 — trash box')).toEqual({
      subject: 'trash box', source: 'Issue · TGAD-OTHER-0003',
    });
  });

  it('leaves a free-text title alone', () => {
    expect(splitRiskTitle('Crane permit may lapse before lift')).toEqual({ subject: 'Crane permit may lapse before lift' });
  });
});
