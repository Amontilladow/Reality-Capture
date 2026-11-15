import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import type { TransactionSql } from 'postgres';
import { DatabaseService } from '../../database/database.service';
import { rankItems, localNow, isValidTimeZone, dayDiff, type WorkItem, type Priority } from './priority-rules';
import type { CreateUserTaskDto, UpdateUserTaskDto, SaveItemDto, UpdatePreferencesDto } from './dto/workspace.dto';

// The user's own workspace: personal tasks and reminders, saved items, a
// calendar agenda, today's priorities, and search. Every query is scoped to
// the caller's company (withTenant + RLS) and, for personal data, to the
// caller's own user_id: nobody else can read or change them.
//
// Project records are read in place (never copied). Two access rules carry
// over from the project routes, since these /me routes sit outside the
// /projects/:id guards:
//   * a 'subcontractor' project member sees only RFIs on that project
//     (SubcontractorRfiAccessGuard's rule), and only RFIs they raised or
//     were assigned;
//   * project-wide deadlines (not just the caller's own) are only listed
//     for one project at a time, the one the caller is looking at.

export interface WorkspacePreferences {
  timezone: string | null;
  clockFormat: '12h' | '24h' | 'auto';
  perspective: 'management' | 'engineer' | 'auto';
}

const MANAGEMENT_ROLES = new Set([
  'super_admin', 'company_admin', 'chairman', 'general_manager', 'operations_manager', 'technical_director',
  'engineering_manager', 'project_manager', 'commercial_manager', 'client_representative',
]);

export type AgendaCategory = 'my_tasks' | 'project_deadlines' | 'inspections' | 'reminders';

export interface AgendaItem {
  key: string;
  source: WorkItem['source'];
  id: string;
  category: AgendaCategory;
  title: string;
  reference: string | null;
  date: string;
  time: string | null;
  status: string;
  priority: Priority | null;
  done: boolean;
  mine: boolean;
  projectId: string | null;
  projectName: string | null;
  recordType?: string | null;
}

const ISSUE_OPEN = ['open', 'assigned', 'in_progress', 'waiting_for_information', 'reopened'];
const DONE_STATES: Record<string, string[]> = {
  issue: ['closed', 'void', 'resolved', 'under_review'],
  rfi: ['answered', 'closed', 'void'],
  snag: ['fixed', 'verified', 'void'],
  qaqc: ['closed', 'pending_confirmation'],
  submittal: ['approved', 'approved_as_noted', 'revise_and_resubmit', 'rejected', 'void'],
  inspection: ['passed', 'passed_with_exceptions', 'failed', 'void'],
};

function toPriority(p: unknown): Priority | null {
  return p === 'critical' || p === 'high' || p === 'medium' || p === 'low' ? p : null;
}

@Injectable()
export class WorkspaceService {
  constructor(private readonly db: DatabaseService) {}

  // ── Preferences ──────────────────────────────────────────────────────────

  async getPreferences(companyId: string, userId: string, companyRole?: string) {
    const [row] = await this.db.withTenant(companyId, (sql) => sql`
      SELECT preferences FROM users WHERE id = ${userId} AND company_id = ${companyId}
    `);
    const p = (row?.preferences ?? {}) as Record<string, unknown>;
    const prefs: WorkspacePreferences = {
      timezone: isValidTimeZone(p.timezone) ? p.timezone : null,
      clockFormat: p.clockFormat === '12h' || p.clockFormat === '24h' ? p.clockFormat : 'auto',
      perspective: p.dashboardPerspective === 'management' || p.dashboardPerspective === 'engineer' ? p.dashboardPerspective : 'auto',
    };
    return { ...prefs, defaultPerspective: MANAGEMENT_ROLES.has(companyRole ?? '') ? 'management' : 'engineer' };
  }

  async updatePreferences(companyId: string, userId: string, dto: UpdatePreferencesDto, companyRole?: string) {
    const patch: Record<string, unknown> = {};
    if (dto.timezone !== undefined) {
      if (dto.timezone !== null && !isValidTimeZone(dto.timezone)) throw new BadRequestException('Unknown time zone');
      patch.timezone = dto.timezone;
    }
    if (dto.clockFormat !== undefined) patch.clockFormat = dto.clockFormat;
    if (dto.perspective !== undefined) patch.dashboardPerspective = dto.perspective;
    await this.db.withTenant(companyId, (sql) => sql`
      UPDATE users SET preferences = preferences || ${sql.json(patch as never)}, updated_at = NOW()
      WHERE id = ${userId} AND company_id = ${companyId}
    `);
    return this.getPreferences(companyId, userId, companyRole);
  }

