import { ScoringService } from './scoring.service';
import type { RiskGraphService, GraphNodeRow } from './risk-graph.service';

function makeNode(id: string, nodeType: GraphNodeRow['nodeType'], overrides: Partial<GraphNodeRow> = {}): GraphNodeRow {
  return {
    id, companyId: 'c1', projectId: 'p1', nodeType, entityId: id, entityTable: 'x', label: id,
    discipline: null, status: null, priority: null, dueDate: null, metadata: {},
    createdAt: '', updatedAt: '', ...overrides,
  };
}

function makeGraphMock(neighborhoodNodes: GraphNodeRow[]): RiskGraphService {
  return {
    getNeighborhood: jest.fn(async () => ({ nodes: [makeNode('root', 'rfi'), ...neighborhoodNodes], edges: [] })),
  } as unknown as RiskGraphService;
}

describe('ScoringService.computeGraphExposure — graph-based amplification (brief section 12)', () => {
  it('gives a small, non-zero exposure to a risk connected to just one non-critical downstream node', async () => {
    const svc = new ScoringService(makeGraphMock([makeNode('act-1', 'issue')]));
    const result = await svc.computeGraphExposure('c1', 'root');
    expect(result.exposureScore).toBeGreaterThan(0);
    expect(result.exposureScore).toBeLessThan(40);
  });

  it('gives substantially greater exposure to a risk connected to many elements across several disciplines (the brief\'s own worked example)', async () => {
    const wideNeighborhood = [
      ...Array.from({ length: 42 }, (_, i) => makeNode(`el-${i}`, 'bim_element')),
      ...Array.from({ length: 4 }, (_, i) => makeNode(`issue-${i}`, 'issue', { discipline: i % 3 === 0 ? 'MEP' : i % 3 === 1 ? 'STRUCTURAL' : 'ELECTRICAL' })),
      makeNode('drawing-1', 'drawing'),
    ];
    const narrow = new ScoringService(makeGraphMock([makeNode('act-1', 'issue')]));
    const wide = new ScoringService(makeGraphMock(wideNeighborhood));

    const narrowResult = await narrow.computeGraphExposure('c1', 'root');
    const wideResult = await wide.computeGraphExposure('c1', 'root');

    expect(wideResult.exposureScore).toBeGreaterThan(narrowResult.exposureScore);
    expect(wideResult.dependencyScore).toBeGreaterThan(narrowResult.dependencyScore);
    expect(wideResult.disciplineCount).toBe(3);
  });

  it('never simply counts nodes — weights structural nodes (building/level/location) at zero', async () => {
    const structuralOnly = new ScoringService(makeGraphMock([
      makeNode('b1', 'building'), makeNode('l1', 'level'), makeNode('loc1', 'location'), makeNode('u1', 'user'),
    ]));
    const result = await structuralOnly.computeGraphExposure('c1', 'root');
    expect(result.exposureScore).toBe(0);
  });

  it('never lets exposure grow unbounded — the saturating curve caps well under 100 even for a very large neighborhood', async () => {
    const huge = new ScoringService(makeGraphMock(Array.from({ length: 200 }, (_, i) => makeNode(`el-${i}`, 'bim_element'))));
    const result = await huge.computeGraphExposure('c1', 'root');
    expect(result.exposureScore).toBeLessThanOrEqual(100);
    expect(result.exposureScore).toBeGreaterThan(80); // clearly high, but the curve saturates rather than mattering whether it's 200 or 2000
  });
});

describe('ScoringService.computeFactorsFromSignals — deterministic per-factor mapping (Scenarios A, D)', () => {
  const noExposure = { exposureScore: 0, dependencyScore: 0, distinctNodeTypeCount: 0, weightedNodeCount: 0, disciplineCount: 0, hasImminentDownstreamDueDate: false, nodeCountByType: {} };

  it('Scenario A: an overdue RFI signal increases probability and urgency', () => {
    const svc = new ScoringService({} as RiskGraphService);
    const factors = svc.computeFactorsFromSignals([{ signalType: 'RFI_OVERDUE', severityContribution: 70 }], noExposure);
    expect(factors.probability).toBeGreaterThan(0);
    expect(factors.urgency).toBeGreaterThan(0);
  });

  it('Scenario D: a recurring-location signal increases the recurrence factor specifically', () => {
    const svc = new ScoringService({} as RiskGraphService);
    const withRecurrence = svc.computeFactorsFromSignals([{ signalType: 'ISSUE_RECURRING_LOCATION', severityContribution: 50 }], noExposure);
    const withoutRecurrence = svc.computeFactorsFromSignals([{ signalType: 'ISSUE_HIGH_SEVERITY', severityContribution: 50 }], noExposure);
    expect(withRecurrence.recurrence).toBeGreaterThan(withoutRecurrence.recurrence);
  });

  it('Scenario F: no signals and no exposure produces all-zero factors — never a fabricated non-zero risk', () => {
    const svc = new ScoringService({} as RiskGraphService);
    const factors = svc.computeFactorsFromSignals([], noExposure);
    expect(Object.values(factors).every(v => v === 0)).toBe(true);
    expect(svc.computeScore(factors)).toBe(0);
  });
});

