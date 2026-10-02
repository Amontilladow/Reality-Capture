import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import type { RiskLevel, RiskStatus, RiskDiscipline, RiskNodeType, RiskMatrixLevel, RiskDriver, RiskMatrixSettings } from '@engineeringos/types';
import { RISK_DRIVERS, RISK_MATRIX_LEVELS, DEFAULT_RISK_MATRIX_THRESHOLDS, scoreToMatrixLevel } from '@engineeringos/types';
import { DatabaseService } from '../../database/database.service';
import { RiskGraphService, type GraphNodeRow } from './risk-graph.service';
import { RelationshipExtractionService } from './relationship-extraction.service';
import { SignalsService } from './signals.service';
import { ScoringService } from './scoring.service';
import { AiClientService } from '../ai-client/ai-client.service';
import { renderRiskPdf, type RiskPdfTopRisk } from './risk-pdf.template';

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
  // ── Risk Matrix (Probability x Impact, 1-25) -- see packages/types'
  // risk.types.ts comment block for how this relates to automatedScore/
  // score above (a separate, parallel scoring system, not a replacement).
  humanProbability: number | null; humanImpact: number | null;
  humanScore: number | null; humanLevel: RiskMatrixLevel | null;
  primaryDriver: RiskDriver | null; secondaryDriver: RiskDriver | null;
  humanAssessedBy: string | null; humanAssessedAt: string | null;
  aiScore: number | null; aiLevel: RiskMatrixLevel | null; aiConfidence: number | null;
  finalScore: number | null; finalLevel: RiskMatrixLevel | null;
  matrixOverrideBy: string | null; matrixOverrideAt: string | null; matrixOverrideReason: string | null;
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
    private readonly aiClient: AiClientService,
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
    const { level: confidenceLevel, reason: confidenceReason, percent: aiConfidence } = this.scoring.confidenceForNode(directCount, inferredCount, missingFields);

    const matrixSettings = await this.getRiskMatrixSettings(companyId);
    const { score: aiScore, level: aiLevel } = this.scoring.computeAiMatrixScore(factors, matrixSettings.thresholds ?? DEFAULT_RISK_MATRIX_THRESHOLDS);

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
      confidenceLevel, confidenceReason, aiScore, aiLevel, aiConfidence, trend, explanation, recommendedAction,
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
        -- AI Score floors at 1 (there is no "0" on the Risk Matrix's 1-25
        -- scale); final_score/final_level follow the same override > human
        -- > AI priority as upsertRisk() above.
        ai_score = 1, ai_level = 'LOW',
        final_score = CASE WHEN matrix_override_by IS NOT NULL THEN final_score WHEN human_score IS NOT NULL THEN human_score ELSE 1 END,
        final_level = CASE WHEN matrix_override_by IS NOT NULL THEN final_level WHEN human_level IS NOT NULL THEN human_level ELSE 'LOW' END,
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
    aiScore: number; aiLevel: RiskMatrixLevel; aiConfidence: number;
    trend: RiskRow['trend']; explanation: string; recommendedAction: string; resurrect: boolean;
  }): Promise<RiskRow> {
    return this.db.withTenant(companyId, async (sql) => {
      const [row] = await sql<RiskRow[]>`
        INSERT INTO risks (
          company_id, project_id, root_node_id, title, category, discipline, location_node_id, location_label,
          automated_score, automated_level, score, level,
          probability, impact, exposure, dependency, urgency, recurrence,
          confidence_level, confidence_reason,
          ai_score, ai_level, ai_confidence, final_score, final_level,
          trend, status, explanation, recommended_action
        )
        VALUES (
          ${companyId}, ${projectId}, ${input.rootNodeId}, ${input.title}, ${input.category}, ${input.discipline},
          ${input.locationNodeId}, ${input.locationLabel},
          ${input.automatedScore}, ${input.automatedLevel}, ${input.automatedScore}, ${input.automatedLevel},
          ${input.probability}, ${input.impact}, ${input.exposure}, ${input.dependency}, ${input.urgency}, ${input.recurrence},
          ${input.confidenceLevel}, ${input.confidenceReason},
          ${input.aiScore}, ${input.aiLevel}, ${input.aiConfidence}, ${input.aiScore}, ${input.aiLevel},
          ${input.trend}, 'DETECTED', ${input.explanation}, ${input.recommendedAction}
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
          -- AI Score always reflects the latest deterministic recalculation
          -- (it's not a user-settable value, so there's nothing to
          -- preserve). final_score/final_level follow the Risk Matrix's own
          -- override > human > AI priority (brief sections 11-12) -- an
          -- active matrix override or an existing human assessment must
          -- never be silently overwritten by a routine recalculation.
          ai_score = EXCLUDED.ai_score, ai_level = EXCLUDED.ai_level, ai_confidence = EXCLUDED.ai_confidence,
          final_score = CASE
            WHEN risks.matrix_override_by IS NOT NULL THEN risks.final_score
            WHEN risks.human_score IS NOT NULL THEN risks.human_score
            ELSE EXCLUDED.ai_score END,
          final_level = CASE
            WHEN risks.matrix_override_by IS NOT NULL THEN risks.final_level
            WHEN risks.human_level IS NOT NULL THEN risks.human_level
            ELSE EXCLUDED.ai_level END,
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

  // ── Risk Matrix: human Probability x Impact assessment (sections 3-6, 40) ──
  //
  // A second, parallel scoring system to the automated/override/score
  // columns above -- see RiskRow's own comment and packages/types'
  // risk.types.ts for why these never mix. probability/impact are never
  // delegated to an LLM (section 36): humanScore is pure multiplication,
  // computed here, not asked of the AI service.

  // Configurable matrix thresholds (section 4) reuse the existing
  // companies.settings JSONB column + PATCH /company/settings endpoint
  // (tenancy.controller.ts) -- no new settings table/endpoint needed.
  private async getRiskMatrixSettings(companyId: string): Promise<RiskMatrixSettings> {
    const [row] = await this.db.withTenant(companyId, sql => sql<{ settings: Record<string, unknown> }[]>`
      SELECT settings FROM companies WHERE id = ${companyId}`);
    return (row?.settings?.riskMatrix as RiskMatrixSettings | undefined) ?? {};
  }

  /**
   * Records (or updates) an engineer's manual Probability x Impact
   * assessment for one risk. A fresh human assessment is never itself an
   * "override" -- per section 11, keeping the human assessment is the
   * default once one exists, so this becomes the new final value and
   * clears out any earlier matrix override (which was made against a now-
   * superseded assessment and would otherwise silently keep applying).
   */
  async setHumanAssessment(
    companyId: string, projectId: string, riskId: string, userId: string,
    input: { probability: number; impact: number; primaryDriver: RiskDriver; secondaryDriver?: RiskDriver | null },
  ): Promise<RiskRow> {
    if (!Number.isInteger(input.probability) || input.probability < 1 || input.probability > 5) {
      throw new BadRequestException('Probability must be an integer between 1 and 5.');
    }
    if (!Number.isInteger(input.impact) || input.impact < 1 || input.impact > 5) {
      throw new BadRequestException('Impact must be an integer between 1 and 5.');
    }
    if (!RISK_DRIVERS.includes(input.primaryDriver)) {
      throw new BadRequestException(`Unknown risk driver "${input.primaryDriver}".`);
    }
    if (input.secondaryDriver && !RISK_DRIVERS.includes(input.secondaryDriver)) {
      throw new BadRequestException(`Unknown secondary risk driver "${input.secondaryDriver}".`);
    }

    const existing = await this.getRisk(companyId, riskId);
    const settings = await this.getRiskMatrixSettings(companyId);
    const humanScore = input.probability * input.impact;
    const humanLevel = scoreToMatrixLevel(humanScore, settings.thresholds ?? DEFAULT_RISK_MATRIX_THRESHOLDS);
    const { finalScore, finalLevel } = computeFinalMatrix({ humanScore, humanLevel, aiScore: existing.aiScore, aiLevel: existing.aiLevel });

    // A risk sitting at DETECTED is the brief's own "Not Assessed" (section
    // 6) -- the engine found it, but no human has assigned Probability/
    // Impact yet. The very act of doing so is what "assessed" means, so it
    // moves to ACTIVE here. Any other status (already ACTIVE, MONITORING,
    // ESCALATED, etc.) reflects a deliberate lifecycle decision a human
    // already made and is left exactly as it was.
    const nextStatus: RiskStatus = existing.status === 'DETECTED' ? 'ACTIVE' : existing.status;

    const row = await this.db.withTenant(companyId, async (sql) => {
      const [r] = await sql<RiskRow[]>`
        UPDATE risks SET
          human_probability = ${input.probability}, human_impact = ${input.impact},
          human_score = ${humanScore}, human_level = ${humanLevel},
          primary_driver = ${input.primaryDriver}, secondary_driver = ${input.secondaryDriver ?? null},
          human_assessed_by = ${userId}, human_assessed_at = now(),
          final_score = ${finalScore}, final_level = ${finalLevel},
          matrix_override_by = NULL, matrix_override_at = NULL, matrix_override_reason = NULL,
          status = ${nextStatus},
          updated_at = now()
        WHERE id = ${riskId} RETURNING *`;
      return r;
    });

    await this.db.withTenant(companyId, sql => sql`
      INSERT INTO risk_assessment_history (
        company_id, project_id, risk_id, assessment_type, probability, impact, score, level,
        primary_driver, secondary_driver, performed_by
      ) VALUES (
        ${companyId}, ${projectId}, ${riskId}, 'HUMAN', ${input.probability}, ${input.impact}, ${humanScore}, ${humanLevel},
        ${input.primaryDriver}, ${input.secondaryDriver ?? null}, ${userId}
      )`);

    if (nextStatus !== existing.status) {
      await this.recordStatusChange(companyId, projectId, riskId, existing.status, nextStatus, userId, 'Risk Matrix assessment recorded.');
    }

    return row;
  }

  async getRiskAssessmentHistory(companyId: string, riskId: string) {
    return this.db.withTenant(companyId, sql => sql`
      SELECT h.*, u.first_name || ' ' || u.last_name AS performed_by_name
      FROM risk_assessment_history h
      LEFT JOIN users u ON u.id = h.performed_by
      WHERE h.risk_id = ${riskId}
      ORDER BY h.performed_at DESC`);
  }

  /**
   * Human-vs-AI discrepancy (brief section 11/40): null whenever either side
   * hasn't been computed yet -- a risk that's never had a human assessment
   * has nothing to disagree with, and that is not itself a discrepancy.
   * levelGap is the distance between the two levels on the matrix's own
   * ordered 5-level scale (RISK_MATRIX_LEVELS), not a raw score difference,
   * since a 1-level gap near a threshold boundary is a much smaller
   * disagreement than the same score delta straddling two bands further apart.
   */
  static detectMatrixDiscrepancy(
    risk: Pick<RiskRow, 'humanScore' | 'humanLevel' | 'aiScore' | 'aiLevel' | 'matrixOverrideBy'>,
  ): { hasDiscrepancy: boolean; levelGap: number; scoreDelta: number; reviewed: boolean } | null {
    if (risk.humanScore == null || risk.humanLevel == null || risk.aiScore == null || risk.aiLevel == null) return null;
    const levelGap = Math.abs(RISK_MATRIX_LEVELS.indexOf(risk.humanLevel) - RISK_MATRIX_LEVELS.indexOf(risk.aiLevel));
    return { hasDiscrepancy: levelGap > 0, levelGap, scoreDelta: Math.abs(risk.humanScore - risk.aiScore), reviewed: risk.matrixOverrideBy != null };
  }

  async getRiskWithDiscrepancy(companyId: string, riskId: string): Promise<RiskRow & { discrepancy: ReturnType<typeof RiskService.detectMatrixDiscrepancy> }> {
    const risk = await this.getRisk(companyId, riskId);
    return { ...risk, discrepancy: RiskService.detectMatrixDiscrepancy(risk) };
  }

  /** Open, not-yet-reviewed Human-vs-AI discrepancies, for an alerts/review list (brief section 11). Once an engineer accepts AI, keeps human, or applies a custom override, it drops off this list. */
  async getMatrixDiscrepancies(companyId: string, projectId: string) {
    const risks = await this.listRisks(companyId, projectId);
    return risks
      .filter(r => this.isOpenStatus(r.status))
      .map(r => ({ risk: r, discrepancy: RiskService.detectMatrixDiscrepancy(r) }))
      .filter((x): x is { risk: RiskRow; discrepancy: NonNullable<ReturnType<typeof RiskService.detectMatrixDiscrepancy>> } =>
        x.discrepancy !== null && x.discrepancy.hasDiscrepancy && !x.discrepancy.reviewed);
  }

  /**
   * The audited Risk Matrix override layer (brief sections 11, 40):
   * "Accept AI Assessment" / "Keep Human Assessment" / "Update Assessment"
   * (the last of these is just a fresh setHumanAssessment() call -- it
   * already clears any override, no separate code path needed) plus a
   * free-form CUSTOM override for an engineer who disagrees with both.
   * Every decision is written to risk_assessment_history, including
   * KEEP_HUMAN even though it stores the same score/level the human
   * assessment already produced -- recording an explicit override is what
   * marks the discrepancy as reviewed/dismissed (detectMatrixDiscrepancy()
   * still reports a level gap purely from humanLevel vs aiLevel, so without
   * this the UI would have no way to know a human already looked at it and
   * chose to keep their own assessment rather than silently never asking).
   */
  async setMatrixOverride(
    companyId: string, projectId: string, riskId: string, userId: string,
    input: { decision: 'ACCEPT_AI' | 'KEEP_HUMAN' | 'CUSTOM'; score?: number; level?: RiskMatrixLevel; reason?: string },
  ): Promise<RiskRow> {
    const existing = await this.getRisk(companyId, riskId);

    let score: number;
    let level: RiskMatrixLevel;
    let reason: string;

    if (input.decision === 'ACCEPT_AI') {
      if (existing.aiScore == null || existing.aiLevel == null) {
        throw new BadRequestException('No AI score is available for this risk yet.');
      }
      score = existing.aiScore; level = existing.aiLevel;
      reason = input.reason?.trim() || 'Accepted AI assessment over human assessment.';
    } else if (input.decision === 'KEEP_HUMAN') {
      if (existing.humanScore == null || existing.humanLevel == null) {
        throw new BadRequestException('This risk has no human assessment to keep.');
      }
      score = existing.humanScore; level = existing.humanLevel;
      reason = input.reason?.trim() || 'Reviewed discrepancy — kept human assessment.';
    } else {
      if (!Number.isInteger(input.score) || (input.score as number) < 1 || (input.score as number) > 25) {
        throw new BadRequestException('Custom override score must be an integer between 1 and 25.');
      }
      if (!input.level || !RISK_MATRIX_LEVELS.includes(input.level)) {
        throw new BadRequestException('Custom override requires a valid risk level.');
      }
      if (!input.reason?.trim()) {
        throw new BadRequestException('A reason is required for a custom Risk Matrix override.');
      }
      score = input.score as number; level = input.level; reason = input.reason.trim();
    }

    const row = await this.db.withTenant(companyId, async (sql) => {
      const [r] = await sql<RiskRow[]>`
        UPDATE risks SET
          matrix_override_by = ${userId}, matrix_override_at = now(), matrix_override_reason = ${reason},
          final_score = ${score}, final_level = ${level},
          updated_at = now()
        WHERE id = ${riskId} RETURNING *`;
      return r;
    });

    await this.db.withTenant(companyId, sql => sql`
      INSERT INTO risk_assessment_history (company_id, project_id, risk_id, assessment_type, score, level, reason, performed_by)
      VALUES (${companyId}, ${projectId}, ${riskId}, 'OVERRIDE', ${score}, ${level}, ${reason}, ${userId})`);

    return row;
  }

  /** Reverts to the default Risk Matrix priority (human assessment, else AI score) by clearing any explicit override. */
  async clearMatrixOverride(companyId: string, projectId: string, riskId: string, userId: string): Promise<RiskRow> {
    const existing = await this.getRisk(companyId, riskId);
    const { finalScore, finalLevel } = computeFinalMatrix({
      humanScore: existing.humanScore, humanLevel: existing.humanLevel,
      aiScore: existing.aiScore, aiLevel: existing.aiLevel,
    });

    const row = await this.db.withTenant(companyId, async (sql) => {
      const [r] = await sql<RiskRow[]>`
        UPDATE risks SET
          matrix_override_by = NULL, matrix_override_at = NULL, matrix_override_reason = NULL,
          final_score = ${finalScore}, final_level = ${finalLevel},
          updated_at = now()
        WHERE id = ${riskId} RETURNING *`;
      return r;
    });

    await this.db.withTenant(companyId, sql => sql`
      INSERT INTO risk_assessment_history (company_id, project_id, risk_id, assessment_type, score, level, reason, performed_by)
      VALUES (${companyId}, ${projectId}, ${riskId}, 'OVERRIDE', ${finalScore}, ${finalLevel}, 'Override cleared.', ${userId})`);

    return row;
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

  // ── Graph visualization support (brief sections 11, 28-29) ──────────────

  /**
   * The whole-project (or filtered) graph for the Risk Graph visualization.
   * Bounded by whatever real data exists for the project -- there is no
   * separate depth/node cap here the way getNeighborhood has one, since
   * this reads the already-persisted, already-bounded per-project node set
   * rather than doing a live traversal. Each node is annotated with its
   * associated risk's score/level/status when one exists, so the frontend
   * can filter/color by risk level without a second round trip.
   */
  async getProjectGraph(companyId: string, projectId: string, filters: { nodeTypes?: RiskNodeType[]; discipline?: string } = {}) {
    const nodes = await this.graph.getNodesByProject(companyId, projectId, filters.nodeTypes);
    const filteredNodes = filters.discipline ? nodes.filter(n => n.discipline === filters.discipline) : nodes;
    const nodeIds = filteredNodes.map(n => n.id);
    const edges = await this.graph.getEdgesAmongNodes(companyId, projectId, nodeIds);
    return { nodes: await this.annotateNodesWithRisk(companyId, projectId, filteredNodes), edges };
  }

  /** Same shape as getProjectGraph, but scoped to one risk's bounded neighborhood instead of the whole project (section 11's "expand/focus" view). */
  async getGraphNeighborhood(companyId: string, projectId: string, rootNodeId: string, maxDepth?: number) {
    const { nodes, edges } = await this.graph.getNeighborhood(companyId, rootNodeId, { maxDepth });
    return { nodes: await this.annotateNodesWithRisk(companyId, projectId, nodes), edges };
  }

  private async annotateNodesWithRisk(companyId: string, projectId: string, nodes: GraphNodeRow[]) {
    const nodeIds = nodes.map(n => n.id);
    const riskRows = nodeIds.length > 0
      ? await this.db.withTenant(companyId, sql => sql<{ rootNodeId: string; score: number; level: RiskLevel; status: RiskStatus }[]>`
          SELECT root_node_id, score, level, status FROM risks WHERE project_id = ${projectId} AND root_node_id = ANY(${nodeIds})`)
      : [];
    const riskByNode = new Map(riskRows.map(r => [r.rootNodeId, r]));
    return nodes.map(n => ({ ...n, risk: riskByNode.get(n.id) ?? null }));
  }

  /** Node click detail (section 29): the node itself, its associated risk if any, and its direct neighbors with relationship context. */
  async getNodeDetail(companyId: string, nodeId: string) {
    const node = await this.graph.getNode(companyId, nodeId);
    if (!node) throw new NotFoundException('Node not found.');

    const [outgoing, incoming, risk] = await Promise.all([
      this.graph.getOutgoingEdges(companyId, nodeId),
      this.graph.getIncomingEdges(companyId, nodeId),
      this.getRiskByRootNode(companyId, nodeId),
    ]);

    const related = await Promise.all([
      ...outgoing.map(async (e) => ({ node: await this.graph.getNode(companyId, e.toNodeId), relationshipType: e.relationshipType, direction: 'outgoing' as const, source: e.source, confidence: e.confidence })),
      ...incoming.map(async (e) => ({ node: await this.graph.getNode(companyId, e.fromNodeId), relationshipType: e.relationshipType, direction: 'incoming' as const, source: e.source, confidence: e.confidence })),
    ]);

    return { node, risk, related: related.filter(r => r.node !== null) };
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

  // ── Management report export (brief section 15) ─────────────────────────
  //
  // aiBriefing is the exact narrative text the caller already generated (and
  // the user already read) via generateAiBriefing() above -- this method
  // never calls the AI itself, so the PDF can never show a different
  // narrative than what's on screen, and never blocks/slows PDF generation
  // on an LLM round trip. Omitted entirely, not replaced with a
  // placeholder, when the caller never generated one.
  async generatePdf(companyId: string, projectId: string, aiBriefing?: string): Promise<{ buffer: Buffer; filename: string }> {
    const [project, summary, topRisks, allRisks, byDiscipline, clusters, availability] = await Promise.all([
      this.db.withTenant(companyId, sql => sql<{ name: string; code: string | null }[]>`
        SELECT name, code FROM projects WHERE id = ${projectId} AND company_id = ${companyId}`).then(rows => rows[0]),
      this.getExecutiveSummary(companyId, projectId),
      this.getTopRisks(companyId, projectId, 10),
      this.listRisks(companyId, projectId),
      this.getRiskByDiscipline(companyId, projectId),
      this.getRiskClusters(companyId, projectId),
      this.getDataAvailability(companyId, projectId),
    ]);

    const toRow = (r: RiskRow): RiskPdfTopRisk => ({
      title: r.title, category: r.category, discipline: r.discipline ?? undefined,
      score: r.score, level: r.level, status: r.status, trend: r.trend,
    });

    const register = allRisks.filter(r => this.isOpenStatus(r.status)).map(toRow);

    const dataAvailabilityNotes = [
      `RFIs available: ${availability.rfisAvailable}`,
      `Issues available: ${availability.issuesAvailable}`,
      `Snag items available: ${availability.snagItemsAvailable}`,
      `QA inspections available: ${availability.qaInspectionsAvailable}`,
      `BIM element relationships: ${availability.bimElementRelationships}`,
      `Programme data: ${availability.programmeData}`,
      `Procurement data: ${availability.procurementData}`,
    ];

    const buffer = await renderRiskPdf({
      projectName: project?.name ?? '—',
      projectCode: project?.code ?? undefined,
      generatedAt: new Date().toLocaleString('en-GB'),
      overallScore: summary.overallScore,
      overallLevel: summary.overallLevel,
      overallScoreTrendPct: summary.overallScoreTrendPct,
      criticalCount: summary.criticalCount,
      highCount: summary.highCount,
      increasingCount: summary.increasingCount,
      overdueCount: summary.overdueCount,
      totalOpenRisks: summary.totalOpenRisks,
      byDiscipline: byDiscipline.map(g => ({ label: g.discipline, count: g.count })),
      clusters: clusters.map(c => ({ location: c.location, connectedRiskCount: c.connectedRiskCount, averageScore: c.averageScore })),
      topRisks: topRisks.map(toRow),
      register,
      aiBriefing: aiBriefing?.trim() ? aiBriefing.trim() : undefined,
      dataAvailabilityNotes,
    });

    const date = new Date().toISOString().slice(0, 10);
    const filename = `${project?.code ?? 'project'}-risk-report-${date}.pdf`;

    return { buffer, filename };
  }

  // ── AI reasoning layer (brief sections 13, 21, 39) ──────────────────────
  //
  // The AI never computes a score, never decides a recommended action, and
  // never sees raw project data directly -- it only receives a plain-text
  // context string built here from already-computed, real values (the same
  // risk/evidence/chain data the deterministic UI already shows) and turns
  // it into readable prose. If the AI service is unreachable or the LLM
  // call fails, this degrades to an explicit "unavailable" result rather
  // than a 500 or a fabricated narrative -- the deterministic explanation/
  // recommendedAction on the Risk itself remain the ground truth either way.

  async generateAiBriefing(companyId: string, projectId: string): Promise<{ narrative: string } | { unavailable: true; reason: string }> {
    const [summary, topRisks, clusters] = await Promise.all([
      this.getExecutiveSummary(companyId, projectId),
      this.getTopRisks(companyId, projectId, 5),
      this.getRiskClusters(companyId, projectId),
    ]);
    if (summary.totalOpenRisks === 0) {
      return { unavailable: true, reason: 'No open risks to summarize yet.' };
    }
    const context = buildRiskBriefingContext(summary, topRisks, clusters);
    try {
      const { narrative } = await this.aiClient.generateRiskBriefing(companyId, projectId, context);
      return { narrative };
    } catch (err) {
      this.logger.warn(`AI briefing generation failed: ${err instanceof Error ? err.message : String(err)}`);
      return { unavailable: true, reason: 'AI briefing is not available right now.' };
    }
  }

  async generateAiExplanation(companyId: string, projectId: string, riskId: string): Promise<{ narrative: string } | { unavailable: true; reason: string }> {
    const [risk, evidence, chain] = await Promise.all([
      this.getRisk(companyId, riskId),
      this.getEvidenceWithNodes(companyId, riskId),
      this.getRiskChain(companyId, riskId),
    ]);
    const context = buildRiskExplanationContext(risk, evidence, chain);
    try {
      const { narrative } = await this.aiClient.explainRisk(companyId, projectId, context);
      return { narrative };
    } catch (err) {
      this.logger.warn(`AI risk explanation failed: ${err instanceof Error ? err.message : String(err)}`);
      return { unavailable: true, reason: 'AI explanation is not available right now.' };
    }
  }
}

// ── Pure context-building functions (exported for direct unit testing) ─────

/** The one number/level actually shown as "the" risk on the Risk Matrix: an explicit override, else human judgment, else the AI score (brief sections 11-12). */
export function computeFinalMatrix(
  input: { humanScore: number | null; humanLevel: RiskMatrixLevel | null; aiScore: number | null; aiLevel: RiskMatrixLevel | null },
  override?: { score: number; level: RiskMatrixLevel } | null,
): { finalScore: number | null; finalLevel: RiskMatrixLevel | null } {
  if (override) return { finalScore: override.score, finalLevel: override.level };
  if (input.humanScore != null && input.humanLevel != null) return { finalScore: input.humanScore, finalLevel: input.humanLevel };
  return { finalScore: input.aiScore, finalLevel: input.aiLevel };
}

type ExecutiveSummary = Awaited<ReturnType<RiskService['getExecutiveSummary']>>;
type RiskCluster = { location: string; connectedRiskCount: number; averageScore: number };
type EvidenceWithNode = Awaited<ReturnType<RiskService['getEvidenceWithNodes']>>[number];
type RiskChainResult = Awaited<ReturnType<RiskService['getRiskChain']>>;

export function buildRiskBriefingContext(summary: ExecutiveSummary, topRisks: RiskRow[], clusters: RiskCluster[]): string {
  const lines: string[] = [];
  lines.push(`Overall risk score: ${summary.overallScore}/100 (${summary.overallLevel})`);
  if (summary.overallScoreTrendPct !== null) {
    lines.push(`7-day trend: ${summary.overallScoreTrendPct > 0 ? '+' : ''}${summary.overallScoreTrendPct}%`);
  }
  lines.push(`Open risks: ${summary.totalOpenRisks} (Critical: ${summary.criticalCount}, High: ${summary.highCount}, Increasing: ${summary.increasingCount}, Overdue items: ${summary.overdueCount})`);
  if (topRisks.length > 0) {
    lines.push('Top risks:');
    topRisks.forEach((r, i) => lines.push(`${i + 1}. [${r.level}, ${r.score}] ${r.title} (trend: ${r.trend.toLowerCase()})`));
  } else {
    lines.push('No open risks currently recorded.');
  }
  if (clusters.length > 0) {
    lines.push('Risk clusters (locations with concentrated open risk):');
    clusters.forEach(c => lines.push(`- ${c.location}: ${c.connectedRiskCount} connected risks, average score ${c.averageScore}`));
  } else {
    lines.push('No risk clusters detected.');
  }
  return lines.join('\n');
}

export function buildRiskExplanationContext(risk: RiskRow, evidence: EvidenceWithNode[], chain: RiskChainResult): string {
  const lines: string[] = [];
  lines.push(`Risk: ${risk.title}`);
  lines.push(`Category: ${risk.category}${risk.discipline ? ` | Discipline: ${risk.discipline}` : ''}${risk.locationLabel ? ` | Location: ${risk.locationLabel}` : ''}`);
  lines.push(`Score: ${risk.score}/100 (${risk.level}) | Trend: ${risk.trend} | Confidence: ${risk.confidenceLevel}${risk.confidenceReason ? ` (${risk.confidenceReason})` : ''}`);
  lines.push(`Factors: Probability ${risk.probability}, Impact ${risk.impact}, Exposure ${risk.exposure}, Dependency ${risk.dependency}, Urgency ${risk.urgency}, Recurrence ${risk.recurrence}`);
  if (risk.explanation) lines.push(`Deterministic explanation (already computed -- do not contradict): ${risk.explanation}`);
  if (risk.recommendedAction) lines.push(`Recommended action (already determined -- restate, don't replace): ${risk.recommendedAction}`);
  if (evidence.length > 0) {
    lines.push('Evidence:');
    for (const e of evidence) {
      if (e.node) lines.push(`- ${e.role}: ${e.node.nodeType} — ${e.node.label}`);
    }
  }
  if (chain.steps.length > 1) {
    const chainText = chain.steps.map((s, i) => {
      if (i === 0) return s.label;
      const inferredNote = s.confidence !== null && s.confidence !== undefined && s.confidence < 1
        ? ` (inferred, ${Math.round((s.confidence ?? 0) * 100)}%)` : '';
      return `${s.relationshipFromPrevious}${inferredNote} -> ${s.label}`;
    }).join(' ');
    lines.push(`Risk chain: ${chainText}`);
  }
  return lines.join('\n');
}