  /** The caller's timezone: their saved preference, else the browser's, else UTC. */
  async resolveTimeZone(companyId: string, userId: string, browserTz?: string): Promise<string> {
    const prefs = await this.getPreferences(companyId, userId);
    if (prefs.timezone) return prefs.timezone;
    if (isValidTimeZone(browserTz)) return browserTz;
    return 'UTC';
  }

  // ── Personal tasks and reminders ─────────────────────────────────────────

  async listTasks(companyId: string, userId: string, q: { status?: string; kind?: string; projectId?: string }) {
    return this.db.withTenant(companyId, (sql) => sql`
      SELECT t.id, t.kind, t.title, t.description, t.notes, to_char(t.due_date, 'YYYY-MM-DD') AS due_date,
             to_char(t.due_time, 'HH24:MI') AS due_time, t.priority, t.status, t.completed_at,
             t.project_id, p.name AS project_name, t.linked_type, t.linked_id, t.created_at, t.updated_at
      FROM user_tasks t
      LEFT JOIN projects p ON p.id = t.project_id
      WHERE t.company_id = ${companyId} AND t.user_id = ${userId}
        AND (${q.status ?? null}::text IS NULL OR t.status = ${q.status ?? null})
        AND (${q.kind ?? null}::text IS NULL OR t.kind = ${q.kind ?? null})
        AND (${q.projectId ?? null}::uuid IS NULL OR t.project_id = ${q.projectId ?? null})
      ORDER BY (t.status = 'done'), t.due_date NULLS LAST, t.due_time NULLS LAST, t.created_at DESC
      LIMIT 500
    `);
  }

  async createTask(companyId: string, userId: string, dto: CreateUserTaskDto) {
    return this.db.withTenant(companyId, async (sql) => {
      if (dto.projectId) await this.assertProjectInCompany(sql, companyId, dto.projectId);
      const status = dto.status ?? 'todo';
      const [row] = await sql`
        INSERT INTO user_tasks (company_id, user_id, project_id, kind, title, description, notes, due_date, due_time,
                                priority, status, completed_at, linked_type, linked_id)
        VALUES (${companyId}, ${userId}, ${dto.projectId ?? null}, ${dto.kind ?? 'task'}, ${dto.title.trim()},
                ${dto.description ?? null}, ${dto.notes ?? null}, ${dto.dueDate ?? null}, ${dto.dueTime ?? null},
                ${dto.priority ?? 'medium'}, ${status}, ${status === 'done' ? sql`NOW()` : null},
                ${dto.linkedType ?? null}, ${dto.linkedId ?? null})
        RETURNING id
      `;
      return this.getTask(sql, companyId, userId, row.id);
    });
  }

  async updateTask(companyId: string, userId: string, id: string, dto: UpdateUserTaskDto) {
    return this.db.withTenant(companyId, async (sql) => {
      await this.getTask(sql, companyId, userId, id); // 404 unless it is the caller's own
      if (dto.projectId) await this.assertProjectInCompany(sql, companyId, dto.projectId);
      // Sent fields only: the validated DTO declares every property, so an
      // omitted one is undefined (keep it), while null clears it.
      const has = (k: keyof UpdateUserTaskDto) => dto[k] !== undefined;
      await sql`
        UPDATE user_tasks SET
          title       = CASE WHEN ${has('title')} THEN ${dto.title?.trim() ?? null} ELSE title END,
          description = CASE WHEN ${has('description')} THEN ${dto.description ?? null} ELSE description END,
          notes       = CASE WHEN ${has('notes')} THEN ${dto.notes ?? null} ELSE notes END,
          kind        = CASE WHEN ${has('kind')} THEN ${dto.kind ?? 'task'} ELSE kind END,
          due_date    = CASE WHEN ${has('dueDate')} THEN ${dto.dueDate ?? null}::date ELSE due_date END,
          due_time    = CASE WHEN ${has('dueTime')} THEN ${dto.dueTime ?? null}::time ELSE due_time END,
          priority    = CASE WHEN ${has('priority')} THEN ${dto.priority ?? 'medium'} ELSE priority END,
          project_id  = CASE WHEN ${has('projectId')} THEN ${dto.projectId ?? null}::uuid ELSE project_id END,
          status      = CASE WHEN ${has('status')} THEN ${dto.status ?? 'todo'} ELSE status END,
          completed_at = CASE WHEN ${has('status')} THEN (CASE WHEN ${dto.status ?? null} = 'done' THEN COALESCE(completed_at, NOW()) ELSE NULL END) ELSE completed_at END,
          updated_at  = NOW()
        WHERE id = ${id} AND company_id = ${companyId} AND user_id = ${userId}
      `;
      return this.getTask(sql, companyId, userId, id);
    });
  }

