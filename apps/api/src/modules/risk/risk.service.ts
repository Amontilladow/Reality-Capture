import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { RiskLevel, RiskStatus, RiskDiscipline } from '@engineeringos/types';
import { DatabaseService } from '../../database/database.service';
import { RiskGraphService, type GraphNodeRow } from './risk-graph.service';
import { RelationshipExtractionService } from './relationship-extraction.service';
import { SignalsService } from './signals.service';
import { ScoringService } from './scoring.service';

const RISK_WORTHY_NODE_TYPES = ['rfi', 'issue', 'snag_item', 'drawing', 'qa_inspection'] as const;

const CATEGORY_BY_NODE_TYPE: Record<string, string> = {
  rfi: 'Design / RFI',
  issue: 'Coordination / Issue',
  snag_item: 'Quality / Snagging',
  qa_inspection: 'Quality / Inspection',
  drawing: 'Design / Drawing',
};

const TITLE_PREFIX_BY_NODE_TYPE: Record<string, string> = {
  rfi: 'Unresolved RFI',
  issue: 'Unresolved Issue',
  snag_item: 'Open Snag',
  qa_inspection: 'Failed QA Inspection',
  drawing: 'Repeated Drawing Revisions',
};

// Ordered by how directly actionable/severe the recommendation is — the
// first matching signal in a risk's evidence picks the recommended action.
const RECOMMENDED_ACTION_BY_SIGNAL: [string, string][] = [
  ['RFI_OVERDUE', 'Escalate this RFI for an immediate response — it is already overdue.'],
  ['ISSUE_OVERDUE', 'Escalate this issue past its deadline for immediate resolution.'],
  ['SNAG_OVERDUE', 'Escalate this snag item — it has passed its due date.'],
  ['RFI_DRAWING_UPDATE_NOT_APPLIED', 'Apply the drawing update this RFI requires before dependent work proceeds.'],
  ['QA_FAILED_INSPECTION', 'Re-inspect and remediate the failed scope before covering or proceeding past it.'],
  ['ISSUE_RECURRING_LOCATION', 'Investigate the root cause at this location — multiple issues have recurred here.'],
  ['SNAG_RECURRING_LOCATION', 'Investigate the root cause at this location — multiple snags have recurred here.'],
  ['DRAWING_REPEATED_REVISIONS', 'Confirm the latest revision has been communicated to all affected disciplines.'],
  ['RFI_APPROACHING_DUE', 'Ensure a response is issued before the due date to avoid this becoming overdue.'],
  ['RFI_MULTIPLE_RELATED_ISSUES', 'Coordinate the related issues together with this RFI\'s resolution.'],
  ['ISSUE_MULTIPLE_RELATED_RFIS', 'Coordinate the related RFIs together with this issue\'s resolution.'],
  ['ISSUE_REOPENED', 'Confirm the underlying cause was actually addressed, not just the symptom.'],
  ['RFI_COST_IMPACT', 'Route this RFI\'s cost impact through the appropriate commercial review.'],
  ['RFI_TIME_IMPACT', 'Assess this RFI\'s programme impact with the project schedule owner.'],
  ['RFI_HIGH_PRIORITY', 'Confirm ownership and a response timeline given this RFI\'s priority.'],
  ['ISSUE_HIGH_SEVERITY', 'Confirm ownership and a resolution timeline given this issue\'s severity.'],
];

export interface RiskRow {
  id: string; companyId: string; projectId: string; rootNodeId: string;
  title: string; category: string; discipline: RiskDiscipline | null;
  locationNodeId: string | null; locationLabel: string | null;
  automatedScore: number; automatedLevel: RiskLevel;
  overrideScore: number | null; overrideLevel: RiskLevel | null; overrideBy: string | null; overrideAt: string | null; overrideReason: string | null;
  score: number; level: RiskLevel;
  probability: number; impact: number; exposure: number; dependency: number; urgency: number; recurrence: number;
  confidenceLevel: 'HIGH' | 'MODERATE' | 'LOW'; confidenceReason: string | null;
  trend: 'NEW' | 'INCREASING' | 'STABLE' | 'DECREASING';
  status: RiskStatus;
  ownerId: string | null; dueDate: string | null;
  explanation: string | null; recommendedAction: string | null;
  firstDetectedAt: string; lastCalculatedAt: string; resolvedAt: string | null; closedAt: string | null;
  createdAt: string; updatedAt: string;
}

