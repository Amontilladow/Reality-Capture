import { buildRiskBriefingContext, buildRiskExplanationContext, type RiskRow } from './risk.service';

const baseRisk: RiskRow = {
  id: 'risk-1', companyId: 'c1', projectId: 'p1', rootNodeId: 'node-1',
  title: 'Unresolved RFI: RFI-184 — Ceiling coordination clash', category: 'Design / RFI', discipline: 'MEP',
  locationNodeId: null, locationLabel: 'Level 12',
  automatedScore: 78, automatedLevel: 'HIGH', overrideScore: null, overrideLevel: null, overrideBy: null, overrideAt: null, overrideReason: null,
  score: 78, level: 'HIGH',
  probability: 65, impact: 70, exposure: 80, dependency: 75, urgency: 60, recurrence: 20,
  confidenceLevel: 'MODERATE', confidenceReason: 'Assessment relies mostly on inferred relationships (2 of 3).',
  humanProbability: null, humanImpact: null, humanScore: null, humanLevel: null,
  primaryDriver: null, secondaryDriver: null, humanAssessedBy: null, humanAssessedAt: null,
  aiScore: null, aiLevel: null, aiConfidence: null, finalScore: null, finalLevel: null,
  matrixOverrideBy: null, matrixOverrideAt: null, matrixOverrideReason: null,
  trend: 'INCREASING', status: 'ACTIVE', ownerId: null, dueDate: null,
  explanation: 'This rfi has 5 contributing signals, most significantly rfi overdue.',
  recommendedAction: 'Escalate this RFI for an immediate response — it is already overdue.',
  firstDetectedAt: '2026-01-01T00:00:00Z', lastCalculatedAt: '2026-01-01T00:00:00Z', resolvedAt: null, closedAt: null,
  createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
};

describe('buildRiskBriefingContext — grounds the AI briefing prompt in real computed data only', () => {
  it('includes the overall score, level, and trend when a trend exists', () => {
    const context = buildRiskBriefingContext(
      { overallScore: 62, overallLevel: 'HIGH', overallScoreTrendPct: 12, criticalCount: 2, highCount: 5, increasingCount: 3, overdueCount: 1, totalOpenRisks: 14 },
      [baseRisk],
      [],
    );
    expect(context).toContain('Overall risk score: 62/100 (HIGH)');
    expect(context).toContain('+12%');
    expect(context).toContain('Open risks: 14');
  });

  it('never claims a trend when none was computed (no fabricated percentage)', () => {
    const context = buildRiskBriefingContext(
      { overallScore: 0, overallLevel: 'LOW', overallScoreTrendPct: null, criticalCount: 0, highCount: 0, increasingCount: 0, overdueCount: 0, totalOpenRisks: 0 },
      [], [],
    );
    expect(context).not.toContain('%');
    expect(context).toContain('No open risks currently recorded.');
  });

  it('lists real top risks by title and score, never inventing risks not passed in', () => {
    const context = buildRiskBriefingContext(
      { overallScore: 50, overallLevel: 'MODERATE', overallScoreTrendPct: null, criticalCount: 0, highCount: 1, increasingCount: 0, overdueCount: 0, totalOpenRisks: 1 },
      [baseRisk], [],
    );
    expect(context).toContain(baseRisk.title);
    expect(context).toContain('[HIGH, 78]');
  });

  it('states plainly when no clusters exist, rather than omitting the topic entirely', () => {
    const context = buildRiskBriefingContext(
      { overallScore: 50, overallLevel: 'MODERATE', overallScoreTrendPct: null, criticalCount: 0, highCount: 0, increasingCount: 0, overdueCount: 0, totalOpenRisks: 1 },
      [baseRisk], [],
    );
    expect(context).toContain('No risk clusters detected.');
  });

  it('includes real cluster data when clusters are passed in', () => {
    const context = buildRiskBriefingContext(
      { overallScore: 50, overallLevel: 'MODERATE', overallScoreTrendPct: null, criticalCount: 0, highCount: 0, increasingCount: 0, overdueCount: 0, totalOpenRisks: 1 },
      [baseRisk],
      [{ location: 'Level 12', connectedRiskCount: 6, averageScore: 58 }],
    );
    expect(context).toContain('Level 12: 6 connected risks, average score 58');
  });
});

describe('buildRiskExplanationContext — grounds the AI risk explanation prompt in one risk\'s real evidence only', () => {
  it('includes score, level, trend, confidence, and every factor', () => {
    const context = buildRiskExplanationContext(baseRisk, [], { riskId: 'risk-1', steps: [] });
    expect(context).toContain('Score: 78/100 (HIGH)');
    expect(context).toContain('Trend: INCREASING');
    expect(context).toContain('Confidence: MODERATE');
    expect(context).toContain('Probability 65, Impact 70, Exposure 80, Dependency 75, Urgency 60, Recurrence 20');
  });

  it('passes through the already-computed explanation and recommended action verbatim, marked as not to be contradicted or replaced', () => {
    const context = buildRiskExplanationContext(baseRisk, [], { riskId: 'risk-1', steps: [] });
    expect(context).toContain(baseRisk.explanation!);
    expect(context).toContain(baseRisk.recommendedAction!);
    expect(context).toContain('do not contradict');
    expect(context).toContain("restate, don't replace");
  });

  it('lists only real evidence nodes passed in, never fabricating evidence', () => {
    const context = buildRiskExplanationContext(baseRisk, [
      { id: 'ev-1', nodeId: 'n1', role: 'PRIMARY_CAUSE', node: { id: 'n1', companyId: 'c1', projectId: 'p1', nodeType: 'rfi', entityId: 'e1', entityTable: 'rfis', label: 'RFI-184', discipline: null, status: null, priority: null, dueDate: null, metadata: {}, createdAt: '', updatedAt: '' } },
    ], { riskId: 'risk-1', steps: [] });
    expect(context).toContain('PRIMARY_CAUSE: rfi — RFI-184');
  });

  it('omits the risk chain line entirely when the chain has only the root step (nothing to explain)', () => {
    const context = buildRiskExplanationContext(baseRisk, [], { riskId: 'risk-1', steps: [{ nodeId: 'n1', nodeType: 'rfi', label: 'RFI-184', relationshipFromPrevious: null, confidence: null, source: null }] });
    expect(context).not.toContain('Risk chain:');
  });

  it('marks an inferred chain step\'s confidence explicitly, never presenting it as certain', () => {
    const context = buildRiskExplanationContext(baseRisk, [], {
      riskId: 'risk-1',
      steps: [
        { nodeId: 'n1', nodeType: 'rfi', label: 'RFI-184', relationshipFromPrevious: null, confidence: null, source: null },
        { nodeId: 'n2', nodeType: 'issue', label: 'Issue-1', relationshipFromPrevious: 'RELATED_TO', confidence: 0.7, source: 'RULE_INFERENCE' },
      ],
    });
    expect(context).toContain('Risk chain: RFI-184 RELATED_TO (inferred, 70%) -> Issue-1');
  });
});