  async deleteTask(companyId: string, userId: string, id: string) {
    return this.db.withTenant(companyId, async (sql) => {
      const rows = await sql`DELETE FROM user_tasks WHERE id = ${id} AND company_id = ${companyId} AND user_id = ${userId} RETURNING id`;
      if (rows.length === 0) throw new NotFoundException('Task not found');
      await sql`DELETE FROM saved_items WHERE user_id = ${userId} AND item_type = 'task' AND item_id = ${id}`;
      return { id };
    });
  }

  private async getTask(sql: TransactionSql, companyId: string, userId: string, id: string) {
    const [row] = await sql`
      SELECT t.id, t.kind, t.title, t.description, t.notes, to_char(t.due_date, 'YYYY-MM-DD') AS due_date,
             to_char(t.due_time, 'HH24:MI') AS due_time, t.priority, t.status, t.completed_at,
             t.project_id, p.name AS project_name, t.linked_type, t.linked_id, t.created_at, t.updated_at
      FROM user_tasks t LEFT JOIN projects p ON p.id = t.project_id
      WHERE t.id = ${id} AND t.company_id = ${companyId} AND t.user_id = ${userId}
    `;
    if (!row) throw new NotFoundException('Task not found');
    return row;
  }

  private async assertProjectInCompany(sql: TransactionSql, companyId: string, projectId: string) {
    const [p] = await sql`SELECT id FROM projects WHERE id = ${projectId} AND company_id = ${companyId}`;
    if (!p) throw new NotFoundException('Project not found');
  }

  // ── Saved items ──────────────────────────────────────────────────────────

  async listSaved(companyId: string, userId: string) {
    return this.db.withTenant(companyId, (sql) => sql`
      SELECT s.id, s.item_type, s.item_id, s.label, s.note, s.project_id, p.name AS project_name, s.created_at,
             CASE WHEN s.item_type = 'qaqc' THEN (SELECT q.record_type FROM qaqc_records q WHERE q.id = s.item_id) END AS record_type
      FROM saved_items s LEFT JOIN projects p ON p.id = s.project_id
      WHERE s.company_id = ${companyId} AND s.user_id = ${userId}
      ORDER BY s.created_at DESC
      LIMIT 500
    `);
  }

  async saveItem(companyId: string, userId: string, dto: SaveItemDto) {
    return this.db.withTenant(companyId, async (sql) => {
      // Only records the caller can already see may be saved: the record
      // must exist in their company (RLS) and, for a task, be their own.
      const label = await this.recordLabel(sql, companyId, userId, dto.itemType, dto.itemId);
      if (!label) throw new NotFoundException('Item not found');
      const [row] = await sql`
        INSERT INTO saved_items (company_id, user_id, project_id, item_type, item_id, label, note)
        VALUES (${companyId}, ${userId}, ${label.projectId}, ${dto.itemType}, ${dto.itemId}, ${label.label}, ${dto.note ?? null})
        ON CONFLICT (user_id, item_type, item_id) DO UPDATE SET note = COALESCE(EXCLUDED.note, saved_items.note), label = EXCLUDED.label
        RETURNING id, item_type, item_id, label, note, project_id, created_at
      `;
      return row;
    });
  }

  async removeSaved(companyId: string, userId: string, itemType: string, itemId: string) {
    return this.db.withTenant(companyId, async (sql) => {
      await sql`DELETE FROM saved_items WHERE company_id = ${companyId} AND user_id = ${userId} AND item_type = ${itemType} AND item_id = ${itemId}`;
      return { itemType, itemId };
    });
  }

