import { computeFinalMatrix, RiskService } from './risk.service';
import { scoreToMatrixLevel, DEFAULT_RISK_MATRIX_THRESHOLDS } from '@engineeringos/types';

describe('scoreToMatrixLevel — the brief\'s own 5x5 Probability x Impact table (section 4)', () => {
  it.each([
    [1, 'LOW'], [4, 'LOW'],
    [5, 'MEDIUM'], [9, 'MEDIUM'],
    [10, 'HIGH'], [14, 'HIGH'],
    [15, 'VERY_HIGH'], [19, 'VERY_HIGH'],
    [20, 'CRITICAL'], [25, 'CRITICAL'],
  ] as const)('classifies score %i as %s', (score, level) => {
    expect(scoreToMatrixLevel(score)).toBe(level);
  });

  it('honors a company-configured threshold override rather than the hardcoded default', () => {
    const customThresholds = { ...DEFAULT_RISK_MATRIX_THRESHOLDS, high: [8, 14] as [number, number] };
    expect(scoreToMatrixLevel(8, customThresholds)).toBe('HIGH');
    expect(scoreToMatrixLevel(8)).toBe('MEDIUM');
  });
});

describe('computeFinalMatrix — never invents a value, never silently prefers AI over a human judgment call', () => {
  it('falls back to the AI score when no human assessment and no override exist', () => {
    const result = computeFinalMatrix({ humanScore: null, humanLevel: null, aiScore: 18, aiLevel: 'VERY_HIGH' });
    expect(result).toEqual({ finalScore: 18, finalLevel: 'VERY_HIGH' });
  });

  it('is null/null (never a fabricated value) when neither a human nor an AI assessment exists yet', () => {
    const result = computeFinalMatrix({ humanScore: null, humanLevel: null, aiScore: null, aiLevel: null });
    expect(result).toEqual({ finalScore: null, finalLevel: null });
  });

  it('prefers the human assessment over the AI score once one exists (brief section 11 default: "Keep Human Assessment")', () => {
    const result = computeFinalMatrix({ humanScore: 9, humanLevel: 'MEDIUM', aiScore: 18, aiLevel: 'VERY_HIGH' });
    expect(result).toEqual({ finalScore: 9, finalLevel: 'MEDIUM' });
  });

  it('prefers an explicit engineer override over both the human and AI assessments', () => {
    const result = computeFinalMatrix(
      { humanScore: 9, humanLevel: 'MEDIUM', aiScore: 18, aiLevel: 'VERY_HIGH' },
      { score: 18, level: 'VERY_HIGH' },
    );
    expect(result).toEqual({ finalScore: 18, finalLevel: 'VERY_HIGH' });
  });
});

describe('RiskService.detectMatrixDiscrepancy — Human-vs-AI disagreement, never flagged on partial data', () => {
  it('returns null when no human assessment exists yet (nothing to disagree with)', () => {
    const result = RiskService.detectMatrixDiscrepancy({ humanScore: null, humanLevel: null, aiScore: 18, aiLevel: 'VERY_HIGH', matrixOverrideBy: null });
    expect(result).toBeNull();
  });

  it('returns null when the AI score has not been computed yet', () => {
    const result = RiskService.detectMatrixDiscrepancy({ humanScore: 9, humanLevel: 'MEDIUM', aiScore: null, aiLevel: null, matrixOverrideBy: null });
    expect(result).toBeNull();
  });

  it('reports no discrepancy when human and AI land on the same level', () => {
    const result = RiskService.detectMatrixDiscrepancy({ humanScore: 9, humanLevel: 'MEDIUM', aiScore: 6, aiLevel: 'MEDIUM', matrixOverrideBy: null });
    expect(result).toEqual({ hasDiscrepancy: false, levelGap: 0, scoreDelta: 3, reviewed: false });
  });

  it('reports a discrepancy with the correct level gap and score delta when they disagree', () => {
    const result = RiskService.detectMatrixDiscrepancy({ humanScore: 4, humanLevel: 'LOW', aiScore: 20, aiLevel: 'CRITICAL', matrixOverrideBy: null });
    expect(result).toEqual({ hasDiscrepancy: true, levelGap: 4, scoreDelta: 16, reviewed: false });
  });

  it('marks a discrepancy as reviewed once an engineer has applied a matrix override', () => {
    const result = RiskService.detectMatrixDiscrepancy({ humanScore: 4, humanLevel: 'LOW', aiScore: 20, aiLevel: 'CRITICAL', matrixOverrideBy: 'user-1' });
    expect(result).toEqual({ hasDiscrepancy: true, levelGap: 4, scoreDelta: 16, reviewed: true });
  });
});
