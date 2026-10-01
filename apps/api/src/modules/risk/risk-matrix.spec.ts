import { computeFinalMatrix } from './risk.service';
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