  private async recordLabel(sql: TransactionSql, companyId: string, userId: string, type: string, id: string): Promise<{ label: string; projectId: string | null } | null> {
    const pick = async (q: Promise<readonly Record<string, unknown>[]>) => {
      const [r] = await q;
      return r ? { label: String(r.label), projectId: (r.projectId as string | null) ?? null } : null;
    };
    switch (type) {
      case 'issue': return pick(sql`SELECT project_id, concat_ws(' · ', issue_number, title) AS label FROM issues WHERE id = ${id} AND company_id = ${companyId}`);
      case 'rfi': return pick(sql`SELECT project_id, concat_ws(' · ', rfi_number, subject) AS label FROM rfis WHERE id = ${id} AND company_id = ${companyId}`);
      case 'snag': return pick(sql`SELECT project_id, concat_ws(' · ', snag_number, title) AS label FROM snag_items WHERE id = ${id} AND company_id = ${companyId}`);
      case 'qaqc': return pick(sql`SELECT project_id, concat_ws(' · ', record_number, subject) AS label FROM qaqc_records WHERE id = ${id} AND company_id = ${companyId}`);
      case 'submittal': return pick(sql`SELECT project_id, concat_ws(' · ', submittal_number, title) AS label FROM submittals WHERE id = ${id} AND company_id = ${companyId}`);
      case 'inspection': return pick(sql`SELECT project_id, concat_ws(' · ', inspection_number, title) AS label FROM qa_inspections WHERE id = ${id} AND company_id = ${companyId}`);
      case 'drawing': return pick(sql`SELECT project_id, concat_ws(' · ', drawing_number, drawing_title) AS label FROM site_drawings WHERE id = ${id} AND company_id = ${companyId}`);
      case 'task': return pick(sql`SELECT project_id, title AS label FROM user_tasks WHERE id = ${id} AND company_id = ${companyId} AND user_id = ${userId}`);
      default: return null;
    }
  }

  // ── Work assigned to or waiting on the caller ────────────────────────────

  private async subcontractorProjects(sql: TransactionSql, userId: string): Promise<string[]> {
    const rows = await sql`SELECT project_id FROM project_members WHERE user_id = ${userId} AND role = 'subcontractor'`;
    return rows.map((r) => r.projectId as string);
  }