const AUTOMATED_CONTROLLED_STATUSES: RiskStatus[] = ['DETECTED', 'ACTIVE', 'RESOLVED'];

/**
 * Orchestrates the full Project Risk Graph -> Risk Intelligence pipeline
 * (brief sections 7-9, 16-18): extraction -> signals -> deterministic
 * scoring -> graph exposure amplification -> risk persistence -> evidence
 * -> snapshot -> lifecycle. This is the "core implementation" the brief
 * describes -- everything in the Reports tab reads from what this service
 * produces, never the other way around.
 */
@Injectable()
export class RiskService {
  private readonly logger = new Logger(RiskService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly graph: RiskGraphService,
    private readonly extraction: RelationshipExtractionService,
    private readonly signals: SignalsService,
    private readonly scoring: ScoringService,
  ) {}

  /** Full pipeline for one project: rebuild the graph, redetect signals, recalculate every risk-worthy node. */
  async recalculateProject(companyId: string, projectId: string): Promise<void> {
    await this.extraction.extractProject(companyId, projectId);
    await this.signals.detectSignalsForProject(companyId, projectId);

    const nodes = await this.graph.getNodesByProject(companyId, projectId, [...RISK_WORTHY_NODE_TYPES]);
    for (const node of nodes) {
      await this.recalculateForNode(companyId, projectId, node);
    }
  }

  /** Event-driven incremental recalculation for one changed entity (brief section 41). */
  async recalculateForEntity(companyId: string, projectId: string, nodeType: typeof RISK_WORTHY_NODE_TYPES[number], entityId: string): Promise<void> {
    switch (nodeType) {
      case 'rfi': await this.extraction.extractRfis(companyId, projectId, entityId); break;
      case 'issue': await this.extraction.extractIssues(companyId, projectId, entityId); break;
      case 'snag_item': await this.extraction.extractSnagItems(companyId, projectId, entityId); break;
      case 'drawing': await this.extraction.extractDrawings(companyId, projectId, entityId); break;
      case 'qa_inspection': await this.extraction.extractQaInspections(companyId, projectId, entityId); break;
    }
    // RFI<->Issue inference is symmetric and cheap enough to redo project-wide
    // whenever either side changes, rather than tracking which pairs to revisit.
    if (nodeType === 'rfi' || nodeType === 'issue') {
      await this.extraction.extractInferredRfiIssueLinks(companyId, projectId);
    }
    await this.signals.detectSignalsForProject(companyId, projectId);

    const node = await this.graph.getNodeByEntity(companyId, nodeType, entityId);
    if (node) await this.recalculateForNode(companyId, projectId, node);
  }

