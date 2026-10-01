import { apiGet, apiPatch, apiDelete, apiPost, apiDownloadPost } from './api';
import type { RiskMatrixLevel, RiskDriver } from '@engineeringos/types';
export { RISK_DRIVERS, RISK_DRIVER_LABELS, type RiskMatrixLevel, type RiskDriver } from '@engineeringos/types';

export type RiskLevel = 'LOW' | 'MODERATE' | 'HIGH' | 'CRITICAL';
export type RiskConfidenceLevel = 'HIGH' | 'MODERATE' | 'LOW';
export type RiskTrend = 'NEW' | 'INCREASING' | 'STABLE' | 'DECREASING';
// MONITORING/ACCEPTED/ESCALATED: see @engineeringos/types' identical comment on RiskStatus.
export type RiskStatus = 'DETECTED' | 'ACTIVE' | 'MITIGATION_IN_PROGRESS' | 'MONITORING' | 'ACCEPTED' | 'ESCALATED' | 'RESOLVED' | 'CLOSED';

export interface Risk {
  id: string;
  companyId: string;
  projectId: string;
  rootNodeId: string;
  title: string;
  category: string;
  discipline?: string;
  locationNodeId?: string;
  locationLabel?: string;
  automatedScore: number;
  automatedLevel: RiskLevel;
  overrideScore?: number;
  overrideLevel?: RiskLevel;
  overrideBy?: string;
  overrideAt?: string;
  overrideReason?: string;
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
  // Risk Matrix (Probability x Impact, 1-25) -- a separate scoring system
  // from automatedScore/score/level above; see risk.service.ts's comment.
  humanProbability?: number;
  humanImpact?: number;
  humanScore?: number;
  humanLevel?: RiskMatrixLevel;
  primaryDriver?: RiskDriver;
  secondaryDriver?: RiskDriver;
  humanAssessedBy?: string;
  humanAssessedAt?: string;
  aiScore?: number;
  aiLevel?: RiskMatrixLevel;
  aiConfidence?: number;
  finalScore?: number;
  finalLevel?: RiskMatrixLevel;
  matrixOverrideBy?: string;
  matrixOverrideAt?: string;
  matrixOverrideReason?: string;
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

export interface RiskExecutiveSummary {
  overallScore: number;
  overallLevel: RiskLevel;
  overallScoreTrendPct: number | null;
  criticalCount: number;
  highCount: number;
  increasingCount: number;
  overdueCount: number;
  totalOpenRisks: number;
}

export interface RiskByGroup {
  discipline?: string;
  location?: string;
  count: number;
  averageScore: number;
}

export interface RiskCluster {
  location: string;
  connectedRiskCount: number;
  averageScore: number;
}

export interface RiskTrendPoint {
  date: string;
  averageScore: number;
}

export interface RiskDataAvailability {
  rfisAvailable: number;
  issuesAvailable: number;
  snagItemsAvailable: number;
  qaInspectionsAvailable: number;
  bimElementRelationships: string;
  programmeData: string;
  procurementData: string;
}

export interface RiskChainStep {
  nodeId: string;
  nodeType?: string;
  label?: string;
  relationshipFromPrevious: string | null;
  confidence: number | null;
  source: string | null;
}

export interface RiskChain {
  riskId: string;
  steps: RiskChainStep[];
}

export interface RiskGraphNode {
  id: string;
  nodeType: string;
  label: string;
  discipline?: string;
  status?: string;
  priority?: string;
  dueDate?: string;
  risk?: { rootNodeId: string; score: number; level: RiskLevel; status: RiskStatus } | null;
}

export interface RiskGraphEdge {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  relationshipType: string;
  source: string;
  confidence: number;
}

export interface RiskGraphNodeDetail {
  node: RiskGraphNode;
  risk: Risk | null;
  related: {
    node: RiskGraphNode;
    relationshipType: string;
    direction: 'outgoing' | 'incoming';
    source: string;
    confidence: number;
  }[];
}

export interface RiskEvidenceItem {
  id: string;
  nodeId: string;
  role: string;
  node?: RiskGraphNode;
}

export interface RiskSnapshot {
  id: string;
  score: number;
  level: RiskLevel;
  probability: number; impact: number; exposure: number; dependency: number; urgency: number; recurrence: number;
  snapshotAt: string;
}

const base = (projectId: string) => `/projects/${projectId}/risk`;

export const recalculateRisk = (projectId: string) => apiPost<{ recalculated: boolean }>(`${base(projectId)}/recalculate`);
export const getRiskSummary = (projectId: string) => apiGet<RiskExecutiveSummary>(`${base(projectId)}/summary`);
export const getTopRisks = (projectId: string, limit = 10) => apiGet<Risk[]>(`${base(projectId)}/top`, { params: { limit } });
export const getEmergingRisks = (projectId: string, limit = 10) => apiGet<Risk[]>(`${base(projectId)}/emerging`, { params: { limit } });
export const getRiskByDiscipline = (projectId: string) => apiGet<RiskByGroup[]>(`${base(projectId)}/by-discipline`);
export const getRiskByLocation = (projectId: string) => apiGet<RiskByGroup[]>(`${base(projectId)}/by-location`);
export const getRiskClusters = (projectId: string) => apiGet<RiskCluster[]>(`${base(projectId)}/clusters`);
export const getRiskTrend = (projectId: string, days: 7 | 14 | 30 | 90) => apiGet<RiskTrendPoint[]>(`${base(projectId)}/trend`, { params: { days } });
export const getRiskDataAvailability = (projectId: string) => apiGet<RiskDataAvailability>(`${base(projectId)}/data-availability`);
export const listRisks = (projectId: string) => apiGet<Risk[]>(base(projectId));
export const getRisk = (projectId: string, riskId: string) => apiGet<Risk>(`${base(projectId)}/${riskId}`);
export const getRiskChain = (projectId: string, riskId: string) => apiGet<RiskChain>(`${base(projectId)}/${riskId}/chain`);
export const getRiskEvidence = (projectId: string, riskId: string) => apiGet<RiskEvidenceItem[]>(`${base(projectId)}/${riskId}/evidence`);
export const getRiskHistory = (projectId: string, riskId: string) => apiGet<RiskSnapshot[]>(`${base(projectId)}/${riskId}/history`);

export interface RiskAssessmentHistoryEntry {
  id: string;
  assessmentType: 'HUMAN' | 'AI' | 'OVERRIDE';
  probability?: number;
  impact?: number;
  score?: number;
  level?: RiskMatrixLevel;
  primaryDriver?: RiskDriver;
  secondaryDriver?: RiskDriver;
  confidence?: number;
  reason?: string;
  performedBy?: string;
  performedByName?: string;
  performedAt: string;
}
export const getRiskAssessmentHistory = (projectId: string, riskId: string) =>
  apiGet<RiskAssessmentHistoryEntry[]>(`${base(projectId)}/${riskId}/assessment-history`);

// probability/impact are 1-5 each; the server computes the 1-25 score and
// matrix level -- never computed client-side and sent, so the UI can never
// disagree with what's actually persisted.
export const setHumanAssessment = (projectId: string, riskId: string, dto: { probability: number; impact: number; primaryDriver: RiskDriver; secondaryDriver?: RiskDriver | null }) =>
  apiPatch<Risk>(`${base(projectId)}/${riskId}/human-assessment`, dto);
export const getRiskGraph = (projectId: string, opts: { rootNodeId?: string; maxDepth?: number; nodeTypes?: string[]; discipline?: string } = {}) =>
  apiGet<{ nodes: RiskGraphNode[]; edges: RiskGraphEdge[] }>(`${base(projectId)}/graph`, {
    params: { rootNodeId: opts.rootNodeId, maxDepth: opts.maxDepth, nodeTypes: opts.nodeTypes?.join(','), discipline: opts.discipline },
  });
export const getGraphNodeDetail = (projectId: string, nodeId: string) =>
  apiGet<RiskGraphNodeDetail>(`${base(projectId)}/graph/nodes/${nodeId}`);

export const overrideRisk = (projectId: string, riskId: string, dto: { score?: number; level?: RiskLevel; reason: string }) =>
  apiPatch<Risk>(`${base(projectId)}/${riskId}/override`, dto);
export const clearRiskOverride = (projectId: string, riskId: string) => apiDelete<Risk>(`${base(projectId)}/${riskId}/override`);
export const setRiskStatus = (projectId: string, riskId: string, status: RiskStatus, reason?: string) =>
  apiPatch<Risk>(`${base(projectId)}/${riskId}/status`, { status, reason });
export const assignRiskOwner = (projectId: string, riskId: string, ownerId: string | null) =>
  apiPatch<Risk>(`${base(projectId)}/${riskId}/owner`, { ownerId });

export type AiNarrativeResult = { narrative: string } | { unavailable: true; reason: string };
export const getAiBriefing = (projectId: string) => apiGet<AiNarrativeResult>(`${base(projectId)}/briefing`);
export const getAiExplanation = (projectId: string, riskId: string) => apiGet<AiNarrativeResult>(`${base(projectId)}/${riskId}/ai-explanation`);

// aiBriefing (optional) is the exact narrative text already shown on screen
// (from getAiBriefing() above) -- passed through verbatim so the PDF never
// shows a different narrative than what the user already read, and never
// triggers a fresh (possibly slow, possibly unavailable) AI call of its own.
export const downloadRiskPdf = (projectId: string, filename: string, aiBriefing?: string) =>
  apiDownloadPost(`${base(projectId)}/pdf`, { aiBriefing }, filename);