  /** Every open item that is the caller's to act on, with dates in their timezone. */
  async myOpenWork(companyId: string, userId: string, tz: string, projectId?: string): Promise<WorkItem[]> {
    return this.db.withTenant(companyId, async (sql) => {
      const sub = await this.subcontractorProjects(sql, userId);
      const pid = projectId ?? null;
      const rows = await sql`
        SELECT * FROM (
          SELECT 'issue' AS source, i.id, i.project_id, i.issue_number AS reference, i.title, i.status::text AS status, i.priority::text AS priority,
                 to_char(i.deadline AT TIME ZONE ${tz}, 'YYYY-MM-DD') AS due_date, to_char(i.deadline AT TIME ZONE ${tz}, 'HH24:MI') AS due_time,
                 'assigned' AS relation, NULL AS record_type
          FROM issues i WHERE i.company_id = ${companyId} AND i.assigned_to = ${userId} AND i.status::text = ANY(${ISSUE_OPEN})
          UNION ALL
          SELECT 'issue', i.id, i.project_id, i.issue_number, i.title, i.status::text, i.priority::text,
                 to_char(i.deadline AT TIME ZONE ${tz}, 'YYYY-MM-DD'), to_char(i.deadline AT TIME ZONE ${tz}, 'HH24:MI'), 'awaiting_review', NULL
          FROM issues i WHERE i.company_id = ${companyId} AND i.created_by = ${userId} AND i.status::text IN ('resolved', 'under_review')
            AND (i.assigned_to IS NULL OR i.assigned_to <> ${userId})
          UNION ALL
          SELECT 'rfi', r.id, r.project_id, r.rfi_number, r.subject, r.status, r.priority,
                 to_char(r.due_date AT TIME ZONE ${tz}, 'YYYY-MM-DD'), to_char(r.due_date AT TIME ZONE ${tz}, 'HH24:MI'), 'awaiting_response', NULL
          FROM rfis r WHERE r.company_id = ${companyId} AND r.assigned_to = ${userId} AND r.status = 'open'
          UNION ALL
          SELECT 'snag', s.id, s.project_id, s.snag_number, s.title, s.status, s.priority,
                 to_char(s.due_date AT TIME ZONE ${tz}, 'YYYY-MM-DD'), to_char(s.due_date AT TIME ZONE ${tz}, 'HH24:MI'), 'assigned', NULL
          FROM snag_items s WHERE s.company_id = ${companyId} AND s.assigned_to = ${userId} AND s.status = 'open'
          UNION ALL
          SELECT 'snag', s.id, s.project_id, s.snag_number, s.title, s.status, s.priority,
                 to_char(s.due_date AT TIME ZONE ${tz}, 'YYYY-MM-DD'), NULL, 'awaiting_review', NULL
          FROM snag_items s WHERE s.company_id = ${companyId} AND s.created_by = ${userId} AND s.status = 'fixed'
          UNION ALL
          SELECT 'qaqc', q.id, q.project_id, q.record_number, q.subject, q.status, q.priority,
                 to_char(q.due_date, 'YYYY-MM-DD'), NULL, 'assigned', q.record_type
          FROM qaqc_records q WHERE q.company_id = ${companyId} AND q.assigned_to = ${userId} AND q.status IN ('open', 'reopened')
          UNION ALL
          SELECT 'qaqc', q.id, q.project_id, q.record_number, q.subject, q.status, q.priority,
                 to_char(q.due_date, 'YYYY-MM-DD'), NULL, 'awaiting_review', q.record_type
          FROM qaqc_records q WHERE q.company_id = ${companyId} AND q.issued_by = ${userId} AND q.status = 'pending_confirmation'
          UNION ALL
          SELECT 'submittal', m.id, m.project_id, m.submittal_number, m.title, m.status, m.priority,
                 to_char(m.due_date AT TIME ZONE ${tz}, 'YYYY-MM-DD'), to_char(m.due_date AT TIME ZONE ${tz}, 'HH24:MI'), 'awaiting_review', NULL
          FROM submittals m WHERE m.company_id = ${companyId} AND m.assigned_to = ${userId} AND m.status IN ('submitted', 'under_review')
          UNION ALL
          SELECT 'inspection', n.id, n.project_id, n.inspection_number, n.title, n.status, NULL,
                 to_char(n.inspection_date AT TIME ZONE ${tz}, 'YYYY-MM-DD'), to_char(n.inspection_date AT TIME ZONE ${tz}, 'HH24:MI'), 'assigned', NULL
          FROM qa_inspections n WHERE n.company_id = ${companyId} AND n.assigned_to = ${userId} AND n.status IN ('scheduled', 'in_progress')
        ) w
        WHERE (${pid}::uuid IS NULL OR w.project_id = ${pid})
          AND (w.source = 'rfi' OR NOT (w.project_id = ANY(${sub}::uuid[])))
        LIMIT 1000
      `;
      const tasks = await sql`
        SELECT t.id, t.kind, t.project_id, t.title, t.status, t.priority, to_char(t.due_date, 'YYYY-MM-DD') AS due_date,
               to_char(t.due_time, 'HH24:MI') AS due_time
        FROM user_tasks t
        WHERE t.company_id = ${companyId} AND t.user_id = ${userId} AND t.status <> 'done'
          AND (${pid}::uuid IS NULL OR t.project_id = ${pid} OR t.project_id IS NULL)
        LIMIT 500
      `;
      const names = await this.projectNames(sql, companyId, [...rows, ...tasks].map((r) => r.projectId as string | null));
      const items: WorkItem[] = rows.map((r) => ({
        source: r.source as WorkItem['source'],
        id: r.id as string,
        projectId: r.projectId as string,
        projectName: names.get(r.projectId as string) ?? null,
        reference: (r.reference as string | null) ?? null,
        title: r.title as string,
        status: r.status as string,
        priority: toPriority(r.priority),
        dueDate: (r.dueDate as string | null) ?? null,
        // Midnight on a date-only field means "no time given".
        dueTime: r.dueTime && r.dueTime !== '00:00' ? (r.dueTime as string) : null,
        relation: r.relation as WorkItem['relation'],
        recordType: (r.recordType as string | null) ?? null,
      }));
      for (const t of tasks) {
        items.push({
          source: t.kind === 'reminder' ? 'reminder' : 'task',
          id: t.id as string,
          projectId: (t.projectId as string | null) ?? null,
          projectName: t.projectId ? names.get(t.projectId as string) ?? null : null,
          reference: null,
          title: t.title as string,
          status: t.status as string,
          priority: toPriority(t.priority),
          dueDate: (t.dueDate as string | null) ?? null,
          dueTime: (t.dueTime as string | null) ?? null,
          relation: 'own',
        });
      }
      return items;
    });
  }