  private async recalculateForNode(companyId: string, projectId: string, node: GraphNodeRow): Promise<void> {
    const signalRows = await this.db.withTenant(companyId, sql => sql<{ signalType: string; severityContribution: number }[]>`
      SELECT signal_type, severity_contribution FROM risk_signals WHERE node_id = ${node.id}`);

    const existing = await this.getRiskByRootNode(companyId, node.id);

    if (signalRows.length === 0) {
      if (existing && AUTOMATED_CONTROLLED_STATUSES.includes(existing.status) && existing.status !== 'RESOLVED') {
        await this.transitionAndPersistZeroSignal(companyId, projectId, existing);
      }
      return;
    }

    const exposure = await this.scoring.computeGraphExposure(companyId, node.id);
    const factors = this.scoring.computeFactorsFromSignals(signalRows, exposure);
    const automatedScore = this.scoring.computeScore(factors);
    const automatedLevel = this.scoring.levelForScore(automatedScore);

    const { directCount, inferredCount } = await this.countRelationshipConfidence(companyId, node.id);
    const missingFields: string[] = [];
    if (!node.discipline) missingFields.push('discipline');
    const { level: confidenceLevel, reason: confidenceReason } = this.scoring.confidenceForNode(directCount, inferredCount, missingFields);

    const location = await this.findNearestLocation(companyId, node.id);
    const title = `${TITLE_PREFIX_BY_NODE_TYPE[node.nodeType] ?? 'Detected Risk'}: ${node.label}`;
    const category = CATEGORY_BY_NODE_TYPE[node.nodeType] ?? 'Other';
    const topSignalType = [...signalRows].sort((a, b) => b.severityContribution - a.severityContribution)[0]?.signalType;
    const recommendedAction = RECOMMENDED_ACTION_BY_SIGNAL.find(([t]) => signalRows.some(s => s.signalType === t))?.[1]
      ?? 'Review and assign an owner to this item.';
    const explanation = this.buildExplanation(node, signalRows, exposure, topSignalType);

    let trend: RiskRow['trend'] = 'NEW';
    if (existing) {
      const delta = automatedScore - existing.automatedScore;
      trend = delta >= 5 ? 'INCREASING' : delta <= -5 ? 'DECREASING' : 'STABLE';
    }

    const risk = await this.upsertRisk(companyId, projectId, {
      rootNodeId: node.id, title, category,
      discipline: (node.discipline as RiskDiscipline | null) ?? null,
      locationNodeId: location?.id ?? null, locationLabel: location?.label ?? null,
      automatedScore, automatedLevel,
      probability: factors.probability, impact: factors.impact, exposure: factors.exposure,
      dependency: factors.dependency, urgency: factors.urgency, recurrence: factors.recurrence,
      confidenceLevel, confidenceReason, trend, explanation, recommendedAction,
      resurrect: existing?.status === 'RESOLVED',
    });

    await this.rebuildEvidence(companyId, projectId, risk.id, node);
    await this.writeSnapshot(companyId, projectId, risk, exposure);
  }

  private async transitionAndPersistZeroSignal(companyId: string, projectId: string, existing: RiskRow): Promise<void> {
    await this.db.withTenant(companyId, sql => sql`
      UPDATE risks SET automated_score = 0, automated_level = 'LOW',
        score = CASE WHEN override_score IS NOT NULL THEN override_score ELSE 0 END,
        level = CASE WHEN override_level IS NOT NULL THEN override_level ELSE 'LOW' END,
        trend = 'DECREASING', status = 'RESOLVED', resolved_at = now(), last_calculated_at = now(), updated_at = now()
      WHERE id = ${existing.id}`);
    await this.recordStatusChange(companyId, projectId, existing.id, existing.status, 'RESOLVED', null, 'All contributing signals cleared.');
  }

  // ── Persistence helpers ──────────────────────────────────────────────────

  async getRiskByRootNode(companyId: string, rootNodeId: string): Promise<RiskRow | null> {
    const [row] = await this.db.withTenant(companyId, sql => sql<RiskRow[]>`SELECT * FROM risks WHERE root_node_id = ${rootNodeId}`);
    return row ?? null;
  }

  async getRisk(companyId: string, riskId: string): Promise<RiskRow> {
    const [row] = await this.db.withTenant(companyId, sql => sql<RiskRow[]>`SELECT * FROM risks WHERE id = ${riskId}`);
    if (!row) throw new NotFoundException('Risk not found.');
    return row;
  }

  async listRisks(companyId: string, projectId: string): Promise<RiskRow[]> {
    return this.db.withTenant(companyId, sql => sql<RiskRow[]>`
      SELECT * FROM risks WHERE project_id = ${projectId} ORDER BY score DESC, updated_at DESC`);
  }