describe('ScoringService.computeScore / levelForScore — deterministic, configurable thresholds', () => {
  it('is a pure deterministic function of its factors (same input, same output)', () => {
    const svc = new ScoringService({} as RiskGraphService);
    const factors = { probability: 60, impact: 70, exposure: 40, dependency: 50, urgency: 55, recurrence: 20 };
    expect(svc.computeScore(factors)).toBe(svc.computeScore(factors));
  });

  it('normalizes weights defensively even if they do not sum to exactly 1', () => {
    const svc = new ScoringService({} as RiskGraphService);
    const factors = { probability: 100, impact: 100, exposure: 100, dependency: 100, urgency: 100, recurrence: 100 };
    // Weights sum to 2, not 1 -- should still normalize to a max of 100, not 200.
    const score = svc.computeScore(factors, { probability: 0.4, impact: 0.4, exposure: 0.4, dependency: 0.4, urgency: 0.2, recurrence: 0.2 });
    expect(score).toBe(100);
  });

  it('uses the configurable thresholds, not a hardcoded UI value', () => {
    const svc = new ScoringService({} as RiskGraphService);
    expect(svc.levelForScore(80)).toBe('CRITICAL');
    expect(svc.levelForScore(80, { low: 0, moderate: 10, high: 20, critical: 90 })).toBe('HIGH');
  });
});

describe('ScoringService.confidenceForNode — confidence is separate from severity (Scenario I)', () => {
  it('reports LOW confidence when the relationship backing a risk is mostly inferred', () => {
    const svc = new ScoringService({} as RiskGraphService);
    const { level } = svc.confidenceForNode(1, 5, []);
    expect(level).toBe('LOW');
  });

  it('reports HIGH confidence when relationships are mostly explicit and no critical fields are missing', () => {
    const svc = new ScoringService({} as RiskGraphService);
    const { level } = svc.confidenceForNode(8, 1, []);
    expect(level).toBe('HIGH');
  });

  it('reports LOW confidence whenever a critical field is missing, regardless of relationship mix', () => {
    const svc = new ScoringService({} as RiskGraphService);
    const { level, reason } = svc.confidenceForNode(10, 0, ['discipline']);
    expect(level).toBe('LOW');
    expect(reason).toContain('discipline');
  });

  it('also returns a numeric confidence percent alongside level/reason', () => {
    const svc = new ScoringService({} as RiskGraphService);
    const { percent } = svc.confidenceForNode(8, 1, []);
    expect(typeof percent).toBe('number');
    expect(percent).toBeGreaterThan(0);
    expect(percent).toBeLessThanOrEqual(100);
  });
});

describe('ScoringService.computeAiMatrixScore — a deterministic rescale of the existing engine factors, never a second LLM guess', () => {
  const factors = { probability: 0, impact: 0, exposure: 0, dependency: 0, urgency: 0, recurrence: 0 };

  it('floors both probability and impact bands at 1 when the underlying factor is 0', () => {
    const svc = new ScoringService({} as RiskGraphService);
    const { score, level } = svc.computeAiMatrixScore(factors);
    expect(score).toBe(1);
    expect(level).toBe('LOW');
  });

  it('caps both bands at 5 (score 25, CRITICAL) when the underlying factor is maxed out', () => {
    const svc = new ScoringService({} as RiskGraphService);
    const { score, level } = svc.computeAiMatrixScore({ ...factors, probability: 100, impact: 100 });
    expect(score).toBe(25);
    expect(level).toBe('CRITICAL');
  });

  it('is a pure function of probability/impact — exposure/dependency/urgency/recurrence never factor into the matrix score', () => {
    const svc = new ScoringService({} as RiskGraphService);
    const a = svc.computeAiMatrixScore({ ...factors, probability: 60, impact: 40 });
    const b = svc.computeAiMatrixScore({ ...factors, probability: 60, impact: 40, exposure: 90, dependency: 90, urgency: 90, recurrence: 90 });
    expect(a).toEqual(b);
  });

  it('honors company-configured matrix thresholds rather than the hardcoded default', () => {
    const svc = new ScoringService({} as RiskGraphService);
    // probability 60 -> band 3, impact 40 -> band 2 -> score 6
    const { level } = svc.computeAiMatrixScore({ ...factors, probability: 60, impact: 40 }, { low: [1, 4], medium: [5, 9], high: [6, 14], veryHigh: [15, 19], critical: [20, 25] });
    expect(level).toBe('HIGH');
  });
});
