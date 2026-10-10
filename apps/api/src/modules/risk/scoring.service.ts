import { Injectable } from '@nestjs/common';
import {
  DEFAULT_RISK_LEVEL_THRESHOLDS,
  DEFAULT_RISK_SCORING_WEIGHTS,
  DEFAULT_RISK_MATRIX_THRESHOLDS,
  scoreToRiskLevel,
  scoreToMatrixLevel,
  computeConfidenceLevel,
  type RiskLevelThresholds,
  type RiskMatrixThresholds,
  type RiskMatrixLevel,
  type RiskScoreFactors,
  type RiskScoringWeights,
  type RiskConfidenceLevel,
} from '@engineeringos/types';
import { RiskGraphService } from './risk-graph.service';

// Weight given to each downstream node type when computing graph exposure
// (brief section 12 — "do NOT simply count nodes, weight node types
// intelligently"). Higher weight = more real-world consequence if this
// branch of the graph is disrupted. Building/level/location/user/company
// are structural, not consequential in themselves, so they contribute
// nothing directly (they still matter for *reaching* the consequential
// nodes, which is what the traversal count captures).
const NODE_TYPE_EXPOSURE_WEIGHT: Record<string, number> = {
  bim_element: 3,
  drawing: 1.5,
  issue: 2.5,
  snag_item: 1.5,
  qa_inspection: 1.5,
  rfi: 2,
  // NCR (formal non-conformance) weighted like issue/rfi-adjacent quality
  // risk; SOR (a lighter-weight observation, not yet a formal
  // non-conformance) weighted lower, between document and submittal.
  ncr: 2,
  sor: 1,
  document: 1,
  submittal: 1,
  transmittal: 0.5,
  capture: 0.5,
  programme_activity: 4, // schema-ready; will not appear until a programme module exists
  material: 3,
  bim_model: 0.5,
  building: 0,
  level: 0,
  location: 0,
  user: 0,
  company: 0,
  risk: 0,
};

const EXPOSURE_SATURATION_K = 12; // diminishing-returns constant for the exposure curve

export interface SignalRow {
  signalType: string;
  severityContribution: number;
}

export interface ExposureResult {
  exposureScore: number; // 0-100
  dependencyScore: number; // 0-100
  distinctNodeTypeCount: number;
  weightedNodeCount: number;
  disciplineCount: number;
  hasImminentDownstreamDueDate: boolean;
  nodeCountByType: Record<string, number>;
}

/**
 * Deterministic Risk Scoring Engine (brief sections 10-12). Nothing here is
 * an LLM call — every factor is a plain arithmetic function of real signals
 * and real graph structure, and the weights/thresholds are configurable
 * data (packages/types/src/risk.types.ts), not hardcoded inside this
 * service or in any UI component.
 */
@Injectable()
export class ScoringService {
  constructor(private readonly graph: RiskGraphService) {}

  /**
   * Graph-based exposure/dependency amplification (brief section 12/8).
   * Walks the bounded neighborhood of rootNodeId and turns it into two
   * saturating (never linear, never unbounded) 0-100 scores: how much real
   * downstream project surface is connected (exposure), and how varied /
   * structurally entangled that surface is (dependency).
   */
  async computeGraphExposure(companyId: string, rootNodeId: string): Promise<ExposureResult> {
    const { nodes } = await this.graph.getNeighborhood(companyId, rootNodeId, { maxDepth: 5, maxNodes: 300 });
    const downstream = nodes.filter(n => n.id !== rootNodeId);

    const nodeCountByType: Record<string, number> = {};
    let weightedNodeCount = 0;
    const disciplines = new Set<string>();
    let hasImminentDownstreamDueDate = false;
    const soonThresholdMs = Date.now() + 14 * 86400000;

    for (const n of downstream) {
      nodeCountByType[n.nodeType] = (nodeCountByType[n.nodeType] ?? 0) + 1;
      weightedNodeCount += NODE_TYPE_EXPOSURE_WEIGHT[n.nodeType] ?? 0.5;
      if (n.discipline) disciplines.add(n.discipline);
      if (n.dueDate && new Date(n.dueDate).getTime() <= soonThresholdMs && new Date(n.dueDate).getTime() >= Date.now()) {
        hasImminentDownstreamDueDate = true;
      }
    }

    // Saturating curve: 100 * (1 - e^-(x/K)) — meaningful difference between
    // small and large exposure, but no unbounded blow-up for a huge project.
    const exposureScore = 100 * (1 - Math.exp(-weightedNodeCount / EXPOSURE_SATURATION_K));

    const distinctNodeTypeCount = Object.keys(nodeCountByType).length;
    // Dependency reflects structural entanglement: how many different kinds
    // of real project entities this risk's neighborhood spans, plus a bump
    // if something downstream is due imminently (the closest real proxy
    // this codebase has for "affects a critical activity soon" — no
    // programme/activity module exists to check true schedule criticality
    // against, which is disclosed via the risk's confidence reasoning).
    const dependencyScore = Math.min(100, distinctNodeTypeCount * 12 + disciplines.size * 8 + (hasImminentDownstreamDueDate ? 20 : 0));

    return {
      exposureScore: Math.round(exposureScore),
      dependencyScore: Math.round(dependencyScore),
      distinctNodeTypeCount,
      weightedNodeCount: Math.round(weightedNodeCount * 10) / 10,
      disciplineCount: disciplines.size,
      hasImminentDownstreamDueDate,
      nodeCountByType,
    };
  }

