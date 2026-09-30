import { Injectable } from '@nestjs/common';
import type { RiskSignalType } from '@engineeringos/types';
import { DatabaseService } from '../../database/database.service';

// RFI statuses that mean "this RFI is no longer awaiting action" -- everything
// else (including the legacy 'open' default) counts as still-open for
// overdue/aging purposes. See architecture assessment: workflow statuses
// were widened in migration 028 without renaming the legacy ones.
const CLOSED_RFI_STATUSES = ['answered', 'closed', 'void', 'rejected', 'cancelled'];
const CLOSED_ISSUE_STATUSES = ['resolved', 'closed', 'void'];
// Snag two-step closure: 'fixed' means work is done but not yet verified --
// still counted as active for overdue/aging, since it can still slip back.
const CLOSED_SNAG_STATUSES = ['verified', 'void'];

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

/**
 * Risk Signal Engine (brief section 9). Every signal type here is backed by
 * a real column or a real join on an existing table -- no signal exists for
 * the programme/procurement categories the brief describes, because no
 * programme-activity or material/procurement module exists in this
 * codebase (see architecture assessment). Signals whose condition no
 * longer holds are deleted, not left stale, so a resolved item's risk can
 * genuinely decrease (Scenario E).
 */
@Injectable()
export class SignalsService {
  constructor(private readonly db: DatabaseService) {}

  async detectSignalsForProject(companyId: string, projectId: string): Promise<void> {
    await this.detectRfiSignals(companyId, projectId);
    await this.detectIssueSignals(companyId, projectId);
    await this.detectSnagSignals(companyId, projectId);
    await this.detectDrawingSignals(companyId, projectId);
    await this.detectQaSignals(companyId, projectId);
  }

  private async upsertSignal(
    companyId: string, projectId: string, nodeId: string, signalType: RiskSignalType,
    severityContribution: number, details: Record<string, unknown>,
  ): Promise<void> {
    await this.db.withTenant(companyId, sql => sql`
      INSERT INTO risk_signals (company_id, project_id, node_id, signal_type, severity_contribution, details, detected_at)
      VALUES (${companyId}, ${projectId}, ${nodeId}, ${signalType}, ${clamp(severityContribution)}, ${JSON.stringify(details)}, now())
      ON CONFLICT (node_id, signal_type) DO UPDATE SET
        severity_contribution = EXCLUDED.severity_contribution,
        details = EXCLUDED.details,
        detected_at = now()`);
  }

  private async clearSignal(companyId: string, nodeId: string, signalType: RiskSignalType): Promise<void> {
    await this.db.withTenant(companyId, sql => sql`
      DELETE FROM risk_signals WHERE node_id = ${nodeId} AND signal_type = ${signalType}`);
  }

  // ── RFI signals ──────────────────────────────────────────────────────────