  private async upsertRisk(companyId: string, projectId: string, input: {
    rootNodeId: string; title: string; category: string; discipline: RiskDiscipline | null;
    locationNodeId: string | null; locationLabel: string | null;
    automatedScore: number; automatedLevel: RiskLevel;
    probability: number; impact: number; exposure: number; dependency: number; urgency: number; recurrence: number;
    confidenceLevel: 'HIGH' | 'MODERATE' | 'LOW'; confidenceReason: string;
    trend: RiskRow['trend']; explanation: string; recommendedAction: string; resurrect: boolean;
  }): Promise<RiskRow> {
    return this.db.withTenant(companyId, async (sql) => {
      const [row] = await sql<RiskRow[]>`
        INSERT INTO risks (
          company_id, project_id, root_node_id, title, category, discipline, location_node_id, location_label,
          automated_score, automated_level, score, level,
          probability, impact, exposure, dependency, urgency, recurrence,
          confidence_level, confidence_reason, trend, status, explanation, recommended_action
        )
        VALUES (
          ${companyId}, ${projectId}, ${input.rootNodeId}, ${input.title}, ${input.category}, ${input.discipline},
          ${input.locationNodeId}, ${input.locationLabel},
          ${input.automatedScore}, ${input.automatedLevel}, ${input.automatedScore}, ${input.automatedLevel},
          ${input.probability}, ${input.impact}, ${input.exposure}, ${input.dependency}, ${input.urgency}, ${input.recurrence},
          ${input.confidenceLevel}, ${input.confidenceReason}, ${input.trend}, 'DETECTED', ${input.explanation}, ${input.recommendedAction}
        )
        ON CONFLICT (root_node_id) DO UPDATE SET
          title = EXCLUDED.title, category = EXCLUDED.category, discipline = EXCLUDED.discipline,
          location_node_id = EXCLUDED.location_node_id, location_label = EXCLUDED.location_label,
          automated_score = EXCLUDED.automated_score, automated_level = EXCLUDED.automated_level,
          score = CASE WHEN risks.override_score IS NOT NULL THEN risks.override_score ELSE EXCLUDED.automated_score END,
          level = CASE WHEN risks.override_level IS NOT NULL THEN risks.override_level ELSE EXCLUDED.automated_level END,
          probability = EXCLUDED.probability, impact = EXCLUDED.impact, exposure = EXCLUDED.exposure,
          dependency = EXCLUDED.dependency, urgency = EXCLUDED.urgency, recurrence = EXCLUDED.recurrence,
          confidence_level = EXCLUDED.confidence_level, confidence_reason = EXCLUDED.confidence_reason,
          trend = EXCLUDED.trend, explanation = EXCLUDED.explanation, recommended_action = EXCLUDED.recommended_action,
          status = CASE WHEN risks.status = 'RESOLVED' AND EXCLUDED.automated_score > 0 THEN 'ACTIVE' ELSE risks.status END,
          resolved_at = CASE WHEN risks.status = 'RESOLVED' AND EXCLUDED.automated_score > 0 THEN NULL ELSE risks.resolved_at END,
          last_calculated_at = now(), updated_at = now()
        RETURNING *`;
      return row;
    });
  }

