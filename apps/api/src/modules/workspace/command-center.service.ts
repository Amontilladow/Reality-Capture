import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { classifyAttention, ATTENTION_ORDER, localNow, dayDiff, type AttentionClass } from './priority-rules';
import { WorkspaceService } from './workspace.service';

// One server-side aggregation for the project Command Center: the KPI
// snapshot and the attention center. Served under /projects/:projectId so
// every project guard (tenancy, subcontractor block, ...) applies exactly
// as it does to the module pages these numbers come from.
//
// KPI definitions (also in docs/command-center-plan.md):
//   totalDrawings      current site drawings, excluding SUPERSEDED/WITHDRAWN
//   pendingActions     open issues + open RFIs + open snags + open QA/QC
//                      records + open submittals + scheduled inspections
//   overdueItems       those of the above with a due date in the past
//                      (an item with no due date is never overdue)
//   documentCompliance approved (APPROVED + APPROVED_FOR_CONSTRUCTION) ÷
//                      current drawings with a known status; null below 5
//                      such drawings (not enough data to mean anything)

export const COMPLIANCE_MIN_DRAWINGS = 5;

export interface AttentionItem {
  key: string;
  type: 'drawing' | 'rfi' | 'qaqc' | 'inspection' | 'submittal' | 'issue' | 'snag';
  id: string;
  reference: string | null;
  title: string;
  responsible: string | null;
  dueDate: string | null;
  since: string | null;
  priority: string | null;
  status: string;
  class: AttentionClass;
  label: string;
  recordType?: string | null;
}

@Injectable()
export class CommandCenterService {
  constructor(
    private readonly db: DatabaseService,
    private readonly workspace: WorkspaceService,
  ) {}