  private async projectNames(sql: TransactionSql, companyId: string, ids: (string | null)[]) {
    const unique = [...new Set(ids.filter((x): x is string => Boolean(x)))];
    if (unique.length === 0) return new Map<string, string>();
    const rows = await sql`SELECT id, name FROM projects WHERE company_id = ${companyId} AND id = ANY(${unique}::uuid[])`;
    return new Map(rows.map((r) => [r.id as string, r.name as string]));
  }

  async priorities(companyId: string, userId: string, browserTz?: string, projectId?: string, limit = 7, now = new Date()) {
    const tz = await this.resolveTimeZone(companyId, userId, browserTz);
    const { today, time } = localNow(tz, now);
    const ranked = rankItems(await this.myOpenWork(companyId, userId, tz, projectId), today, time);
    return {
      timezone: tz,
      today,
      generatedAt: now.toISOString(),
      total: ranked.length,
      counts: {
        overdue: ranked.filter((r) => r.dueState === 'overdue').length,
        dueToday: ranked.filter((r) => r.dueState === 'today').length,
      },
      items: ranked.slice(0, limit),
    };
  }

  /** "My workspace": the caller's open work, grouped. */
  async workspace(companyId: string, userId: string, browserTz?: string, projectId?: string, now = new Date()) {
    const tz = await this.resolveTimeZone(companyId, userId, browserTz);
    const { today, time } = localNow(tz, now);
    const ranked = rankItems(await this.myOpenWork(companyId, userId, tz, projectId), today, time);
    const recent = await this.db.withTenant(companyId, (sql) => sql`
      SELECT 'issue' AS source, i.id, i.project_id, i.issue_number AS reference, i.title, i.updated_at AS at
      FROM issues i WHERE i.company_id = ${companyId} AND i.assigned_to = ${userId} AND i.status::text = ANY(${ISSUE_OPEN})
        AND (${projectId ?? null}::uuid IS NULL OR i.project_id = ${projectId ?? null})
        AND i.updated_at > NOW() - INTERVAL '7 days'
      ORDER BY i.updated_at DESC LIMIT 5
    `);
    const pick = (f: (r: (typeof ranked)[number]) => boolean) => ranked.filter(f);
    return {
      timezone: tz,
      today,
      assigned: pick((r) => r.relation === 'assigned'),
      awaitingReview: pick((r) => r.relation === 'awaiting_review'),
      awaitingResponse: pick((r) => r.relation === 'awaiting_response'),
      dueToday: pick((r) => r.dueState === 'today'),
      overdue: pick((r) => r.dueState === 'overdue'),
      ownTasks: pick((r) => r.relation === 'own'),
      recentlyAssigned: recent,
    };
  }

  // ── Calendar ─────────────────────────────────────────────────────────────