  private async rebuildEvidence(companyId: string, projectId: string, riskId: string, rootNode: GraphNodeRow): Promise<void> {
    await this.db.withTenant(companyId, sql => sql`DELETE FROM risk_evidence WHERE risk_id = ${riskId}`);
    await this.db.withTenant(companyId, sql => sql`
      INSERT INTO risk_evidence (company_id, project_id, risk_id, node_id, role) VALUES (${companyId}, ${projectId}, ${riskId}, ${rootNode.id}, 'PRIMARY_CAUSE')
      ON CONFLICT DO NOTHING`);

    const outgoing = await this.graph.getOutgoingEdges(companyId, rootNode.id);
    const incoming = await this.graph.getIncomingEdges(companyId, rootNode.id);
    const relatedNodeIds = new Set([...outgoing.map(e => e.toNodeId), ...incoming.map(e => e.fromNodeId)]);
    for (const nodeId of relatedNodeIds) {
      await this.db.withTenant(companyId, sql => sql`
        INSERT INTO risk_evidence (company_id, project_id, risk_id, node_id, role)
        VALUES (${companyId}, ${projectId}, ${riskId}, ${nodeId}, 'AFFECTED_ELEMENT')
        ON CONFLICT DO NOTHING`);
    }
  }

  private async writeSnapshot(companyId: string, projectId: string, risk: RiskRow, exposure: import('./scoring.service').ExposureResult): Promise<void> {
    const signalTypes = await this.db.withTenant(companyId, sql => sql<{ signalType: string }[]>`
      SELECT signal_type FROM risk_signals WHERE risk_id = ${risk.id} OR node_id = ${risk.rootNodeId} ORDER BY severity_contribution DESC LIMIT 5`);
    await this.db.withTenant(companyId, sql => sql`
      INSERT INTO risk_snapshots (
        company_id, project_id, risk_id, score, level, probability, impact, exposure, dependency, urgency, recurrence, major_signals, graph_exposure
      ) VALUES (
        ${companyId}, ${projectId}, ${risk.id}, ${risk.automatedScore}, ${risk.automatedLevel},
        ${risk.probability}, ${risk.impact}, ${risk.exposure}, ${risk.dependency}, ${risk.urgency}, ${risk.recurrence},
        ${JSON.stringify(signalTypes.map(s => s.signalType))}, ${JSON.stringify(exposure.nodeCountByType)}
      )`);
  }

  private async recordStatusChange(companyId: string, projectId: string, riskId: string, fromStatus: RiskStatus | null, toStatus: RiskStatus, changedBy: string | null, reason: string | null): Promise<void> {
    await this.db.withTenant(companyId, sql => sql`
      INSERT INTO risk_status_history (company_id, project_id, risk_id, from_status, to_status, changed_by, reason)
      VALUES (${companyId}, ${projectId}, ${riskId}, ${fromStatus}, ${toStatus}, ${changedBy}, ${reason})`);
  }

  private async countRelationshipConfidence(companyId: string, nodeId: string): Promise<{ directCount: number; inferredCount: number }> {
    const rows = await this.db.withTenant(companyId, sql => sql<{ source: string; c: string }[]>`
      SELECT source, COUNT(*) AS c FROM risk_graph_edges WHERE from_node_id = ${nodeId} OR to_node_id = ${nodeId} GROUP BY source`);
    let directCount = 0;
    let inferredCount = 0;
    for (const r of rows) {
      if (r.source === 'EXPLICIT' || r.source === 'USER_DEFINED') directCount += Number(r.c);
      else inferredCount += Number(r.c);
    }
    return { directCount, inferredCount };
  }

  private async findNearestLocation(companyId: string, nodeId: string): Promise<{ id: string; label: string } | null> {
    const outgoing = await this.graph.getOutgoingEdges(companyId, nodeId);
    const locatedAt = outgoing.find(e => e.relationshipType === 'LOCATED_AT');
    if (!locatedAt) return null;
    const node = await this.graph.getNode(companyId, locatedAt.toNodeId);
    return node ? { id: node.id, label: node.label } : null;
  }