  async detectRfiSignals(companyId: string, projectId: string): Promise<void> {
    const rows = await this.db.withTenant(companyId, sql => sql<{
      nodeId: string; rfiId: string; status: string; priority: string; dueDate: string | null; createdAt: string;
      costImpactLevel: string; timeImpactLevel: string; timeImpactDays: number | null;
      drawingImpactLevel: string; drawingUpdateApplied: boolean;
    }[]>`
      SELECT n.id AS node_id, r.id AS rfi_id, r.status, r.priority, r.due_date, r.created_at,
             r.cost_impact_level, r.time_impact_level, r.time_impact_days,
             r.drawing_impact_level, r.drawing_update_applied
      FROM rfis r
      JOIN risk_graph_nodes n ON n.node_type = 'rfi' AND n.entity_id = r.id
      WHERE r.project_id = ${projectId}`);

    const now = Date.now();
    for (const rfi of rows) {
      const isOpen = !CLOSED_RFI_STATUSES.includes(rfi.status);
      const ageDays = (now - new Date(rfi.createdAt).getTime()) / 86400000;

      if (isOpen && rfi.dueDate && new Date(rfi.dueDate).getTime() < now) {
        const overdueDays = (now - new Date(rfi.dueDate).getTime()) / 86400000;
        await this.upsertSignal(companyId, projectId, rfi.nodeId, 'RFI_OVERDUE', 40 + overdueDays * 3, { overdueDays: Math.round(overdueDays) });
      } else {
        await this.clearSignal(companyId, rfi.nodeId, 'RFI_OVERDUE');
      }

      if (isOpen && ageDays > 21) {
        await this.upsertSignal(companyId, projectId, rfi.nodeId, 'RFI_AGING', 20 + (ageDays - 21) * 1.5, { ageDays: Math.round(ageDays) });
      } else {
        await this.clearSignal(companyId, rfi.nodeId, 'RFI_AGING');
      }

      if (isOpen && rfi.dueDate) {
        const daysToDue = (new Date(rfi.dueDate).getTime() - now) / 86400000;
        if (daysToDue >= 0 && daysToDue <= 5) {
          await this.upsertSignal(companyId, projectId, rfi.nodeId, 'RFI_APPROACHING_DUE', 30 + (5 - daysToDue) * 4, { daysToDue: Math.round(daysToDue) });
        } else {
          await this.clearSignal(companyId, rfi.nodeId, 'RFI_APPROACHING_DUE');
        }
      } else {
        await this.clearSignal(companyId, rfi.nodeId, 'RFI_APPROACHING_DUE');
      }

      if (isOpen && (rfi.priority === 'high' || rfi.priority === 'critical')) {
        await this.upsertSignal(companyId, projectId, rfi.nodeId, 'RFI_HIGH_PRIORITY', rfi.priority === 'critical' ? 55 : 35, { priority: rfi.priority });
      } else {
        await this.clearSignal(companyId, rfi.nodeId, 'RFI_HIGH_PRIORITY');
      }

      if (rfi.costImpactLevel === 'yes' || rfi.costImpactLevel === 'potential') {
        await this.upsertSignal(companyId, projectId, rfi.nodeId, 'RFI_COST_IMPACT', rfi.costImpactLevel === 'yes' ? 45 : 25, { level: rfi.costImpactLevel });
      } else {
        await this.clearSignal(companyId, rfi.nodeId, 'RFI_COST_IMPACT');
      }

      if (rfi.timeImpactLevel === 'yes' || rfi.timeImpactLevel === 'potential') {
        const days = rfi.timeImpactDays ?? 0;
        await this.upsertSignal(companyId, projectId, rfi.nodeId, 'RFI_TIME_IMPACT', (rfi.timeImpactLevel === 'yes' ? 40 : 22) + days, { level: rfi.timeImpactLevel, days });
      } else {
        await this.clearSignal(companyId, rfi.nodeId, 'RFI_TIME_IMPACT');
      }

      if ((rfi.drawingImpactLevel === 'yes' || rfi.drawingImpactLevel === 'potential') && !rfi.drawingUpdateApplied) {
        await this.upsertSignal(companyId, projectId, rfi.nodeId, 'RFI_DRAWING_UPDATE_NOT_APPLIED', 35, { drawingImpactLevel: rfi.drawingImpactLevel });
      } else {
        await this.clearSignal(companyId, rfi.nodeId, 'RFI_DRAWING_UPDATE_NOT_APPLIED');
      }

      const [{ relatedCount }] = await this.db.withTenant(companyId, sql => sql<{ relatedCount: string }[]>`
        SELECT COUNT(*) AS related_count FROM risk_graph_edges e
        JOIN risk_graph_nodes tn ON tn.id = e.to_node_id
        WHERE e.from_node_id = ${rfi.nodeId} AND tn.node_type = 'issue' AND e.relationship_type = 'RELATED_TO'
          AND tn.status IS NOT NULL AND NOT (tn.status = ANY(${CLOSED_ISSUE_STATUSES}))`);
      if (Number(relatedCount) >= 2) {
        await this.upsertSignal(companyId, projectId, rfi.nodeId, 'RFI_MULTIPLE_RELATED_ISSUES', 25 + Number(relatedCount) * 5, { relatedIssueCount: Number(relatedCount) });
      } else {
        await this.clearSignal(companyId, rfi.nodeId, 'RFI_MULTIPLE_RELATED_ISSUES');
      }
    }
  }

  // ── Issue signals ────────────────────────────────────────────────────────