  async summary(companyId: string, userId: string, projectId: string, browserTz?: string, now = new Date()) {
    const tz = await this.workspace.resolveTimeZone(companyId, userId, browserTz);
    const { today } = localNow(tz, now);
    return this.db.withTenant(companyId, async (sql) => {
      const [project] = await sql`
        SELECT p.id, p.name, p.code, p.status, p.location, p.city, p.country, p.updated_at,
               (SELECT MAX(a.occurred_at) FROM audit_log a WHERE a.company_id = ${companyId} AND a.project_id = p.id) AS last_activity_at
        FROM projects p WHERE p.id = ${projectId} AND p.company_id = ${companyId}
      `;
      if (!project) throw new NotFoundException('Project not found');

      const [drawings] = await sql`
        SELECT
          COUNT(*) FILTER (WHERE current_workflow_status NOT IN ('SUPERSEDED', 'WITHDRAWN'))::int AS current,
          COUNT(*) FILTER (WHERE current_workflow_status NOT IN ('SUPERSEDED', 'WITHDRAWN', 'UNKNOWN'))::int AS known,
          COUNT(*) FILTER (WHERE current_workflow_status IN ('APPROVED', 'APPROVED_FOR_CONSTRUCTION'))::int AS approved,
          COUNT(*) FILTER (WHERE current_workflow_status = 'UNDER_REVIEW')::int AS under_review
        FROM site_drawings WHERE company_id = ${companyId} AND project_id = ${projectId}
      `;

      // Open items with a due date expressed as a local date (YYYY-MM-DD);
      // the same query feeds both "pending" and "overdue", so they can't
      // disagree.
      const open = await sql`
        SELECT 'issue' AS type, i.id, i.issue_number AS reference, i.title, i.status::text AS status, i.priority::text AS priority,
               to_char(i.deadline AT TIME ZONE ${tz}, 'YYYY-MM-DD') AS due_date, i.created_at AS since, i.assigned_to, NULL AS record_type
        FROM issues i WHERE i.company_id = ${companyId} AND i.project_id = ${projectId}
          AND i.status::text IN ('open', 'assigned', 'in_progress', 'waiting_for_information', 'reopened')
        UNION ALL
        SELECT 'rfi', r.id, r.rfi_number, r.subject, r.status, r.priority, to_char(r.due_date AT TIME ZONE ${tz}, 'YYYY-MM-DD'), r.created_at, r.assigned_to, NULL
        FROM rfis r WHERE r.company_id = ${companyId} AND r.project_id = ${projectId} AND r.status = 'open'
        UNION ALL
        SELECT 'snag', s.id, s.snag_number, s.title, s.status, s.priority, to_char(s.due_date AT TIME ZONE ${tz}, 'YYYY-MM-DD'), s.created_at, s.assigned_to, NULL
        FROM snag_items s WHERE s.company_id = ${companyId} AND s.project_id = ${projectId} AND s.status = 'open'
        UNION ALL
        SELECT 'qaqc', q.id, q.record_number, q.subject, q.status, q.priority, to_char(q.due_date, 'YYYY-MM-DD'), q.created_at, q.assigned_to, q.record_type
        FROM qaqc_records q WHERE q.company_id = ${companyId} AND q.project_id = ${projectId} AND q.status IN ('open', 'reopened', 'pending_confirmation')
        UNION ALL
        SELECT 'submittal', m.id, m.submittal_number, m.title, m.status, m.priority, to_char(m.due_date AT TIME ZONE ${tz}, 'YYYY-MM-DD'), m.created_at, m.assigned_to, NULL
        FROM submittals m WHERE m.company_id = ${companyId} AND m.project_id = ${projectId} AND m.status IN ('submitted', 'under_review')
        UNION ALL
        SELECT 'inspection', n.id, n.inspection_number, n.title, n.status, NULL, to_char(n.inspection_date AT TIME ZONE ${tz}, 'YYYY-MM-DD'), n.created_at, n.assigned_to, NULL
        FROM qa_inspections n WHERE n.company_id = ${companyId} AND n.project_id = ${projectId} AND n.status IN ('scheduled', 'in_progress')
        LIMIT 2000
      `;

      const drawingRows = await sql`
        SELECT d.id, d.drawing_number AS reference, d.drawing_title AS title, d.current_workflow_status::text AS status, d.updated_at,
               (d.current_workflow_status = 'SUPERSEDED' OR d.current_is_superseded) AS superseded
        FROM site_drawings d
        WHERE d.company_id = ${companyId} AND d.project_id = ${projectId}
          AND (d.current_workflow_status = 'UNDER_REVIEW'
               OR ((d.current_workflow_status = 'SUPERSEDED' OR d.current_is_superseded) AND d.updated_at > NOW() - INTERVAL '14 days'))
        ORDER BY d.updated_at DESC
        LIMIT 100
      `;

      const userIds = [...new Set(open.map((r) => r.assignedTo as string | null).filter((x): x is string => Boolean(x)))];
      const users = userIds.length
        ? await sql`SELECT id, first_name || ' ' || last_name AS name FROM users WHERE company_id = ${companyId} AND id = ANY(${userIds}::uuid[])`
        : [];
      const nameOf = new Map(users.map((u) => [u.id as string, u.name as string]));

      const overdue = open.filter((r) => r.dueDate && dayDiff(today, r.dueDate as string) < 0).length;
      const compliance = drawings.known >= COMPLIANCE_MIN_DRAWINGS ? Math.round((drawings.approved / drawings.known) * 100) : null;

      const attention: AttentionItem[] = [];
      for (const r of open) {
        const cls = classifyAttention({ priority: r.priority as string | null, dueDate: r.dueDate as string | null }, today);
        // Items with no date, no urgency and no critical flag are just the
        // backlog; they're counted in Pending actions, not listed here,
        // except RFIs and QA/QC (outstanding responses matter even undated).
        if (cls === 'pending' && r.type !== 'rfi' && r.type !== 'qaqc' && r.type !== 'inspection' && r.type !== 'submittal') continue;
        attention.push({
          key: `${r.type}:${r.id}`,
          type: r.type as AttentionItem['type'],
          id: r.id as string,
          reference: (r.reference as string | null) ?? null,
          title: r.title as string,
          responsible: r.assignedTo ? nameOf.get(r.assignedTo as string) ?? null : null,
          dueDate: (r.dueDate as string | null) ?? null,
          since: r.since ? new Date(r.since as string).toISOString() : null,
          priority: (r.priority as string | null) ?? null,
          status: r.status as string,
          class: cls,
          label: attentionLabel(r.type as string, cls),
          recordType: (r.recordType as string | null) ?? null,
        });
      }
      for (const d of drawingRows) {
        const superseded = Boolean(d.superseded);
        const cls = superseded ? 'info' : 'pending';
        attention.push({
          key: `drawing:${d.id}`,
          type: 'drawing',
          id: d.id as string,
          reference: (d.reference as string | null) ?? null,
          title: (d.title as string | null) ?? 'Untitled drawing',
          responsible: null,
          dueDate: null,
          since: d.updatedAt ? new Date(d.updatedAt as string).toISOString() : null,
          priority: null,
          status: d.status as string,
          class: cls,
          label: superseded ? 'Recently superseded: check site copies' : 'Awaiting review',
        });
      }
      attention.sort((a, b) =>
        ATTENTION_ORDER[a.class] - ATTENTION_ORDER[b.class]
        || (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999')
        || (a.since ?? '').localeCompare(b.since ?? ''));

      const counts = { critical: 0, overdue: 0, due_soon: 0, pending: 0, info: 0 } as Record<AttentionClass, number>;
      for (const a of attention) counts[a.class] += 1;

      return {
        timezone: tz,
        today,
        project: {
          id: project.id, name: project.name, code: project.code, status: project.status,
          location: [project.location, project.city, project.country].filter(Boolean).join(', ') || null,
          lastUpdatedAt: latest(project.updatedAt as Date | null, project.lastActivityAt as Date | null),
        },
        kpis: {
          totalDrawings: drawings.current,
          drawingsUnderReview: drawings.underReview,
          pendingActions: open.length,
          overdueItems: overdue,
          documentCompliance: compliance,
          complianceBasis: { approved: drawings.approved, known: drawings.known, minimum: COMPLIANCE_MIN_DRAWINGS },
        },
        attention: { counts, total: attention.length, items: attention.slice(0, 200) },
      };
    });
  }
}

function latest(a: Date | null, b: Date | null): string | null {
  const t = Math.max(a ? new Date(a).getTime() : 0, b ? new Date(b).getTime() : 0);
  return t ? new Date(t).toISOString() : null;
}

function attentionLabel(type: string, cls: AttentionClass): string {
  const noun: Record<string, string> = { issue: 'Issue', rfi: 'RFI', snag: 'Snag', qaqc: 'QA/QC record', submittal: 'Submission', inspection: 'Inspection' };
  // Lower-case the noun mid-sentence, but never an acronym (RFI, QA/QC).
  const mid = (t: string) => { const n = noun[t] ?? t; return /^[A-Z]{2}/.test(n) ? n : n.toLowerCase(); };
  if (cls === 'critical') return `Critical ${mid(type)}`;
  if (cls === 'overdue') return `Overdue ${mid(type)}`;
  if (cls === 'due_soon') return type === 'submittal' ? 'Submission deadline soon' : `${noun[type] ?? type} due soon`;
  if (type === 'rfi') return 'Awaiting response';
  if (type === 'qaqc') return 'Outstanding QA/QC';
  if (type === 'inspection') return 'Inspection scheduled';
  if (type === 'submittal') return 'Awaiting review';
  return noun[type] ?? type;
}
