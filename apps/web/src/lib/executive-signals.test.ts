import { describe, it, expect } from 'vitest';
import { buildSignals, deriveOverallStatus, buildConclusion } from './executive-signals';

describe('buildSignals', () => {
  it('returns no signals and ranks nothing when every input is clean', () => {
    expect(buildSignals('/projects/p1', {
      risk: { criticalCount: 0, overdueCount: 0 },
      issues: { critical: 0, overdue: 0 },
      rfis: { overdue: 0 },
      qaqc: { critical: 0, overdue: 0 },
      snagging: { overdue: 0 },
    })).toEqual([]);
  });

  it('sorts critical-severity signals before high before medium, regardless of input order', () => {
    const signals = buildSignals('/projects/p1', {
      snagging: { overdue: 3 }, // medium
      rfis: { overdue: 2 },     // high
      qaqc: { critical: 1, overdue: 0 }, // critical
    });
    expect(signals.map((s) => s.severity)).toEqual(['critical', 'high', 'medium']);
    expect(signals[0].domain).toBe('QAQC');
  });

  it('links each signal to the given basePath, scoped per domain', () => {
    const signals = buildSignals('/projects/abc', { risk: { criticalCount: 1, overdueCount: 0 } });
    expect(signals[0].to).toBe('/projects/abc/risk');
  });

  it('omits a domain entirely when its input is not provided, rather than treating it as zero', () => {
    const signals = buildSignals('/projects/p1', { bimFailedCount: 2 });
    expect(signals).toHaveLength(1);
    expect(signals[0].domain).toBe('BIM');
  });
});

describe('deriveOverallStatus', () => {
  it('is no_data when there is no recorded activity, even with zero signals', () => {
    expect(deriveOverallStatus([], false)).toBe('no_data');
  });

  it('is stable when there is activity but nothing flagged', () => {
    expect(deriveOverallStatus([], true)).toBe('stable');
  });

  it('is critical if any signal is critical-severity', () => {
    const signals = buildSignals('/projects/p1', { risk: { criticalCount: 1, overdueCount: 0 } });
    expect(deriveOverallStatus(signals, true)).toBe('critical');
  });

  it('is at_risk when the worst signal is high-severity, never critical', () => {
    const signals = buildSignals('/projects/p1', { rfis: { overdue: 1 } });
    expect(deriveOverallStatus(signals, true)).toBe('at_risk');
  });
});

describe('buildConclusion', () => {
  it('names the top-ranked signal and, when present, its project', () => {
    const signals = buildSignals('/projects/p1', { risk: { criticalCount: 2, overdueCount: 0 } });
    const tagged = [{ ...signals[0], projectName: 'Tower A' }];
    const text = buildConclusion('critical', tagged, 'across the portfolio');
    expect(text).toContain('Tower A');
    expect(text).toContain('critical risk');
  });

  it('never fabricates a conclusion when there is no underlying activity', () => {
    const text = buildConclusion('no_data', [], 'on this project');
    expect(text).toMatch(/not enough activity/i);
  });
});