  async detectIssueSignals(companyId: string, projectId: string): Promise<void> {
    const rows = await this.db.withTenant(companyId, sql => sql<{
      nodeId: string; issueId: string; status: string; priority: string; deadline: string | null;
      createdAt: string; locationId: string | null;
    }[]>`
      SELECT n.id AS node_id, i.id AS issue_id, i.status, i.priority, i.deadline, i.created_at, i.location_id
      FROM issues i
      JOIN risk_graph_nodes n ON n.node_type = 'issue' AND n.entity_id = i.id
      WHERE i.project_id = ${projectId}`);

    const now = Date.now();
    for (const issue of rows) {
      const isOpen = !CLOSED_ISSUE_STATUSES.includes(issue.status);
      const ageDays = (now - new Date(issue.createdAt).getTime()) / 86400000;

      if (isOpen && issue.deadline && new Date(issue.deadline).getTime() < now) {
        const overdueDays = (now - new Date(issue.deadline).getTime()) / 86400000;
        await this.upsertSignal(companyId, projectId, issue.nodeId, 'ISSUE_OVERDUE', 40 + overdueDays * 3, { overdueDays: Math.round(overdueDays) });
      } else {
        await this.clearSignal(companyId, issue.nodeId, 'ISSUE_OVERDUE');
      }

      if (isOpen && (issue.priority === 'high' || issue.priority === 'critical')) {
        await this.upsertSignal(companyId, projectId, issue.nodeId, 'ISSUE_HIGH_SEVERITY', issue.priority === 'critical' ? 55 : 35, { priority: issue.priority });
      } else {
        await this.clearSignal(companyId, issue.nodeId, 'ISSUE_HIGH_SEVERITY');
      }

      if (isOpen && ageDays > 21) {
        await this.upsertSignal(companyId, projectId, issue.nodeId, 'ISSUE_UNRESOLVED_AGING', 20 + (ageDays - 21) * 1.5, { ageDays: Math.round(ageDays) });
      } else {
        await this.clearSignal(companyId, issue.nodeId, 'ISSUE_UNRESOLVED_AGING');
      }

      if (issue.status === 'reopened') {
        await this.upsertSignal(companyId, projectId, issue.nodeId, 'ISSUE_REOPENED', 40, { status: issue.status });
      } else {
        const [{ reopenCount }] = await this.db.withTenant(companyId, sql => sql<{ reopenCount: string }[]>`
          SELECT COUNT(*) AS reopen_count FROM issue_activities WHERE issue_id = ${issue.issueId} AND activity_type = 'reopened'`);
        if (Number(reopenCount) > 0) {
          await this.upsertSignal(companyId, projectId, issue.nodeId, 'ISSUE_REOPENED', 30 + Number(reopenCount) * 10, { historicalReopenCount: Number(reopenCount) });
        } else {
          await this.clearSignal(companyId, issue.nodeId, 'ISSUE_REOPENED');
        }
      }

      if (issue.locationId) {
        // "Recurring" means an ongoing pattern of *unresolved* problems at
        // this location (brief Scenario B: "three unresolved issues in the
        // same location"), not a historical count that never clears once
        // every sibling has actually been fixed.
        const [{ siblingCount }] = await this.db.withTenant(companyId, sql => sql<{ siblingCount: string }[]>`
          SELECT COUNT(*) AS sibling_count FROM issues
          WHERE location_id = ${issue.locationId} AND id <> ${issue.issueId} AND NOT (status = ANY(${CLOSED_ISSUE_STATUSES}))`);
        if (Number(siblingCount) >= 2) {
          await this.upsertSignal(companyId, projectId, issue.nodeId, 'ISSUE_RECURRING_LOCATION', 20 + Number(siblingCount) * 6, { siblingIssueCount: Number(siblingCount) });
        } else {
          await this.clearSignal(companyId, issue.nodeId, 'ISSUE_RECURRING_LOCATION');
        }
      } else {
        await this.clearSignal(companyId, issue.nodeId, 'ISSUE_RECURRING_LOCATION');
      }

      const [{ relatedCount }] = await this.db.withTenant(companyId, sql => sql<{ relatedCount: string }[]>`
        SELECT COUNT(*) AS related_count FROM risk_graph_edges e
        JOIN risk_graph_nodes fn ON fn.id = e.from_node_id
        WHERE e.to_node_id = ${issue.nodeId} AND fn.node_type = 'rfi' AND e.relationship_type = 'RELATED_TO'
          AND fn.status IS NOT NULL AND NOT (fn.status = ANY(${CLOSED_RFI_STATUSES}))`);
      if (Number(relatedCount) >= 2) {
        await this.upsertSignal(companyId, projectId, issue.nodeId, 'ISSUE_MULTIPLE_RELATED_RFIS', 25 + Number(relatedCount) * 5, { relatedRfiCount: Number(relatedCount) });
      } else {
        await this.clearSignal(companyId, issue.nodeId, 'ISSUE_MULTIPLE_RELATED_RFIS');
      }
    }
  }

  // ── Snag signals ─────────────────────────────────────────────────────────