  private buildExplanation(node: GraphNodeRow, signalRows: { signalType: string; severityContribution: number }[], exposure: import('./scoring.service').ExposureResult, topSignalType?: string): string {
    const signalPhrase = signalRows.length === 1
      ? '1 contributing signal'
      : `${signalRows.length} contributing signals`;
    const exposurePhrase = exposure.weightedNodeCount > 0
      ? ` Its connected graph reaches ${Object.values(exposure.nodeCountByType).reduce((a, b) => a + b, 0)} related project record(s) across ${exposure.distinctNodeTypeCount} entity type(s)${exposure.disciplineCount > 1 ? ` and ${exposure.disciplineCount} disciplines` : ''}${exposure.hasImminentDownstreamDueDate ? ', including at least one item due within 14 days' : ''}.`
      : ' No further connected project records were found in its graph neighborhood.';
    return `This ${node.nodeType.replace('_', ' ')} has ${signalPhrase}${topSignalType ? `, most significantly ${topSignalType.replace(/_/g, ' ').toLowerCase()}` : ''}.${exposurePhrase}`;
  }

  // ── User override / lifecycle (brief sections 14, 36) ───────────────────

  async overrideRisk(companyId: string, riskId: string, userId: string, input: { score?: number; level?: RiskLevel; reason: string }): Promise<RiskRow> {
    const existing = await this.getRisk(companyId, riskId);
    return this.db.withTenant(companyId, async (sql) => {
      const [row] = await sql<RiskRow[]>`
        UPDATE risks SET
          override_score = ${input.score ?? existing.overrideScore}, override_level = ${input.level ?? existing.overrideLevel},
          override_by = ${userId}, override_at = now(), override_reason = ${input.reason},
          score = COALESCE(${input.score ?? existing.overrideScore}, automated_score),
          level = COALESCE(${input.level ?? existing.overrideLevel}, automated_level),
          updated_at = now()
        WHERE id = ${riskId} RETURNING *`;
      return row;
    });
  }

  async clearOverride(companyId: string, riskId: string): Promise<RiskRow> {
    return this.db.withTenant(companyId, async (sql) => {
      const [row] = await sql<RiskRow[]>`
        UPDATE risks SET override_score = NULL, override_level = NULL, override_by = NULL, override_at = NULL, override_reason = NULL,
          score = automated_score, level = automated_level, updated_at = now()
        WHERE id = ${riskId} RETURNING *`;
      return row;
    });
  }

  async setStatus(companyId: string, projectId: string, riskId: string, userId: string, status: RiskStatus, reason?: string): Promise<RiskRow> {
    const existing = await this.getRisk(companyId, riskId);
    const row = await this.db.withTenant(companyId, async (sql) => {
      const [r] = await sql<RiskRow[]>`
        UPDATE risks SET status = ${status},
          resolved_at = CASE WHEN ${status} = 'RESOLVED' THEN now() ELSE resolved_at END,
          closed_at = CASE WHEN ${status} = 'CLOSED' THEN now() ELSE closed_at END,
          updated_at = now()
        WHERE id = ${riskId} RETURNING *`;
      return r;
    });
    await this.recordStatusChange(companyId, projectId, riskId, existing.status, status, userId, reason ?? null);
    return row;
  }

  async assignOwner(companyId: string, riskId: string, ownerId: string | null): Promise<RiskRow> {
    return this.db.withTenant(companyId, async (sql) => {
      const [row] = await sql<RiskRow[]>`UPDATE risks SET owner_id = ${ownerId}, updated_at = now() WHERE id = ${riskId} RETURNING *`;
      return row;
    });
  }

  // ── Reports tab aggregations (brief sections 19-27, 32-33) ──────────────

  private isOpenStatus(status: RiskStatus): boolean {
    return status !== 'RESOLVED' && status !== 'CLOSED';
  }