  /**
   * Turns a flat list of signals (already computed by SignalsService) plus
   * a graph exposure result into the six factors of brief section 10.
   * Probability/impact/urgency/recurrence come from the node's own direct
   * signals; exposure/dependency come from the graph traversal.
   */
  computeFactorsFromSignals(signals: SignalRow[], exposure: ExposureResult): RiskScoreFactors {
    const byType = new Map(signals.map(s => [s.signalType, s.severityContribution]));
    const sumOf = (types: string[]) => types.reduce((acc, t) => acc + (byType.get(t) ?? 0), 0);
    const maxOf = (types: string[]) => types.reduce((acc, t) => Math.max(acc, byType.get(t) ?? 0), 0);

    const probability = Math.min(100, sumOf([
      'RFI_OVERDUE', 'ISSUE_OVERDUE', 'SNAG_OVERDUE', 'SUBMITTAL_OVERDUE', 'RFI_AGING', 'ISSUE_UNRESOLVED_AGING', 'SNAG_UNRESOLVED_AGING',
    ]) * 0.6);

    const impact = Math.min(100, Math.max(
      maxOf(['RFI_HIGH_PRIORITY', 'ISSUE_HIGH_SEVERITY', 'SUBMITTAL_HIGH_PRIORITY']),
      sumOf(['RFI_COST_IMPACT', 'RFI_TIME_IMPACT', 'RFI_DRAWING_UPDATE_NOT_APPLIED', 'QA_FAILED_INSPECTION', 'DRAWING_REPEATED_REVISIONS', 'SUBMITTAL_REJECTED']) * 0.5,
    ));

    const urgency = Math.min(100, sumOf(['RFI_OVERDUE', 'ISSUE_OVERDUE', 'SNAG_OVERDUE', 'SUBMITTAL_OVERDUE', 'RFI_APPROACHING_DUE', 'SUBMITTAL_APPROACHING_DUE']) * 0.7);

    const recurrence = Math.min(100, sumOf([
      'ISSUE_REOPENED', 'ISSUE_RECURRING_LOCATION', 'SNAG_RECURRING_LOCATION', 'RFI_MULTIPLE_RELATED_ISSUES', 'ISSUE_MULTIPLE_RELATED_RFIS',
    ]) * 0.5);

    return {
      probability: Math.round(probability),
      impact: Math.round(impact),
      exposure: exposure.exposureScore,
      dependency: exposure.dependencyScore,
      urgency: Math.round(urgency),
      recurrence: Math.round(recurrence),
    };
  }

  computeScore(factors: RiskScoreFactors, weights: RiskScoringWeights = DEFAULT_RISK_SCORING_WEIGHTS): number {
    const weightSum = weights.probability + weights.impact + weights.exposure + weights.dependency + weights.urgency + weights.recurrence;
    // Defensive normalization rather than assuming callers always pass
    // weights that sum to exactly 1 (brief: "weights must sum to 1 --
    // validated, not assumed").
    const norm = weightSum > 0 ? 1 / weightSum : 0;
    const raw =
      factors.probability * weights.probability * norm +
      factors.impact * weights.impact * norm +
      factors.exposure * weights.exposure * norm +
      factors.dependency * weights.dependency * norm +
      factors.urgency * weights.urgency * norm +
      factors.recurrence * weights.recurrence * norm;
    return Math.round(Math.max(0, Math.min(100, raw)));
  }

  levelForScore(score: number, thresholds: RiskLevelThresholds = DEFAULT_RISK_LEVEL_THRESHOLDS) {
    return scoreToRiskLevel(score, thresholds);
  }

  confidenceForNode(
    directRelationshipCount: number,
    inferredRelationshipCount: number,
    missingCriticalFields: string[],
  ): { level: RiskConfidenceLevel; reason: string; percent: number } {
    return computeConfidenceLevel({ directRelationshipCount, inferredRelationshipCount, missingCriticalFields });
  }

  // Rescales a 0-100 engine factor into the Risk Matrix's 1-5 band. Never 0
  // -- "1 (Rare/Negligible)" is the floor, since the matrix has no "no
  // probability/impact at all" value (brief sections 3-4's own 5-point
  // scales both start at 1). Public so RiskService.getRiskHeatmap() can
  // place an AI-only-assessed risk on the same 5x5 grid as a human-assessed
  // one, reusing the already-stored 0-100 automated factors rather than a
  // second persisted copy of the AI's own probability/impact bands.
  toMatrixBand(value: number): number {
    return Math.max(1, Math.min(5, Math.ceil(value / 20)));
  }

  /**
   * The AI Score (brief sections 7, 36): the deterministic engine's own
   * probability/impact factors, re-expressed on the Risk Matrix's 1-25/
   * 5-level scale purely so they're directly comparable to a human's
   * Probability x Impact assessment -- never a second, independent LLM
   * guess, and never computed from anything the engine didn't already
   * compute for automatedScore.
   */
  computeAiMatrixScore(factors: RiskScoreFactors, thresholds: RiskMatrixThresholds = DEFAULT_RISK_MATRIX_THRESHOLDS): { score: number; level: RiskMatrixLevel } {
    const probability = this.toMatrixBand(factors.probability);
    const impact = this.toMatrixBand(factors.impact);
    const score = probability * impact;
    return { score, level: scoreToMatrixLevel(score, thresholds) };
  }
}
