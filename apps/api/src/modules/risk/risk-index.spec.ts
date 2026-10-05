import { computeProjectRiskIndex } from './risk.service';

describe('computeProjectRiskIndex — a severity-weighted average, not a flat one (Phase 22)', () => {
  it('is 0 when there are no open risks — never a fabricated non-zero baseline', () => {
    expect(computeProjectRiskIndex([])).toBe(0);
  });

  it('matches a flat average when every open risk is the same level', () => {
    const risks = [{ score: 40, level: 'MODERATE' as const }, { score: 60, level: 'MODERATE' as const }];
    expect(computeProjectRiskIndex(risks)).toBe(50);
  });

  it('weighs a concentration of CRITICAL risks far more than the same count of LOW risks would pull the index down', () => {
    const tenLowOneCritical = [
      ...Array.from({ length: 10 }, () => ({ score: 5, level: 'LOW' as const })),
      { score: 90, level: 'CRITICAL' as const },
    ];
    const flatAverage = (10 * 5 + 90) / 11; // ~12.7
    const weighted = computeProjectRiskIndex(tenLowOneCritical);
    expect(weighted).toBeGreaterThan(Math.round(flatAverage));
  });

  it('stays within [0, 100] regardless of the input mix', () => {
    const allCritical = Array.from({ length: 5 }, () => ({ score: 100, level: 'CRITICAL' as const }));
    expect(computeProjectRiskIndex(allCritical)).toBe(100);
    const allLow = Array.from({ length: 5 }, () => ({ score: 0, level: 'LOW' as const }));
    expect(computeProjectRiskIndex(allLow)).toBe(0);
  });
});