  /** Executive Risk Summary (section 20) + AI-briefing-grounding data (section 21). */
  async getExecutiveSummary(companyId: string, projectId: string) {
    const risks = await this.listRisks(companyId, projectId);
    const openRisks = risks.filter(r => this.isOpenStatus(r.status));

    const overallScore = openRisks.length > 0
      ? Math.round(openRisks.reduce((sum, r) => sum + r.score, 0) / openRisks.length)
      : 0;
    const overallLevel = this.scoring.levelForScore(overallScore);

    const sevenDaysAgo = new Date(Date.now() - 7 * 86400000);
    let overallScoreTrendPct: number | null = null;
    if (openRisks.length > 0) {
      const priorScores = await this.db.withTenant(companyId, sql => sql<{ riskId: string; score: number }[]>`
        SELECT DISTINCT ON (risk_id) risk_id, score FROM risk_snapshots
        WHERE risk_id = ANY(${openRisks.map(r => r.id)}) AND snapshot_at <= ${sevenDaysAgo.toISOString()}
        ORDER BY risk_id, snapshot_at DESC`);
      if (priorScores.length >= Math.ceil(openRisks.length * 0.5)) {
        const priorAvg = priorScores.reduce((sum, r) => sum + r.score, 0) / priorScores.length;
        overallScoreTrendPct = priorAvg > 0 ? Math.round(((overallScore - priorAvg) / priorAvg) * 100) : null;
      }
    }

    return {
      overallScore, overallLevel, overallScoreTrendPct,
      criticalCount: openRisks.filter(r => r.level === 'CRITICAL').length,
      highCount: openRisks.filter(r => r.level === 'HIGH').length,
      increasingCount: openRisks.filter(r => r.trend === 'INCREASING').length,
      overdueCount: openRisks.filter(r => r.dueDate && new Date(r.dueDate).getTime() < Date.now()).length,
      totalOpenRisks: openRisks.length,
    };
  }

  async getTopRisks(companyId: string, projectId: string, limit = 10): Promise<RiskRow[]> {
    const risks = await this.listRisks(companyId, projectId);
    return risks.filter(r => this.isOpenStatus(r.status)).slice(0, limit);
  }

  /** Emerging risks (section 23): not yet critical, but trending up. */
  async getEmergingRisks(companyId: string, projectId: string, limit = 10): Promise<RiskRow[]> {
    const risks = await this.listRisks(companyId, projectId);
    return risks
      .filter(r => this.isOpenStatus(r.status) && r.trend === 'INCREASING' && r.level !== 'CRITICAL')
      .slice(0, limit);
  }

  async getRiskByDiscipline(companyId: string, projectId: string) {
    const rows = await this.db.withTenant(companyId, sql => sql<{ discipline: string | null; c: string; avgScore: string }[]>`
      SELECT discipline, COUNT(*) AS c, AVG(score) AS avg_score FROM risks
      WHERE project_id = ${projectId} AND status NOT IN ('RESOLVED','CLOSED')
      GROUP BY discipline`);
    return rows.map(r => ({ discipline: r.discipline ?? 'UNSPECIFIED', count: Number(r.c), averageScore: Math.round(Number(r.avgScore)) }));
  }

  async getRiskByLocation(companyId: string, projectId: string) {
    const rows = await this.db.withTenant(companyId, sql => sql<{ locationLabel: string | null; c: string; avgScore: string }[]>`
      SELECT location_label, COUNT(*) AS c, AVG(score) AS avg_score FROM risks
      WHERE project_id = ${projectId} AND status NOT IN ('RESOLVED','CLOSED') AND location_label IS NOT NULL
      GROUP BY location_label ORDER BY c DESC`);
    return rows.map(r => ({ location: r.locationLabel, count: Number(r.c), averageScore: Math.round(Number(r.avgScore)) }));
  }

  /** Real historical trend from risk_snapshots only — never fabricated (section 25). */
  async getProjectRiskTrend(companyId: string, projectId: string, days: 7 | 14 | 30 | 90) {
    const since = new Date(Date.now() - days * 86400000).toISOString();
    const rows = await this.db.withTenant(companyId, sql => sql<{ day: string; avgScore: string }[]>`
      SELECT date_trunc('day', snapshot_at)::date AS day, AVG(score) AS avg_score
      FROM risk_snapshots WHERE project_id = ${projectId} AND snapshot_at >= ${since}
      GROUP BY day ORDER BY day ASC`);
    return rows.map(r => ({ date: r.day, averageScore: Math.round(Number(r.avgScore)) }));
  }

