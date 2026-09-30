// ══════════════════════════════════════════════════════════════════════════
// Project Risk Intelligence / Project Risk Graph — shared types
//
// Mirrors the DB enums added in migrations 050 (risk_node_type,
// risk_relationship_type, risk_edge_source) and 051 (risks, risk_signals,
// risk_evidence, risk_snapshots, risk_status_history). See those migration
// files for the authoritative schema and the reasoning behind each design
// choice (automated-vs-override scoring, confidence-vs-severity, etc).
// ══════════════════════════════════════════════════════════════════════════

import type { IssueDiscipline } from './issue.types';
import type { RfiDiscipline } from './rfi.types';

// ── Graph node/edge vocabulary (controlled — brief sections 3-5) ───────────

export const RISK_NODE_TYPES = [
  'project', 'building', 'level', 'location',
  'rfi', 'issue', 'snag_item', 'qa_inspection',
  'drawing', 'document', 'submittal', 'transmittal',
  'bim_model', 'bim_element',
  'capture',
  'programme_activity', 'material', // schema-ready; nothing extracts these today (no source module exists)
  'user', 'company',
  'risk',
] as const;
export type RiskNodeType = typeof RISK_NODE_TYPES[number];

// Node types this codebase can actually populate today, given the modules
// that exist (brief section 44 / "do not create fake data"). Used to drive
// honest empty-state messaging rather than a silent gap.
export const UNSUPPORTED_RISK_NODE_TYPES: RiskNodeType[] = ['programme_activity', 'material'];

export const RISK_RELATIONSHIP_TYPES = [
  'RELATED_TO', 'AFFECTS', 'AFFECTED_BY', 'LOCATED_AT', 'REFERENCES',
  'DEPENDS_ON', 'BLOCKS', 'IMPACTS', 'CAUSES', 'CONTRIBUTES_TO',
  'RESOLVES', 'SUPERSEDES', 'DUPLICATES', 'SIMILAR_TO', 'ASSIGNED_TO',
  'OWNED_BY', 'REQUIRES', 'PRECEDES', 'FOLLOWS', 'CONTAINS',
  'BELONGS_TO', 'EVIDENCE_FOR', 'TRIGGERS', 'MITIGATES',
] as const;
export type RiskRelationshipType = typeof RISK_RELATIONSHIP_TYPES[number];

export const RISK_EDGE_SOURCES = ['EXPLICIT', 'RULE_INFERENCE', 'AI_SEMANTIC_MATCH', 'USER_DEFINED'] as const;
export type RiskEdgeSource = typeof RISK_EDGE_SOURCES[number];