  async detectSnagSignals(companyId: string, projectId: string): Promise<void> {
    const rows = await this.db.withTenant(companyId, sql => sql<{
      nodeId: string; snagId: string; status: string; dueDate: string | null; createdAt: string; locationId: string | null;
    }[]>`
      SELECT n.id AS node_id, s.id AS snag_id, s.status, s.due_date, s.created_at, s.location_id
      FROM snag_items s
      JOIN risk_graph_nodes n ON n.node_type = 'snag_item' AND n.entity_id = s.id
      WHERE s.project_id = ${projectId}`);

    const now = Date.now();
    for (const snag of rows) {
      const isOpen = !CLOSED_SNAG_STATUSES.includes(snag.status);
      const ageDays = (now - new Date(snag.createdAt).getTime()) / 86400000;

      if (isOpen && snag.dueDate && new Date(snag.dueDate).getTime() < now) {
        const overdueDays = (now - new Date(snag.dueDate).getTime()) / 86400000;
        await this.upsertSignal(companyId, projectId, snag.nodeId, 'SNAG_OVERDUE', 35 + overdueDays * 3, { overdueDays: Math.round(overdueDays) });
      } else {
        await this.clearSignal(companyId, snag.nodeId, 'SNAG_OVERDUE');
      }

      if (isOpen && ageDays > 21) {
        await this.upsertSignal(companyId, projectId, snag.nodeId, 'SNAG_UNRESOLVED_AGING', 15 + (ageDays - 21) * 1.2, { ageDays: Math.round(ageDays) });
      } else {
        await this.clearSignal(companyId, snag.nodeId, 'SNAG_UNRESOLVED_AGING');
      }

      if (snag.locationId) {
        const [{ siblingCount }] = await this.db.withTenant(companyId, sql => sql<{ siblingCount: string }[]>`
          SELECT COUNT(*) AS sibling_count FROM snag_items
          WHERE location_id = ${snag.locationId} AND id <> ${snag.snagId} AND NOT (status = ANY(${CLOSED_SNAG_STATUSES}))`);
        if (Number(siblingCount) >= 2) {
          await this.upsertSignal(companyId, projectId, snag.nodeId, 'SNAG_RECURRING_LOCATION', 15 + Number(siblingCount) * 5, { siblingSnagCount: Number(siblingCount) });
        } else {
          await this.clearSignal(companyId, snag.nodeId, 'SNAG_RECURRING_LOCATION');
        }
      } else {
        await this.clearSignal(companyId, snag.nodeId, 'SNAG_RECURRING_LOCATION');
      }
    }
  }

  // ── Design (drawing) signals ─────────────────────────────────────────────

  async detectDrawingSignals(companyId: string, projectId: string): Promise<void> {
    const rows = await this.db.withTenant(companyId, sql => sql<{
      nodeId: string; drawingId: string; drawingNumber: string; revisionCount: string;
    }[]>`
      SELECT n.id AS node_id, d.id AS drawing_id, d.drawing_number, sibling.revision_count
      FROM drawings d
      JOIN risk_graph_nodes n ON n.node_type = 'drawing' AND n.entity_id = d.id
      JOIN (
        SELECT drawing_number, COUNT(*) AS revision_count FROM drawings WHERE project_id = ${projectId} GROUP BY drawing_number
      ) sibling ON sibling.drawing_number = d.drawing_number
      WHERE d.project_id = ${projectId} AND d.is_current = true`);

    for (const d of rows) {
      const count = Number(d.revisionCount);
      if (count >= 3) {
        await this.upsertSignal(companyId, projectId, d.nodeId, 'DRAWING_REPEATED_REVISIONS', 15 + count * 6, { revisionCount: count });
      } else {
        await this.clearSignal(companyId, d.nodeId, 'DRAWING_REPEATED_REVISIONS');
      }
    }
  }

  // ── Quality (QA inspection) signals ──────────────────────────────────────

  async detectQaSignals(companyId: string, projectId: string): Promise<void> {
    const rows = await this.db.withTenant(companyId, sql => sql<{ nodeId: string; status: string }[]>`
      SELECT n.id AS node_id, q.status
      FROM qa_inspections q
      JOIN risk_graph_nodes n ON n.node_type = 'qa_inspection' AND n.entity_id = q.id
      WHERE q.project_id = ${projectId}`);

    for (const qa of rows) {
      if (qa.status === 'failed') {
        await this.upsertSignal(companyId, projectId, qa.nodeId, 'QA_FAILED_INSPECTION', 45, { status: qa.status });
      } else {
        await this.clearSignal(companyId, qa.nodeId, 'QA_FAILED_INSPECTION');
      }
    }
  }
}