  /** Cluster detection (section 33): locations with concentrated open risk. */
  async getRiskClusters(companyId: string, projectId: string, minCount = 3) {
    const rows = await this.db.withTenant(companyId, sql => sql<{ locationLabel: string; c: string; avgScore: string }[]>`
      SELECT location_label, COUNT(*) AS c, AVG(score) AS avg_score FROM risks
      WHERE project_id = ${projectId} AND status NOT IN ('RESOLVED','CLOSED') AND location_label IS NOT NULL
      GROUP BY location_label HAVING COUNT(*) >= ${minCount} ORDER BY c DESC`);
    return rows.map(r => ({ location: r.locationLabel, connectedRiskCount: Number(r.c), averageScore: Math.round(Number(r.avgScore)) }));
  }

  async getRiskChain(companyId: string, riskId: string) {
    const risk = await this.getRisk(companyId, riskId);
    const chain = await this.graph.buildRepresentativeChain(companyId, risk.rootNodeId, 6);
    const nodes = await Promise.all(chain.map(step => this.graph.getNode(companyId, step.nodeId)));
    return {
      riskId,
      steps: chain.map((step, i) => ({
        nodeId: step.nodeId,
        nodeType: nodes[i]?.nodeType, label: nodes[i]?.label,
        relationshipFromPrevious: step.viaEdge?.relationshipType ?? null,
        confidence: step.viaEdge?.confidence ?? null,
        source: step.viaEdge?.source ?? null,
      })),
    };
  }

  async getEvidenceWithNodes(companyId: string, riskId: string) {
    const rows = await this.db.withTenant(companyId, sql => sql<{ id: string; nodeId: string; role: string }[]>`
      SELECT id, node_id, role FROM risk_evidence WHERE risk_id = ${riskId}`);
    const withNodes = await Promise.all(rows.map(async (r) => ({ ...r, node: await this.graph.getNode(companyId, r.nodeId) })));
    return withNodes;
  }

  async getRiskHistory(companyId: string, riskId: string) {
    return this.db.withTenant(companyId, sql => sql`
      SELECT * FROM risk_snapshots WHERE risk_id = ${riskId} ORDER BY snapshot_at ASC`);
  }

  /** Empty-state / data-availability honesty (brief section 44). */
  async getDataAvailability(companyId: string, projectId: string) {
    const [[rfiCount], [issueCount], [snagCount], [qaCount], [bimCount]] = await Promise.all([
      this.db.withTenant(companyId, sql => sql<{ c: string }[]>`SELECT COUNT(*) AS c FROM rfis WHERE project_id = ${projectId}`),
      this.db.withTenant(companyId, sql => sql<{ c: string }[]>`SELECT COUNT(*) AS c FROM issues WHERE project_id = ${projectId}`),
      this.db.withTenant(companyId, sql => sql<{ c: string }[]>`SELECT COUNT(*) AS c FROM snag_items WHERE project_id = ${projectId}`),
      this.db.withTenant(companyId, sql => sql<{ c: string }[]>`SELECT COUNT(*) AS c FROM qa_inspections WHERE project_id = ${projectId}`),
      this.db.withTenant(companyId, sql => sql<{ c: string }[]>`SELECT COUNT(*) AS c FROM bim_elements WHERE project_id = ${projectId}`),
    ]);
    return {
      rfisAvailable: Number(rfiCount.c),
      issuesAvailable: Number(issueCount.c),
      snagItemsAvailable: Number(snagCount.c),
      qaInspectionsAvailable: Number(qaCount.c),
      bimElementRelationships: Number(bimCount.c) > 0 ? 'Available' : 'Not available',
      programmeData: 'Not connected — no programme/schedule module exists in this system yet.',
      procurementData: 'Not connected — no procurement/material module exists in this system yet.',
    };
  }
}