  async agenda(companyId: string, userId: string, q: { from: string; to: string; projectId?: string; tz?: string }) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(q.from) || !/^\d{4}-\d{2}-\d{2}$/.test(q.to)) throw new BadRequestException('from and to must be YYYY-MM-DD');
    const span = dayDiff(q.from, q.to);
    if (span < 0 || span > 62) throw new BadRequestException('The range must be 0 to 62 days');
    const tz = await this.resolveTimeZone(companyId, userId, q.tz);
    const pid = q.projectId ?? null;
    return this.db.withTenant(companyId, async (sql) => {
      const sub = await this.subcontractorProjects(sql, userId);
      // The caller's own items across projects, plus (for the one project in
      // view) everyone's deadlines on it. A record's own dates are the only
      // source; nothing is copied into a calendar table.
      const rows = await sql`
        SELECT a.*, to_char(a.local_at, 'YYYY-MM-DD') AS local_date, to_char(a.local_at, 'HH24:MI') AS local_time FROM (
          SELECT 'issue' AS source, i.id, i.project_id, i.issue_number AS reference, i.title, i.status::text AS status, i.priority::text AS priority,
                 (i.deadline AT TIME ZONE ${tz}) AS local_at, i.assigned_to = ${userId} AS mine, NULL AS record_type
          FROM issues i WHERE i.company_id = ${companyId} AND i.deadline IS NOT NULL AND i.status::text <> 'void'
            AND (i.assigned_to = ${userId} OR i.project_id = ${pid})
          UNION ALL
          SELECT 'rfi', r.id, r.project_id, r.rfi_number, r.subject, r.status, r.priority, (r.due_date AT TIME ZONE ${tz}), r.assigned_to = ${userId}, NULL
          FROM rfis r WHERE r.company_id = ${companyId} AND r.due_date IS NOT NULL AND r.status <> 'void'
            AND (r.assigned_to = ${userId} OR r.created_by = ${userId} OR (r.project_id = ${pid} AND NOT (r.project_id = ANY(${sub}::uuid[]))))
          UNION ALL
          SELECT 'snag', s.id, s.project_id, s.snag_number, s.title, s.status, s.priority, (s.due_date AT TIME ZONE ${tz}), s.assigned_to = ${userId}, NULL
          FROM snag_items s WHERE s.company_id = ${companyId} AND s.due_date IS NOT NULL AND s.status <> 'void'
            AND (s.assigned_to = ${userId} OR s.project_id = ${pid})
          UNION ALL
          SELECT 'qaqc', q.id, q.project_id, q.record_number, q.subject, q.status, q.priority, q.due_date::timestamp, q.assigned_to = ${userId}, q.record_type
          FROM qaqc_records q WHERE q.company_id = ${companyId} AND q.due_date IS NOT NULL
            AND (q.assigned_to = ${userId} OR q.project_id = ${pid})
          UNION ALL
          SELECT 'submittal', m.id, m.project_id, m.submittal_number, m.title, m.status, m.priority, (m.due_date AT TIME ZONE ${tz}), m.assigned_to = ${userId}, NULL
          FROM submittals m WHERE m.company_id = ${companyId} AND m.due_date IS NOT NULL AND m.status <> 'void'
            AND (m.assigned_to = ${userId} OR m.project_id = ${pid})
          UNION ALL
          SELECT 'inspection', n.id, n.project_id, n.inspection_number, n.title, n.status, NULL, (n.inspection_date AT TIME ZONE ${tz}), n.assigned_to = ${userId}, NULL
          FROM qa_inspections n WHERE n.company_id = ${companyId} AND n.inspection_date IS NOT NULL AND n.status <> 'void'
            AND (n.assigned_to = ${userId} OR n.project_id = ${pid})
        ) a
        WHERE a.local_at >= ${q.from}::date AND a.local_at < (${q.to}::date + 1)
          AND (a.source = 'rfi' OR NOT (a.project_id = ANY(${sub}::uuid[])))
        ORDER BY a.local_at
        LIMIT 1000
      `;
      const tasks = await sql`
        SELECT t.id, t.kind, t.project_id, t.title, t.status, t.priority, to_char(t.due_date, 'YYYY-MM-DD') AS due_date, to_char(t.due_time, 'HH24:MI') AS due_time
        FROM user_tasks t
        WHERE t.company_id = ${companyId} AND t.user_id = ${userId} AND t.due_date BETWEEN ${q.from}::date AND ${q.to}::date
        ORDER BY t.due_date, t.due_time NULLS LAST
        LIMIT 500
      `;
      const names = await this.projectNames(sql, companyId, [...rows, ...tasks].map((r) => r.projectId as string | null));
      const items: AgendaItem[] = [];
      for (const r of rows) {
        // Formatted in SQL, already in the user's zone.
        const date = r.localDate as string;
        const hhmm = r.localTime as string;
        const source = r.source as AgendaItem['source'];
        const done = (DONE_STATES[source] ?? []).includes(r.status as string);
        items.push({
          key: `${source}:${r.id}`,
          source,
          id: r.id as string,
          category: source === 'inspection' ? 'inspections' : r.mine ? 'my_tasks' : 'project_deadlines',
          title: r.title as string,
          reference: (r.reference as string | null) ?? null,
          date,
          time: hhmm === '00:00' ? null : hhmm,
          status: r.status as string,
          priority: toPriority(r.priority),
          done,
          mine: Boolean(r.mine),
          projectId: r.projectId as string,
          projectName: names.get(r.projectId as string) ?? null,
          recordType: (r.recordType as string | null) ?? null,
        });
      }
      for (const t of tasks) {
        items.push({
          key: `task:${t.id}`,
          source: t.kind === 'reminder' ? 'reminder' : 'task',
          id: t.id as string,
          category: t.kind === 'reminder' ? 'reminders' : 'my_tasks',
          title: t.title as string,
          reference: null,
          date: t.dueDate as string,
          time: (t.dueTime as string | null) ?? null,
          status: t.status as string,
          priority: toPriority(t.priority),
          done: t.status === 'done',
          mine: true,
          projectId: (t.projectId as string | null) ?? null,
          projectName: t.projectId ? names.get(t.projectId as string) ?? null : null,
        });
      }
      items.sort((a, b) => a.date.localeCompare(b.date) || (a.time ?? '99').localeCompare(b.time ?? '99'));
      // No meeting records exist anywhere in the system yet, so the
      // calendar says so instead of inventing any.
      return { timezone: tz, from: q.from, to: q.to, meetingsAvailable: false, items };
    });
  }

  // ── Search ───────────────────────────────────────────────────────────────

  async search(companyId: string, userId: string, query: string) {
    const q = query.trim();
    if (q.length < 2) return { query: q, results: [] };
    const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    return this.db.withTenant(companyId, async (sql) => {
      const sub = await this.subcontractorProjects(sql, userId);
      const rows = await sql`
        (SELECT 'project' AS type, p.id, p.id AS project_id, p.code AS reference, p.name AS title, p.status AS status, NULL AS record_type
          FROM projects p WHERE p.company_id = ${companyId} AND p.status <> 'archived' AND (p.name ILIKE ${like} OR p.code ILIKE ${like}) LIMIT 5)
        UNION ALL
        (SELECT 'issue', i.id, i.project_id, i.issue_number, i.title, i.status::text, NULL
          FROM issues i WHERE i.company_id = ${companyId} AND NOT (i.project_id = ANY(${sub}::uuid[])) AND (i.title ILIKE ${like} OR i.issue_number ILIKE ${like})
          ORDER BY i.updated_at DESC LIMIT 6)
        UNION ALL
        (SELECT 'rfi', r.id, r.project_id, r.rfi_number, r.subject, r.status, NULL
          FROM rfis r WHERE r.company_id = ${companyId}
            AND (NOT (r.project_id = ANY(${sub}::uuid[])) OR r.created_by = ${userId} OR r.assigned_to = ${userId})
            AND (r.subject ILIKE ${like} OR r.rfi_number ILIKE ${like})
          ORDER BY r.updated_at DESC LIMIT 6)
        UNION ALL
        (SELECT 'snag', s.id, s.project_id, s.snag_number, s.title, s.status, NULL
          FROM snag_items s WHERE s.company_id = ${companyId} AND NOT (s.project_id = ANY(${sub}::uuid[])) AND (s.title ILIKE ${like} OR s.snag_number ILIKE ${like})
          ORDER BY s.updated_at DESC LIMIT 6)
        UNION ALL
        (SELECT 'qaqc', q.id, q.project_id, q.record_number, q.subject, q.status, q.record_type
          FROM qaqc_records q WHERE q.company_id = ${companyId} AND NOT (q.project_id = ANY(${sub}::uuid[])) AND (q.subject ILIKE ${like} OR q.record_number ILIKE ${like})
          ORDER BY q.updated_at DESC LIMIT 6)
        UNION ALL
        (SELECT 'drawing', d.id, d.project_id, d.drawing_number, d.drawing_title, d.current_workflow_status::text, NULL
          FROM site_drawings d WHERE d.company_id = ${companyId} AND NOT (d.project_id = ANY(${sub}::uuid[])) AND (d.drawing_title ILIKE ${like} OR d.drawing_number ILIKE ${like})
          ORDER BY d.updated_at DESC LIMIT 6)
        UNION ALL
        (SELECT 'user', u.id, NULL, u.email, u.first_name || ' ' || u.last_name, NULL, NULL
          FROM users u WHERE u.company_id = ${companyId} AND u.is_active
            AND (u.first_name || ' ' || u.last_name ILIKE ${like} OR u.email ILIKE ${like}) LIMIT 5)
        UNION ALL
        (SELECT 'task', t.id, t.project_id, NULL, t.title, t.status, NULL
          FROM user_tasks t WHERE t.company_id = ${companyId} AND t.user_id = ${userId} AND t.title ILIKE ${like}
          ORDER BY t.updated_at DESC LIMIT 5)
        UNION ALL
        (SELECT 'saved', s.item_id, s.project_id, s.item_type, s.label, NULL, s.item_type
          FROM saved_items s WHERE s.company_id = ${companyId} AND s.user_id = ${userId} AND s.label ILIKE ${like} LIMIT 5)
      `;
      const names = await this.projectNames(sql, companyId, rows.map((r) => r.projectId as string | null));
      return { query: q, results: rows.map((r) => ({ ...r, projectName: r.projectId ? names.get(r.projectId as string) ?? null : null })) };
    });
  }
}
