import { classifyRiskMovement, type RiskRow } from './risk.service';

const since = new Date('2024-06-01T00:00:00Z');
const beforeWindow = '2024-05-01T00:00:00Z';
const afterWindow = '2024-06-15T00:00:00Z';

function risk(overrides: Partial<RiskRow> & { id: string; score: number }): Pick<RiskRow, 'id' | 'score' | 'status' | 'firstDetectedAt' | 'resolvedAt' | 'closedAt'> {
  return {
    status: 'ACTIVE',
    firstDetectedAt: beforeWindow,
    resolvedAt: null,
    closedAt: null,
    ...overrides,
  };
}

describe('classifyRiskMovement — Risk Movement section (brief Phase 3)', () => {
  it('buckets a risk created during the window as emerged, regardless of score', () => {
    const r = risk({ id: 'r1', score: 50, firstDetectedAt: afterWindow });
    const result = classifyRiskMovement([r], since, new Map());
    expect(result.emerged).toEqual([r]);
    expect(result.worsened).toEqual([]);
    expect(result.improved).toEqual([]);
    expect(result.unresolved).toEqual([]);
  });

  it('buckets an open, pre-existing risk whose score rose by the material threshold as worsened', () => {
    const r = risk({ id: 'r1', score: 60 });
    const result = classifyRiskMovement([r], since, new Map([['r1', 50]]));
    expect(result.worsened).toEqual([{ risk: r, deltaScore: 10 }]);
    expect(result.improved).toEqual([]);
    expect(result.unresolved).toEqual([]);
  });

  it('buckets an open, pre-existing risk whose score fell by the material threshold as improved', () => {
    const r = risk({ id: 'r1', score: 40 });
    const result = classifyRiskMovement([r], since, new Map([['r1', 55]]));
    expect(result.improved).toEqual([{ risk: r, deltaScore: -15 }]);
    expect(result.worsened).toEqual([]);
  });

  it('buckets a sub-threshold change as unresolved, not worsened or improved', () => {
    const r = risk({ id: 'r1', score: 52 });
    const result = classifyRiskMovement([r], since, new Map([['r1', 50]]));
    expect(result.unresolved).toEqual([r]);
    expect(result.worsened).toEqual([]);
    expect(result.improved).toEqual([]);
  });

  it('excludes a pre-existing open risk with no prior snapshot from every bucket, rather than guessing', () => {
    const r = risk({ id: 'r1', score: 70 });
    const result = classifyRiskMovement([r], since, new Map());
    expect(result.worsened).toEqual([]);
    expect(result.improved).toEqual([]);
    expect(result.unresolved).toEqual([]);
    expect(result.emerged).toEqual([]);
  });

  it('buckets a risk resolved or closed during the window as resolvedDuringPeriod, and excludes it from the open-risk buckets', () => {
    const resolved = risk({ id: 'r1', score: 10, status: 'RESOLVED', resolvedAt: afterWindow });
    const closed = risk({ id: 'r2', score: 5, status: 'CLOSED', closedAt: afterWindow });
    const resolvedBefore = risk({ id: 'r3', score: 5, status: 'RESOLVED', resolvedAt: beforeWindow });
    const result = classifyRiskMovement([resolved, closed, resolvedBefore], since, new Map());
    expect(result.resolvedDuringPeriod).toEqual([resolved, closed]);
    expect(result.unresolved).toEqual([]);
  });

  it('sorts worsened by largest increase first and improved by largest decrease first', () => {
    const small = risk({ id: 'small', score: 55 });
    const big = risk({ id: 'big', score: 90 });
    const result = classifyRiskMovement([small, big], since, new Map([['small', 50], ['big', 50]]));
    expect(result.worsened.map(w => w.risk.id)).toEqual(['big', 'small']);
  });
});
