import { apiGet, apiPatch, apiDelete, apiPost } from './api';

export type RiskLevel = 'LOW' | 'MODERATE' | 'HIGH' | 'CRITICAL';
export type RiskConfidenceLevel = 'HIGH' | 'MODERATE' | 'LOW';
export type RiskTrend = 'NEW' | 'INCREASING' | 'STABLE' | 'DECREASING';
export type RiskStatus = 'DETECTED' | 'ACTIVE' | 'MITIGATION_IN_PROGRESS' | 'RESOLVED' | 'CLOSED';

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