export interface RiskGraphNode {
  id: string;
  companyId: string;
  projectId: string;
  nodeType: RiskNodeType;
  entityId: string;
  entityTable: string;
  label: string;
  discipline?: string;
  status?: string;
  priority?: string;
  dueDate?: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface RiskGraphEdge {
  id: string;
  companyId: string;
  projectId: string;
  fromNodeId: string;
  toNodeId: string;
  relationshipType: RiskRelationshipType;
  source: RiskEdgeSource;
  confidence: number; // 0-1
  evidence: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

// ── Canonical discipline vocabulary ─────────────────────────────────────────
// IssueDiscipline (8 codes) and RfiDiscipline (14 values) are two separate,
// non-overlapping vocabularies in this codebase today (see issue.types.ts /
// rfi.types.ts) — neither is touched here. This canonical superset exists
// only for risk-graph/signal purposes (grouping, filtering, cross-entity
// discipline matching), never written back to rfis.discipline or
// issues.discipline.

export const RISK_DISCIPLINES = [
  'CIVIL', 'STRUCTURAL', 'ARCHITECTURAL', 'INTERIOR_DESIGN',
  'MECHANICAL', 'ELECTRICAL', 'PLUMBING', 'HVAC', 'MEP',
  'INFRA', 'ELV', 'AV', 'LANDSCAPE', 'GENERAL', 'OTHER',
] as const;
export type RiskDiscipline = typeof RISK_DISCIPLINES[number];

export const ISSUE_DISCIPLINE_TO_RISK_DISCIPLINE: Record<IssueDiscipline, RiskDiscipline> = {
  MEP: 'MEP',
  ARC: 'ARCHITECTURAL',
  STR: 'STRUCTURAL',
  CIV: 'CIVIL',
  ELE: 'ELECTRICAL',
  INFRA: 'INFRA',
  LANDSCAPE: 'LANDSCAPE',
  OTHER: 'OTHER',
};

export const RFI_DISCIPLINE_TO_RISK_DISCIPLINE: Record<RfiDiscipline, RiskDiscipline> = {
  civil: 'CIVIL',
  structural: 'STRUCTURAL',
  architectural: 'ARCHITECTURAL',
  interior_design: 'INTERIOR_DESIGN',
  mechanical: 'MECHANICAL',
  electrical: 'ELECTRICAL',
  plumbing: 'PLUMBING',
  hvac: 'HVAC',
  general: 'GENERAL',
  infra: 'INFRA',
  mep_general: 'MEP',
  elv: 'ELV',
  av: 'AV',
  other: 'OTHER',
};

// ── Risk signal catalog (brief section 9) ───────────────────────────────────
// Only signal types this codebase's real data can actually produce.
// Programme/procurement signal families from the brief are intentionally
// absent — no programme-activity or material/procurement module exists
// (see the architecture assessment); adding fabricated signals for data
// that doesn't exist is explicitly forbidden.

export const RFI_SIGNAL_TYPES = [
  'RFI_OVERDUE',
  'RFI_AGING',
  'RFI_APPROACHING_DUE',
  'RFI_HIGH_PRIORITY',
  'RFI_COST_IMPACT',
  'RFI_TIME_IMPACT',
  'RFI_DRAWING_UPDATE_NOT_APPLIED',
  'RFI_MULTIPLE_RELATED_ISSUES',
] as const;

export const ISSUE_SIGNAL_TYPES = [
  'ISSUE_OVERDUE',
  'ISSUE_HIGH_SEVERITY',
  'ISSUE_UNRESOLVED_AGING',
  'ISSUE_REOPENED',
  'ISSUE_RECURRING_LOCATION',
  'ISSUE_CLUSTERED_LOCATION',
  'ISSUE_AFFECTS_MULTIPLE_ELEMENTS',
  'ISSUE_MULTIPLE_RELATED_RFIS',
] as const;

export const SNAG_SIGNAL_TYPES = [
  'SNAG_OVERDUE',
  'SNAG_UNRESOLVED_AGING',
  'SNAG_RECURRING_LOCATION',
  'SNAG_CLUSTERED_LOCATION',
] as const;

export const DESIGN_SIGNAL_TYPES = [
  'DRAWING_REPEATED_REVISIONS',
  'DRAWING_RFI_DENSITY',
] as const;

export const QUALITY_SIGNAL_TYPES = [
  'QA_FAILED_INSPECTION',
  'QA_RECURRING_LOCATION',
] as const;

export const CLUSTER_SIGNAL_TYPES = [
  'LOCATION_EVENT_CONCENTRATION',
] as const;

export const RISK_SIGNAL_TYPES = [
  ...RFI_SIGNAL_TYPES,
  ...ISSUE_SIGNAL_TYPES,
  ...SNAG_SIGNAL_TYPES,
  ...DESIGN_SIGNAL_TYPES,
  ...QUALITY_SIGNAL_TYPES,
  ...CLUSTER_SIGNAL_TYPES,
] as const;
export type RiskSignalType = typeof RISK_SIGNAL_TYPES[number];

// ── Risk scoring (brief sections 10-11) ─────────────────────────────────────

export type RiskLevel = 'LOW' | 'MODERATE' | 'HIGH' | 'CRITICAL';
export type RiskConfidenceLevel = 'HIGH' | 'MODERATE' | 'LOW';
export type RiskTrend = 'NEW' | 'INCREASING' | 'STABLE' | 'DECREASING';
export type RiskStatus = 'DETECTED' | 'ACTIVE' | 'MITIGATION_IN_PROGRESS' | 'RESOLVED' | 'CLOSED';

export interface RiskScoreFactors {
  probability: number;
  impact: number;
  exposure: number;
  dependency: number;
  urgency: number;
  recurrence: number;
}

// Configurable weighted-sum formula (section 10). Weights must sum to 1 —
// validated by the scoring engine, not assumed.
export interface RiskScoringWeights {
  probability: number;
  impact: number;
  exposure: number;
  dependency: number;
  urgency: number;
  recurrence: number;
}

export const DEFAULT_RISK_SCORING_WEIGHTS: RiskScoringWeights = {
  probability: 0.2,
  impact: 0.25,
  exposure: 0.2,
  dependency: 0.15,
  urgency: 0.1,
  recurrence: 0.1,
};

// Configurable thresholds (section 11) — never hardcoded in UI code.
export interface RiskLevelThresholds {
  low: number;      // score < moderate.min is LOW
  moderate: number;
  high: number;
  critical: number;
}

export const DEFAULT_RISK_LEVEL_THRESHOLDS: RiskLevelThresholds = {
  low: 0,
  moderate: 25,
  high: 50,
  critical: 75,
};

export function scoreToRiskLevel(score: number, thresholds: RiskLevelThresholds = DEFAULT_RISK_LEVEL_THRESHOLDS): RiskLevel {
  if (score >= thresholds.critical) return 'CRITICAL';
  if (score >= thresholds.high) return 'HIGH';
  if (score >= thresholds.moderate) return 'MODERATE';
  return 'LOW';
}

// ── Risk entity (brief section 16) ──────────────────────────────────────────

export interface Risk {
  id: string;
  companyId: string;
  projectId: string;
  rootNodeId: string;
  title: string;
  category: string;
  discipline?: RiskDiscipline;
  locationNodeId?: string;
  locationLabel?: string;

  automatedScore: number;
  automatedLevel: RiskLevel;
  overrideScore?: number;
  overrideLevel?: RiskLevel;
  overrideBy?: string;
  overrideAt?: string;
  overrideReason?: string;

  // Effective values — override if present, else automated. Always present.
  score: number;
  level: RiskLevel;

  probability: number;
  impact: number;
  exposure: number;
  dependency: number;
  urgency: number;
  recurrence: number;

  confidenceLevel: RiskConfidenceLevel;
  confidenceReason?: string;

  trend: RiskTrend;
  status: RiskStatus;

  ownerId?: string;
  dueDate?: string;

  explanation?: string;
  recommendedAction?: string;

  firstDetectedAt: string;
  lastCalculatedAt: string;
  resolvedAt?: string;
  closedAt?: string;

  createdAt: string;
  updatedAt: string;
}

export interface RiskSignal {
  id: string;
  companyId: string;
  projectId: string;
  nodeId: string;
  riskId?: string;
  signalType: RiskSignalType;
  severityContribution: number;
  detectedAt: string;
  details: Record<string, unknown>;
  createdAt: string;
}

export type RiskEvidenceRole = 'PRIMARY_CAUSE' | 'AFFECTED_ELEMENT' | 'SUPPORTING_SIGNAL' | 'RELATED_RISK' | 'LOCATION';

export interface RiskEvidence {
  id: string;
  riskId: string;
  nodeId: string;
  role: RiskEvidenceRole;
  createdAt: string;
  // Denormalized for direct rendering (populated by the API, not stored):
  node?: RiskGraphNode;
}

export interface RiskSnapshot {
  id: string;
  riskId: string;
  score: number;
  level: RiskLevel;
  probability: number;
  impact: number;
  exposure: number;
  dependency: number;
  urgency: number;
  recurrence: number;
  majorSignals: RiskSignalType[];
  graphExposure: Record<string, number>; // node count by type
  snapshotAt: string;
}

export interface RiskStatusHistoryEntry {
  id: string;
  riskId: string;
  fromStatus?: RiskStatus;
  toStatus: RiskStatus;
  changedBy?: string; // absent/null = automated engine
  reason?: string;
  changedAt: string;
}

// ── Risk chain (brief section 8, 13, 30) ────────────────────────────────────

export interface RiskChainStep {
  nodeId: string;
  nodeType: RiskNodeType;
  label: string;
  relationshipFromPrevious?: RiskRelationshipType;
  confidence?: number; // confidence of the edge leading into this step (absent for the first step)
}

export interface RiskChain {
  riskId: string;
  steps: RiskChainStep[];
}

// ── Data confidence (brief section 38) ──────────────────────────────────────

export interface RiskDataConfidenceInput {
  directRelationshipCount: number;
  inferredRelationshipCount: number;
  missingCriticalFields: string[];
}

export function computeConfidenceLevel(input: RiskDataConfidenceInput): { level: RiskConfidenceLevel; reason: string } {
  if (input.missingCriticalFields.length > 0) {
    return { level: 'LOW', reason: `Missing: ${input.missingCriticalFields.join(', ')}` };
  }
  const total = input.directRelationshipCount + input.inferredRelationshipCount;
  if (total === 0) {
    return { level: 'LOW', reason: 'No supporting relationships found.' };
  }
  const inferredShare = input.inferredRelationshipCount / total;
  if (inferredShare <= 0.25) {
    return { level: 'HIGH', reason: `${input.directRelationshipCount} direct relationship(s), ${input.inferredRelationshipCount} inferred.` };
  }
  if (inferredShare <= 0.6) {
    return { level: 'MODERATE', reason: `${input.directRelationshipCount} direct relationship(s), ${input.inferredRelationshipCount} inferred.` };
  }
  return { level: 'LOW', reason: `Assessment relies mostly on inferred relationships (${input.inferredRelationshipCount} of ${total}).` };
}
