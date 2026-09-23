import { Injectable, NotFoundException, ForbiddenException, BadRequestException, Logger } from '@nestjs/common';
import { PDFDocument, PDFFont, StandardFonts, rgb, PageSizes } from 'pdf-lib';
import JSZip from 'jszip';
import sharp from 'sharp';
import { DatabaseService } from '../../database/database.service';
import { AiClientService } from '../ai-client/ai-client.service';
import { NotificationsService } from '../notifications/notifications.service';
import { StorageService } from '../storage/storage.service';
import { renderIssuePdf } from './issue-pdf.template';
import { buildIssueWorkbookBuffer, type IssueXlsData } from './issue-xls';
import type { CreateIssueDto } from './dto/create-issue.dto';
import type { UpdateIssueDto } from './dto/update-issue.dto';
import type { AddActivityDto } from './dto/add-activity.dto';
import type { ForwardIssueDto } from './dto/forward-issue.dto';
import type { ForceStatusDto } from './dto/force-status.dto';
import type { BulkCloseIssuesDto } from './dto/bulk-close-issues.dto';
import type { BroadcastReminderDto } from './dto/broadcast-reminder.dto';
import type { UserReminderDto } from './dto/user-reminder.dto';
import type { WarnUserDto } from './dto/warn-user.dto';
import type { ScheduleIssueReminderDto } from './dto/schedule-issue-reminder.dto';
import type { IssueAttachmentUploadUrlDto } from './dto/issue-attachment-upload-url.dto';
import type { AddIssueAttachmentDto } from './dto/add-issue-attachment.dto';
import { ATTACHMENT_MAX_SIZE as ISSUE_ATTACHMENT_MAX_SIZE, ATTACHMENT_ALLOWED_EXTENSIONS as ISSUE_ATTACHMENT_ALLOWED_EXTENSIONS } from '../../common/constants/attachment-limits';
import type { PaginationQuery } from '@engineeringos/types';

// No shared label maps for these exist in @engineeringos/types (unlike RFI's
// RFI_DISCIPLINE_LABELS) -- apps/web/src/lib/issue-constants.ts defines its
// own copies locally and the API can't import a frontend-only file, so these
// are duplicated here, display-only, for the PDF/XLS export's benefit alone.
const ISSUE_DISCIPLINE_LABELS: Record<string, string> = {
  MEP: 'MEP', ARC: 'Architectural', STR: 'Structural', CIV: 'Civil',
  ELE: 'Electrical', INFRA: 'Infrastructure', LANDSCAPE: 'Landscape', OTHER: 'Other',
};
const ISSUE_CATEGORY_LABELS: Record<string, string> = {
  design_issue: 'Design Issue', bim_modeling_issue: 'BIM Modeling Issue', coordination_issue: 'Coordination Issue',
  clash_detection: 'Clash Detection', constructability_issue: 'Constructability Issue', shop_drawing_issue: 'Shop Drawing Issue',
  site_issue: 'Site Issue', rfi: 'RFI', client_comment: 'Client Comment', consultant_comment: 'Consultant Comment', other: 'Other',
};
const ISSUE_TYPE_LABELS: Record<string, string> = {
  defect: 'Defect', punch_item: 'Punch Item', rfi: 'RFI', coordination_clash: 'Coordination Clash',
  safety_observation: 'Safety Observation', quality_hold: 'Quality Hold', inspection_point: 'Inspection Point', general: 'General',
};

@Injectable()
export class IssuesService {
  private readonly logger = new Logger(IssuesService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly aiClient: AiClientService,
    private readonly notifications: NotificationsService,
    private readonly storage: StorageService,
  ) {}

  // ── Generate issue number ─────────────────────────────────────────────────
  // Sequential per (project, discipline): {projectCode}-{disciplineCode}-{0001}.
  // Previously keyed off issue type ({projectCode}-{typeCode}-{0001}); this
  // ticket (2a) moves numbering to discipline to match the reference
  // issue-tracker's scheme. Existing rows' issue_number values are left
  // untouched -- this only affects newly created issues.
  // withTenant required -- projects and issues both carry the tenant_isolation RLS policy.
  // A plain this.db.query() never sets app.current_company_id, so under any DB role that
  // isn't the table owner/a superuser both SELECTs see no rows: the project-code lookup
  // silently falls back to the generic 'PRJ' prefix, and the sequence count is always 0.
  private async generateIssueNumber(companyId: string, projectId: string, discipline: string): Promise<string> {
    return this.db.withTenant(companyId, async (sql) => {
      const [proj] = await sql`SELECT code FROM projects WHERE id = ${projectId} AND company_id = ${companyId}`;
      const prefix = (proj?.code as string ?? 'PRJ').toUpperCase();
      // The issue_discipline_enum values (MEP, ARC, STR, CIV, ELE, INFRA,
      // LANDSCAPE, OTHER) are already short codes -- used directly, no
      // separate code-lookup table needed.
      const disciplineCode = discipline.toUpperCase();
      const [cnt] = await sql`
        SELECT COUNT(*) AS n FROM issues WHERE project_id = ${projectId} AND discipline = ${discipline} AND company_id = ${companyId}`;
      const seq = String(Number(cnt.n) + 1).padStart(4, '0');
      return `${prefix}-${disciplineCode}-${seq}`;
    });
  }

  // ── Create ────────────────────────────────────────────────────────────────
  async create(companyId: string, projectId: string, userId: string, dto: CreateIssueDto) {
    const issueNumber = await this.generateIssueNumber(companyId, projectId, dto.discipline);

    // withTenant required -- issues carries the tenant_isolation RLS policy. A plain
    // this.db.query() never sets app.current_company_id, so under any DB role that isn't
    // the table owner/a superuser the implicit WITH CHECK rejects this insert outright.
    const [issue] = await this.db.withTenant(companyId, sql => sql`
      INSERT INTO issues (
        company_id, project_id, building_id, level_id, location_id, element_id,
        issue_type, issue_number, title, description, priority, discipline, category, trade,
        specification_ref, status, assigned_to, responsible_company, deadline,
        capture_id, drawing_id, pos_x_norm, pos_y_norm, hotspot_yaw, hotspot_pitch,
        tags, created_by, model_id, camera_pos_x, camera_pos_y, camera_pos_z,
        camera_target_x, camera_target_y, camera_target_z, screenshot_storage_key
      ) VALUES (
        ${companyId}, ${projectId}, ${dto.buildingId ?? null}, ${dto.levelId ?? null},
        ${dto.locationId ?? null}, ${dto.elementId ?? null},
        ${dto.issueType}, ${issueNumber}, ${dto.title}, ${dto.description ?? null},
        ${dto.priority ?? 'medium'}, ${dto.discipline}, ${dto.category ?? null}, ${dto.trade ?? null},
        ${dto.specificationRef ?? null}, 'open',
        ${dto.assignedTo ?? null}, ${dto.responsibleCompany ?? null},
        ${dto.deadline},
        ${dto.captureId ?? null}, ${dto.drawingId ?? null},
        ${dto.posXNorm ?? null}, ${dto.posYNorm ?? null},
        ${dto.hotspotYaw ?? null}, ${dto.hotspotPitch ?? null},
        ${dto.tags ? JSON.stringify(dto.tags) : '{}'}, ${userId},
        ${dto.modelId ?? null}, ${dto.cameraPosX ?? null}, ${dto.cameraPosY ?? null}, ${dto.cameraPosZ ?? null},
        ${dto.cameraTargetX ?? null}, ${dto.cameraTargetY ?? null}, ${dto.cameraTargetZ ?? null},
        ${dto.screenshotStorageKey ?? null}
      )
      RETURNING *`);

    // Log creation activity
    await this.addActivity(companyId, issue.id as string, userId, {
      activityType: 'comment',
      content: `Issue created: ${issueNumber}`,
    });

    // Notify assignee if set
    if (dto.assignedTo && dto.assignedTo !== userId) {
      await this.notifications.create(companyId, {
        userId: dto.assignedTo,
        type: 'issue_assigned',
        title: `You were assigned to issue ${issueNumber}: ${dto.title}`,
        resourceType: 'issue',
        resourceId: issue.id as string,
        projectId,
        createdBy: userId,
      });
    }

    // Make the issue searchable via AI search/assistant. Fire-and-forget —
    // never blocks or fails the create response if the AI service is down.
    this.aiClient.ingestIssue({
      id: issue.id as string,
      companyId,
      projectId,
      title: issue.title as string,
      issueNumber: (issue.issueNumber as string | null) ?? issueNumber,
      description: issue.description as string | null,
      issueType: issue.issueType as string,
      priority: issue.priority as string | null,
      status: issue.status as string,
      discipline: issue.discipline as string | null,
    });

    return issue;
  }

  // ── List ──────────────────────────────────────────────────────────────────
  async findAll(companyId: string, projectId: string, query: PaginationQuery & {
    status?: string; priority?: string; issueType?: string;
    assignedTo?: string; locationId?: string; elementId?: string;
    discipline?: string; dateFrom?: string; dateTo?: string;
    overdue?: boolean; myIssues?: boolean; userId?: string;
  }) {
    const page    = query.page ?? 1;
    const perPage = Math.min(query.perPage ?? 20, 100);
    const offset  = (page - 1) * perPage;

    const rows = await this.db.withTenant(companyId, sql => sql`
      SELECT
        i.*,
        u_creator.first_name || ' ' || u_creator.last_name AS created_by_name,
        u_assignee.first_name || ' ' || u_assignee.last_name AS assigned_to_name,
        u_assignee.avatar_url AS assigned_to_avatar,
        loc.name AS location_name,
        bld.name AS building_name,
        lvl.name AS level_name,
        COUNT(*) OVER() AS full_count
      FROM issues i
      LEFT JOIN users u_creator  ON u_creator.id  = i.created_by
      LEFT JOIN users u_assignee ON u_assignee.id = i.assigned_to
      LEFT JOIN locations loc ON loc.id = i.location_id
      LEFT JOIN buildings bld ON bld.id = i.building_id
      LEFT JOIN levels lvl    ON lvl.id = i.level_id
      WHERE i.project_id  = ${projectId}
        AND i.company_id  = ${companyId}
        AND (${query.status ?? null}::text IS NULL OR i.status = ${query.status ?? null})
        AND (${query.priority ?? null}::text IS NULL OR i.priority = ${query.priority ?? null})
        AND (${query.issueType ?? null}::text IS NULL OR i.issue_type = ${query.issueType ?? null})
        AND (${query.discipline ?? null}::text IS NULL OR i.discipline = ${query.discipline ?? null})
        AND (${query.assignedTo ?? null}::uuid IS NULL OR i.assigned_to = ${query.assignedTo ?? null}::uuid)
        AND (${query.locationId ?? null}::uuid IS NULL OR i.location_id = ${query.locationId ?? null}::uuid)
        AND (${query.elementId ?? null}::uuid IS NULL OR i.element_id = ${query.elementId ?? null}::uuid)
        AND (${query.dateFrom ?? null}::timestamptz IS NULL OR i.created_at >= ${query.dateFrom ?? null}::timestamptz)
        AND (${query.dateTo ?? null}::timestamptz IS NULL OR i.created_at <= ${query.dateTo ?? null}::timestamptz)
        AND (NOT ${query.overdue ?? false} OR (i.deadline < NOW() AND i.status NOT IN ('closed','void')))
        AND (NOT ${query.myIssues ?? false} OR i.assigned_to = ${query.userId ?? null}::uuid)
        AND (${query.search ?? null}::text IS NULL OR
          to_tsvector('english', i.title || ' ' || coalesce(i.description,''))
          @@ plainto_tsquery('english', ${query.search ?? null}))
      ORDER BY
        CASE i.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
        i.created_at DESC
      LIMIT ${perPage} OFFSET ${offset}
    `);

    return this.db.paginate(rows, page, perPage);
  }

  // ── Find one ──────────────────────────────────────────────────────────────
  async findOne(companyId: string, projectId: string, issueId: string) {
    const [issue] = await this.db.withTenant(companyId, sql => sql`
      SELECT i.*,
        u_c.first_name || ' ' || u_c.last_name AS created_by_name,
        u_a.first_name || ' ' || u_a.last_name AS assigned_to_name,
        u_a.avatar_url AS assigned_to_avatar,
        loc.name AS location_name, bld.name AS building_name, lvl.name AS level_name,
        be.ifc_type AS element_type, be.ifc_name AS element_name,
        be.ifc_guid AS element_guid, be.model_id AS element_model_id
      FROM issues i
      LEFT JOIN users u_c ON u_c.id = i.created_by
      LEFT JOIN users u_a ON u_a.id = i.assigned_to
      LEFT JOIN locations loc ON loc.id = i.location_id
      LEFT JOIN buildings bld ON bld.id = i.building_id
      LEFT JOIN levels lvl    ON lvl.id = i.level_id
      LEFT JOIN bim_elements be ON be.id = i.element_id
      WHERE i.id = ${issueId} AND i.project_id = ${projectId} AND i.company_id = ${companyId}
    `);
    if (!issue) throw new NotFoundException(`Issue ${issueId} not found.`);
    if (issue.screenshotStorageKey) {
      return { ...issue, screenshotUrl: await this.storage.getReadUrl(issue.screenshotStorageKey as string) };
    }
    return issue;
  }

  // ── View-state screenshot upload ────────────────────────────────────────
  // Mirrors bim.service.ts's getModelUploadUrl -- a lightweight presigned
  // PUT URL, no DB row of its own. The resulting storageKey is passed
  // straight into create()'s screenshotStorageKey.
  async getScreenshotUploadUrl(companyId: string, projectId: string) {
    const key = this.storage.generateKey(companyId, projectId, 'issues', `${Date.now()}.png`);
    const url = await this.storage.getUploadUrl(key, 'image/png', 5 * 1024 * 1024);
    return { ...url, storageKey: key };
  }

  // ── Update ────────────────────────────────────────────────────────────────
  // Can no longer transition status to 'closed' -- UpdateIssueDto rejects
  // that value entirely; closing only happens through close() below, which
  // enforces the creator-only rule this generic endpoint has no way to.
  async update(companyId: string, projectId: string, issueId: string, userId: string, dto: UpdateIssueDto) {
    const existing = await this.findOne(companyId, projectId, issueId);

    // withTenant required -- see generateIssueNumber() above.
    const [updated] = await this.db.withTenant(companyId, sql => sql`
      UPDATE issues SET
        title               = COALESCE(${dto.title ?? null}, title),
        description         = COALESCE(${dto.description ?? null}, description),
        priority            = COALESCE(${dto.priority ?? null}, priority),
        status              = COALESCE(${dto.status ?? null}, status),
        discipline          = COALESCE(${dto.discipline ?? null}, discipline),
        category            = COALESCE(${dto.category ?? null}, category),
        trade               = COALESCE(${dto.trade ?? null}, trade),
        building_id         = COALESCE(${dto.buildingId ?? null}::uuid, building_id),
        level_id            = COALESCE(${dto.levelId ?? null}::uuid, level_id),
        location_id         = COALESCE(${dto.locationId ?? null}::uuid, location_id),
        element_id          = CASE WHEN ${dto.elementId !== undefined} THEN ${dto.elementId ?? null}::uuid ELSE element_id END,
        assigned_to         = COALESCE(${dto.assignedTo ?? null}::uuid, assigned_to),
        responsible_company = COALESCE(${dto.responsibleCompany ?? null}, responsible_company),
        deadline            = COALESCE(${dto.deadline ?? null}::timestamptz, deadline),
        tags                = COALESCE(${dto.tags ? JSON.stringify(dto.tags) : null}::text[], tags),
        updated_at          = NOW()
      WHERE id = ${issueId} AND project_id = ${projectId} AND company_id = ${companyId}
      RETURNING *
    `);

    // Log status change activity automatically
    if (dto.status && dto.status !== existing.status) {
      await this.addActivity(companyId, issueId, userId, {
        activityType: 'status_change',
        fromValue: existing.status as string,
        toValue: dto.status,
      });
    }

    // Notify the new assignee on (re)assignment
    if (dto.assignedTo && dto.assignedTo !== existing.assignedTo && dto.assignedTo !== userId) {
      await this.notifications.create(companyId, {
        userId: dto.assignedTo,
        type: 'issue_assigned',
        title: `You were assigned to issue ${existing.issueNumber as string}: ${updated.title as string}`,
        resourceType: 'issue',
        resourceId: issueId,
        projectId,
        createdBy: userId,
      });
    }

    return updated;
  }

  // ── Close ─────────────────────────────────────────────────────────────────
  // Deliberately its own endpoint, not reachable via update()'s
  // @RequireProjectPermission('manage_issues') gate -- closing is
  // restricted to the issue's own creator (same "creator or admin" escape
  // hatch delete() already uses) regardless of whether the caller holds
  // that project-wide permission, so a plain creator with no grant at all
  // can still close their own issue.
  async close(companyId: string, projectId: string, issueId: string, userId: string, userRole: string) {
    const existing = await this.findOne(companyId, projectId, issueId);
    if (existing.status === 'closed') return existing;
    if (existing.createdBy !== userId && !['company_admin', 'engineering_manager'].includes(userRole)) {
      throw new ForbiddenException({
        code: 'NOT_ISSUE_CREATOR',
        message: 'Only the person who raised this issue (or an administrator) can close it.',
      });
    }

    // withTenant required -- see generateIssueNumber() above.
    const [updated] = await this.db.withTenant(companyId, sql => sql`
      UPDATE issues SET
        status     = 'closed',
        closed_at  = NOW(),
        closed_by  = ${userId}::uuid,
        updated_at = NOW()
      WHERE id = ${issueId} AND project_id = ${projectId} AND company_id = ${companyId}
      RETURNING *
    `);

    await this.addActivity(companyId, issueId, userId, {
      activityType: 'status_change',
      fromValue: existing.status as string,
      toValue: 'closed',
    });

    return updated;
  }

  // ── Delete ────────────────────────────────────────────────────────────────
  async delete(companyId: string, projectId: string, issueId: string, userId: string, userRole: string) {
    const issue = await this.findOne(companyId, projectId, issueId);
    // Only creator or admin can delete
    if (issue.createdBy !== userId && !['company_admin','engineering_manager'].includes(userRole)) {
      throw new ForbiddenException('Only the issue creator or an administrator can delete an issue.');
    }
    const result = await this.db.withTenant(companyId, sql => sql`DELETE FROM issues WHERE id = ${issueId} AND company_id = ${companyId}`);
    if (result.count === 0) {
      throw new NotFoundException(`Issue ${issueId} not found.`);
    }
    return { message: `Issue ${issue.issueNumber as string} deleted.` };
  }

  // ── Activities ────────────────────────────────────────────────────────────
  async getActivities(companyId: string, issueId: string) {
    const activities = await this.db.withTenant(companyId, sql => sql`
      SELECT a.*, u.first_name || ' ' || u.last_name AS performed_by_name, u.avatar_url
      FROM issue_activities a
      JOIN users u ON u.id = a.performed_by
      WHERE a.issue_id = ${issueId} AND a.company_id = ${companyId}
      ORDER BY a.created_at ASC
    `);

    // attachment_url stores the raw storage key, not a usable link (see
    // addAttachment() below and the ticket 2b report) -- resolve it to a
    // presigned read URL under a *different* field (attachmentReadUrl),
    // same raw-key/resolved-url split as findOne()'s
    // screenshotStorageKey -> screenshotUrl, rather than overwriting
    // attachmentUrl in place (which would erase the raw key from the
    // response for no benefit). getReadUrl() only computes a local SigV4
    // signature via the AWS SDK presigner -- no network or DB call -- so
    // resolving one per activity in this loop is cheap, not an N+1 query.
    return Promise.all(activities.map(async (activity) => {
      if (!activity.attachmentUrl) return activity;
      return { ...activity, attachmentReadUrl: await this.storage.getReadUrl(activity.attachmentUrl as string) };
    }));
  }

  // Notifies the issue's current assignee on a plain comment (unless
  // they're the one commenting) -- mirrors update()'s existing
  // reassignment-notification pattern. Only 'comment' triggers this: the
  // other activity types (status_change, forward, etc.) already notify
  // through their own dedicated code paths where relevant.
  async addActivity(companyId: string, issueId: string, userId: string, dto: AddActivityDto) {
    const { activity, issue } = await this.db.withTenant(companyId, async (sql) => {
      const [activity] = await sql`
        INSERT INTO issue_activities (
          issue_id, company_id, activity_type, content,
          from_value, to_value, capture_id, performed_by
        ) VALUES (
          ${issueId}, ${companyId}, ${dto.activityType}, ${dto.content ?? null},
          ${dto.fromValue ?? null}, ${dto.toValue ?? null},
          ${dto.captureId ?? null}, ${userId}
        )
        RETURNING *
      `;
      // Update issue updated_at
      await sql`UPDATE issues SET updated_at = NOW() WHERE id = ${issueId} AND company_id = ${companyId}`;
      const [issue] = dto.activityType === 'comment'
        ? await sql`SELECT project_id, assigned_to, issue_number, title FROM issues WHERE id = ${issueId} AND company_id = ${companyId}`
        : [undefined];
      return { activity, issue };
    });

    if (dto.activityType === 'comment' && issue?.assignedTo && issue.assignedTo !== userId) {
      await this.notifications.create(companyId, {
        userId: issue.assignedTo as string,
        type: 'issue_comment',
        title: `New comment on issue ${(issue.issueNumber as string) ?? ''}: ${issue.title as string}`,
        body: dto.content,
        resourceType: 'issue',
        resourceId: issueId,
        projectId: issue.projectId as string,
        createdBy: userId,
      });
    }

    return activity;
  }

  // ── Add evidence capture ──────────────────────────────────────────────────
  async addCapture(companyId: string, issueId: string, userId: string, captureId: string, isPrimary = false, caption?: string) {
    // withTenant required -- issue_captures carries the tenant_isolation RLS policy.
    const [link] = await this.db.withTenant(companyId, sql => sql`
      INSERT INTO issue_captures (issue_id, capture_id, company_id, is_primary, caption, added_by)
      VALUES (${issueId}, ${captureId}, ${companyId}, ${isPrimary}, ${caption ?? null}, ${userId})
      ON CONFLICT (issue_id, capture_id) DO UPDATE SET caption = ${caption ?? null}
      RETURNING *
    `);
    await this.addActivity(companyId, issueId, userId, {
      activityType: 'capture_added',
      captureId,
      content: caption,
    });
    return link;
  }

  // ── Get issues for a BIM element ──────────────────────────────────────────
  async getByElement(companyId: string, elementId: string) {
    return this.db.withTenant(companyId, sql => sql`
      SELECT i.*, u.first_name || ' ' || u.last_name AS assigned_to_name
      FROM issues i
      LEFT JOIN users u ON u.id = i.assigned_to
      WHERE i.element_id = ${elementId} AND i.company_id = ${companyId}
        AND i.status NOT IN ('closed', 'void')
      ORDER BY CASE i.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 ELSE 2 END, i.created_at DESC
    `);
  }

  // ── Resolve which project an issue belongs to, by id alone ─────────────────
  async lookupProjectForIssue(companyId: string, issueId: string) {
    const [row] = await this.db.withTenant(companyId, sql => sql`
      SELECT id, project_id, issue_number FROM issues WHERE id = ${issueId} AND company_id = ${companyId}
    `);
    if (!row) throw new NotFoundException(`Issue ${issueId} not found.`);
    return row;
  }

  // ── Dashboard summary ─────────────────────────────────────────────────────
  async getSummary(companyId: string, projectId: string) {
    const [summary] = await this.db.withTenant(companyId, sql => sql`
      SELECT
        COUNT(*)                                                               AS total,
        COUNT(*) FILTER (WHERE status = 'open')                               AS open,
        COUNT(*) FILTER (WHERE status IN ('assigned','in_progress'))          AS in_progress,
        COUNT(*) FILTER (WHERE status = 'resolved')                           AS resolved,
        COUNT(*) FILTER (WHERE status = 'closed')                             AS closed,
        COUNT(*) FILTER (WHERE priority = 'critical' AND status != 'closed')  AS critical,
        COUNT(*) FILTER (WHERE deadline < NOW() AND status NOT IN ('closed','void')) AS overdue,
        COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days')       AS created_this_week,
        COUNT(*) FILTER (WHERE closed_at  >= NOW() - INTERVAL '7 days')       AS closed_this_week
      FROM issues
      WHERE project_id = ${projectId} AND company_id = ${companyId}
    `);
    return summary;
  }

  // ── Reports KPI breakdown ────────────────────────────────────────────────
  // Sibling to getSummary() above -- deliberately not folded into it, since
  // other pages already depend on getSummary()'s exact current shape. One
  // GROUP BY query, folded in JS into three Record<string, number> maps
  // (status/priority/discipline), for the Reports feature's KPI dashboard
  // and PDF export (reports.service.ts).
  async getKpiBreakdown(companyId: string, projectId: string) {
    const rows = await this.db.withTenant(companyId, sql => sql`
      SELECT status, priority, discipline, COUNT(*) AS count
      FROM issues
      WHERE project_id = ${projectId} AND company_id = ${companyId}
      GROUP BY status, priority, discipline
    `);

    const byStatus: Record<string, number> = {};
    const byPriority: Record<string, number> = {};
    const byDiscipline: Record<string, number> = {};
    for (const row of rows) {
      const count = Number(row.count);
      const status = row.status as string;
      const priority = row.priority as string;
      const discipline = (row.discipline as string | null) ?? 'other';
      byStatus[status] = (byStatus[status] ?? 0) + count;
      byPriority[priority] = (byPriority[priority] ?? 0) + count;
      byDiscipline[discipline] = (byDiscipline[discipline] ?? 0) + count;
    }
    return { byStatus, byPriority, byDiscipline };
  }

  // Mirrors findAll()'s join pattern (assigned_to_name via u_assignee) --
  // used by the Reports KPI dashboard/PDF for its "currently open" table,
  // not a general-purpose list endpoint, hence the flat limit + no pagination.
  async getOpenList(companyId: string, projectId: string, limit = 50) {
    return this.db.withTenant(companyId, sql => sql`
      SELECT
        i.id, i.issue_number, i.title, i.status, i.priority, i.discipline, i.deadline,
        u_assignee.first_name || ' ' || u_assignee.last_name AS assigned_to_name
      FROM issues i
      LEFT JOIN users u_assignee ON u_assignee.id = i.assigned_to
      WHERE i.project_id = ${projectId} AND i.company_id = ${companyId}
        AND i.status NOT IN ('closed', 'void')
      ORDER BY
        CASE i.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
        i.created_at DESC
      LIMIT ${limit}
    `);
  }

  // ══════════════════════════════════════════════════════════════════════
  // Ticket 2b — workflow actions
  // ══════════════════════════════════════════════════════════════════════

  // ── Forward ─────────────────────────────────────────────────────────────
  // Reassigns the issue to another user and logs a 'forward' activity.
  // Mirrors update()'s existing reassignment-notification behavior for
  // consistency, since this is functionally a targeted reassignment.
  // Restricted to the issue's current assignee -- the one person actually
  // doing the work is the one who gets to hand it off. If the issue is
  // still unassigned there's no current assignee to check against, so the
  // creator may forward it instead (functionally an initial assignment).
  // Admins keep the same "creator or admin" escape hatch close()/delete()
  // already use.
  async forward(companyId: string, projectId: string, issueId: string, userId: string, userRole: string, dto: ForwardIssueDto) {
    const existing = await this.findOne(companyId, projectId, issueId);
    const isCurrentAssignee = existing.assignedTo === userId;
    const isCreatorOfUnassigned = !existing.assignedTo && existing.createdBy === userId;
    if (!isCurrentAssignee && !isCreatorOfUnassigned && !['company_admin', 'engineering_manager'].includes(userRole)) {
      throw new ForbiddenException({
        code: 'NOT_ISSUE_ASSIGNEE',
        message: 'Only the current assignee can forward this issue to someone else.',
      });
    }

    // withTenant required -- see generateIssueNumber() above.
    const [updated] = await this.db.withTenant(companyId, sql => sql`
      UPDATE issues SET assigned_to = ${dto.toUserId}::uuid, updated_at = NOW()
      WHERE id = ${issueId} AND project_id = ${projectId} AND company_id = ${companyId}
      RETURNING *
    `);

    await this.addActivity(companyId, issueId, userId, {
      activityType: 'forward',
      fromValue: (existing.assignedTo as string | null) ?? undefined,
      toValue: dto.toUserId,
      content: dto.comment,
    });

    if (dto.toUserId !== userId) {
      await this.notifications.create(companyId, {
        userId: dto.toUserId,
        type: 'issue_assigned',
        title: `Issue ${existing.issueNumber as string} was forwarded to you: ${existing.title as string}`,
        resourceType: 'issue',
        resourceId: issueId,
        projectId,
        createdBy: userId,
      });
    }

    return updated;
  }

  // ── Admin force-status ─────────────────────────────────────────────────
  // Bypasses the normal update() path entirely -- there is no transition
  // validation to bypass today (update() unconditionally COALESCEs status),
  // but this is still a distinct, @Roles-gated path so it logs a dedicated
  // 'status_force' activity instead of 'status_change', per the reference
  // tracker's audit trail.
  async forceStatus(companyId: string, projectId: string, issueId: string, userId: string, dto: ForceStatusDto) {
    const existing = await this.findOne(companyId, projectId, issueId);
    const isClosing = dto.status === 'closed' && existing.status !== 'closed';

    // withTenant required -- see generateIssueNumber() above.
    const [updated] = await this.db.withTenant(companyId, sql => sql`
      UPDATE issues SET
        status     = ${dto.status},
        closed_at  = CASE WHEN ${isClosing} THEN NOW() ELSE closed_at END,
        closed_by  = CASE WHEN ${isClosing} THEN ${userId}::uuid ELSE closed_by END,
        updated_at = NOW()
      WHERE id = ${issueId} AND project_id = ${projectId} AND company_id = ${companyId}
      RETURNING *
    `);

    await this.addActivity(companyId, issueId, userId, {
      activityType: 'status_force',
      fromValue: existing.status as string,
      toValue: dto.status,
    });

    return updated;
  }

  // ── Bulk close ──────────────────────────────────────────────────────────
  // Scoped to (project_id, company_id) like every other issues query here,
  // and additionally uses withTenant() so RLS enforces the company
  // boundary at the DB level too -- an issueId belonging to another
  // company/project simply won't match and is silently skipped, same as
  // findOne()'s tenant scoping elsewhere in this file. Wrapped in
  // withTenant()'s transaction so the status updates and their activity
  // log entries succeed or fail together.
  //
  // Same creator-only rule as the single-issue close() -- a non-admin
  // caller only ever closes the issues in their selection that they
  // themselves raised; anything else in dto.issueIds is silently skipped
  // (reported back via `skipped`) rather than failing the whole batch.
  async bulkClose(companyId: string, projectId: string, userId: string, userRole: string, dto: BulkCloseIssuesDto) {
    const isAdmin = ['company_admin', 'engineering_manager'].includes(userRole);
    return this.db.withTenant(companyId, async (sql) => {
      const targets = await sql`
        SELECT id, status, issue_number FROM issues
        WHERE id = ANY(${dto.issueIds}::uuid[])
          AND project_id = ${projectId} AND company_id = ${companyId}
          AND status <> 'closed'
          AND (${isAdmin} OR created_by = ${userId}::uuid)
      `;
      if (targets.length === 0) return { closed: 0, issueIds: [], skipped: dto.issueIds.length };

      const ids = targets.map(t => t.id as string);
      await sql`
        UPDATE issues SET status = 'closed', closed_at = NOW(), closed_by = ${userId}::uuid, updated_at = NOW()
        WHERE id = ANY(${ids}::uuid[])
      `;

      // Reuses 'status_change' (the same activity type the single-issue
      // close() path logs) rather than inventing a new one.
      for (const target of targets) {
        await sql`
          INSERT INTO issue_activities (issue_id, company_id, activity_type, from_value, to_value, performed_by)
          VALUES (${target.id}, ${companyId}, 'status_change', ${target.status}, 'closed', ${userId})
        `;
      }

      return { closed: targets.length, issueIds: ids, skipped: dto.issueIds.length - targets.length };
    });
  }

  // ── Reminders ───────────────────────────────────────────────────────────
  // Broadcasts to every open (non-closed/void) issue in the project. One
  // issue_reminders row per affected issue (so the log shows exactly what
  // was sent and to whom -- sent_to is that issue's current assignee,
  // which may be null for unassigned issues), plus a 'reminder' activity
  // on each.
  async broadcastReminder(companyId: string, projectId: string, userId: string, dto: BroadcastReminderDto) {
    return this.db.withTenant(companyId, async (sql) => {
      const openIssues = await sql`
        SELECT id, assigned_to FROM issues
        WHERE project_id = ${projectId} AND company_id = ${companyId}
          AND status NOT IN ('closed', 'void')
      `;

      for (const issue of openIssues) {
        await sql`
          INSERT INTO issue_reminders (company_id, project_id, issue_id, sent_by, sent_to, message, sent_at)
          VALUES (${companyId}, ${projectId}, ${issue.id}, ${userId}, ${issue.assignedTo ?? null}, ${dto.message}, NOW())
        `;
        await sql`
          INSERT INTO issue_activities (issue_id, company_id, activity_type, content, performed_by)
          VALUES (${issue.id}, ${companyId}, 'reminder', ${dto.message}, ${userId})
        `;
      }

      return { remindersSent: openIssues.length };
    });
  }

  // Same pattern as broadcastReminder(), scoped to one user's open issues.
  async userReminder(companyId: string, projectId: string, userId: string, dto: UserReminderDto) {
    return this.db.withTenant(companyId, async (sql) => {
      const userIssues = await sql`
        SELECT id FROM issues
        WHERE project_id = ${projectId} AND company_id = ${companyId}
          AND assigned_to = ${dto.userId}::uuid
          AND status NOT IN ('closed', 'void')
      `;

      for (const issue of userIssues) {
        await sql`
          INSERT INTO issue_reminders (company_id, project_id, issue_id, sent_by, sent_to, message, sent_at)
          VALUES (${companyId}, ${projectId}, ${issue.id}, ${userId}, ${dto.userId}::uuid, ${dto.message}, NOW())
        `;
        await sql`
          INSERT INTO issue_activities (issue_id, company_id, activity_type, content, performed_by)
          VALUES (${issue.id}, ${companyId}, 'reminder', ${dto.message}, ${userId})
        `;
      }

      return { remindersSent: userIssues.length };
    });
  }

  // One-click "Warn" from the dashboard's per-user KPI row -- unlike the
  // scheduled IssueWarningService (which has no real actor and falls back to
  // attributing to the issue's own creator), this always has a real manager
  // triggering it, so performed_by is that manager's own id, not a workaround.
  // Scoped to overdue issues specifically, not all open ones -- matches what
  // the KPI row's "overdue" count is actually about.
  async warnUser(companyId: string, projectId: string, performedBy: string, dto: WarnUserDto) {
    return this.db.withTenant(companyId, async (sql) => {
      const overdueIssues = await sql`
        SELECT id, deadline FROM issues
        WHERE project_id = ${projectId} AND company_id = ${companyId}
          AND assigned_to = ${dto.userId}::uuid
          AND status NOT IN ('closed', 'void')
          AND deadline IS NOT NULL AND deadline < NOW()
      `;

      for (const issue of overdueIssues) {
        const overdueDays = Math.max(0, Math.floor((Date.now() - new Date(issue.deadline as string).getTime()) / (1000 * 60 * 60 * 24)));
        const message = overdueDays >= 1
          ? `Manual warning: issue is overdue by ${overdueDays} day(s).`
          : `Manual warning: issue is past its deadline.`;
        await sql`
          INSERT INTO issue_activities (issue_id, company_id, activity_type, content, performed_by)
          VALUES (${issue.id}, ${companyId}, 'manual_warning', ${message}, ${performedBy})
        `;
      }

      return { warned: overdueIssues.length };
    });
  }

  async listReminders(companyId: string, projectId: string, query: PaginationQuery) {
    const page    = query.page ?? 1;
    const perPage = Math.min(query.perPage ?? 20, 100);
    const offset  = (page - 1) * perPage;

    const rows = await this.db.withTenant(companyId, sql => sql`
      SELECT
        r.*,
        u_sender.first_name || ' ' || u_sender.last_name    AS sent_by_name,
        u_recipient.first_name || ' ' || u_recipient.last_name AS sent_to_name,
        i.issue_number, i.title AS issue_title,
        COUNT(*) OVER() AS full_count
      FROM issue_reminders r
      LEFT JOIN users u_sender    ON u_sender.id    = r.sent_by
      LEFT JOIN users u_recipient ON u_recipient.id = r.sent_to
      LEFT JOIN issues i          ON i.id           = r.issue_id
      WHERE r.project_id = ${projectId} AND r.company_id = ${companyId}
      ORDER BY r.created_at DESC
      LIMIT ${perPage} OFFSET ${offset}
    `);

    return this.db.paginate(rows, page, perPage);
  }

  // ── Attachments ─────────────────────────────────────────────────────────
  // Step 1 of the presigned-PUT pattern (see documents.service.ts /
  // captures.service.ts for the reference shape): validate extension +
  // declared size, then hand back a presigned PUT URL. The client uploads
  // directly to storage; our API never sees the file bytes.
  async getAttachmentUploadUrl(companyId: string, projectId: string, dto: IssueAttachmentUploadUrlDto) {
    const ext = dto.filename.split('.').pop()?.toLowerCase() ?? '';
    if (!ISSUE_ATTACHMENT_ALLOWED_EXTENSIONS.has(ext)) {
      throw new BadRequestException(
        `File type ".${ext}" is not supported. Allowed: ${[...ISSUE_ATTACHMENT_ALLOWED_EXTENSIONS].join(', ')}.`,
      );
    }
    if (dto.sizeBytes > ISSUE_ATTACHMENT_MAX_SIZE) {
      throw new BadRequestException(
        `File too large (${(dto.sizeBytes / 1024 / 1024).toFixed(1)} MB). Max: ${ISSUE_ATTACHMENT_MAX_SIZE / 1024 / 1024} MB.`,
      );
    }

    const key = this.storage.generateKey(companyId, projectId, 'issues', dto.filename);
    const { uploadUrl } = await this.storage.getUploadUrl(key, 'application/octet-stream', dto.sizeBytes);
    return { uploadUrl, storageKey: key };
  }

  // Step 2: client already PUT the bytes to `storageKey` from step 1 --
  // this registers it as a new issue_activities row. attachment_url
  // stores the storage key (not a raw presigned URL, which would expire) --
  // same pattern as documents.storageKey / issues.screenshotStorageKey,
  // resolved to a live presigned URL by the caller/read path when needed.
  async addAttachment(companyId: string, issueId: string, userId: string, dto: AddIssueAttachmentDto) {
    return this.db.withTenant(companyId, async (sql) => {
      const [activity] = await sql`
        INSERT INTO issue_activities (
          issue_id, company_id, activity_type, content,
          attachment_url, attachment_name, attachment_size_bytes, performed_by
        ) VALUES (
          ${issueId}, ${companyId}, 'comment', ${dto.comment ?? `Attached file: ${dto.filename}`},
          ${dto.storageKey}, ${dto.filename}, ${dto.sizeBytes}, ${userId}
        )
        RETURNING *
      `;
      await sql`UPDATE issues SET updated_at = NOW() WHERE id = ${issueId} AND company_id = ${companyId}`;
      return activity;
    });
  }

  // ══════════════════════════════════════════════════════════════════════
  // Export -- PDF/XLS, shared data-gathering + two renderers
  // ══════════════════════════════════════════════════════════════════════

  // Single shared query, used by both generatePdf() and generateXls() --
  // per the ticket's own decision, one server-side pipeline rather than
  // mirroring RFI's PDF/XLS split. Unlike RFI (separate rfi_comments/
  // rfi_attachments tables), everything here -- comments, attachments,
  // status changes -- lives unified in issue_activities (see
  // getActivities()); the export splits that single feed three ways.
  private async getExportData(companyId: string, projectId: string, issueId: string) {
    const issue = await this.findOne(companyId, projectId, issueId);
    const activities = await this.db.withTenant(companyId, sql => sql`
      SELECT a.*, u.first_name || ' ' || u.last_name AS performed_by_name
      FROM issue_activities a
      JOIN users u ON u.id = a.performed_by
      WHERE a.issue_id = ${issueId} AND a.company_id = ${companyId}
      ORDER BY a.created_at ASC
    `);
    const [project] = await this.db.withTenant(companyId, sql => sql`
      SELECT name, code FROM projects WHERE id = ${projectId} AND company_id = ${companyId}
    `);
    // Photos/videos belonging to the pin (locations row) this issue was
    // raised from, if any -- captures.location_id = issue.locationId is
    // the same relationship PinPanel.tsx's own "History" grid already
    // reads from (listCaptures({ locationId })), not a new concept.
    const pinCaptures = issue.locationId
      ? await this.db.withTenant(companyId, sql => sql`
          SELECT c.id, c.title, c.capture_type, c.original_key,
            (SELECT cr.storage_key FROM capture_renditions cr
             WHERE cr.capture_id = c.id AND cr.rendition_type = 'thumbnail_lg' LIMIT 1) AS thumb_key
          FROM captures c
          WHERE c.location_id = ${issue.locationId} AND c.company_id = ${companyId} AND c.status = 'ready'
          ORDER BY c.captured_at ASC
        `)
      : [];
    return { issue, activities: activities as Array<Record<string, unknown>>, project, pinCaptures: pinCaptures as Array<Record<string, unknown>> };
  }

  // Mirrors CaptureGrid.tsx's TYPE_LABEL exactly -- display-only, kept as
  // its own copy for the same reason the discipline/category/type label
  // maps above are (no shared package export, and duplicating three
  // literals isn't worth a cross-module import for it).
  private static readonly CAPTURE_TYPE_LABELS: Record<string, string> = {
    photo_360: '360° Photo', photo_standard: 'Photo', video: 'Video',
  };

  // Mirrors IssueDetail.tsx's own activityLabel() exactly, for the export's
  // Activity Log section -- kept as a separate copy since one lives in
  // apps/web and the other here, same split as richTextToPlain() between
  // rfi-pdf.template.ts and rfi-xls.ts.
  private activityActionLabel(activityType: string, fromValue?: string, toValue?: string): string {
    if (activityType === 'status_change') return `changed status: ${fromValue ?? '?'} → ${toValue ?? '?'}`;
    if (activityType === 'status_force') return `force-changed status: ${fromValue ?? '?'} → ${toValue ?? '?'}`;
    if (activityType === 'capture_added') return 'attached a photo';
    if (activityType === 'assigned') return 'reassigned the issue';
    if (activityType === 'closed') return 'closed the issue';
    if (activityType === 'forward') return 'forwarded the issue';
    if (activityType === 'reopened') return 'reopened the issue';
    if (activityType === 'auto_warning') return 'sent an automatic deadline warning';
    if (activityType === 'manual_warning') return 'sent a manual warning';
    if (activityType === 'reminder') return 'sent a reminder';
    return 'commented';
  }

  // A plain comment (activity_type='comment', no attachment) vs. an
  // attachment (attachment_url set, regardless of activity_type -- see
  // addAttachment()'s own comment: it always inserts as 'comment') vs.
  // everything else (status changes, forwards, reminders, etc.) --
  // three-way split shared by both generatePdf() and generateXls().
  private splitActivitiesForExport(activities: Array<Record<string, unknown>>) {
    const comments = activities.filter((a) => a.activityType === 'comment' && !a.attachmentUrl);
    const attachments = activities.filter((a) => Boolean(a.attachmentUrl));
    const statusEvents = activities.filter((a) => !(a.activityType === 'comment' && !a.attachmentUrl) && !a.attachmentUrl);
    return { comments, attachments, statusEvents };
  }

  // Turns a pinCaptures row (see getExportData()) into the {attachmentName,
  // attachmentUrl} shape appendAttachmentPages()/mergeAttachmentPdfs()
  // already expect, so pin photos merge into the PDF appendix through the
  // exact same tested code path as a regular attachment -- not a parallel
  // implementation. Prefers the thumbnail_lg rendition (a real, always-
  // present-once-processed .jpg, cheap to download) over the original file
  // (could be a multi-MB raw upload, and for a 360 photo isn't flat).
  // Videos have no static rendition at all -- attachmentUrl stays
  // undefined, so appendAttachmentPages() skips the appendix page for them
  // and the summary's own text line is their only representation.
  private pinPhotoAttachmentRow(capture: Record<string, unknown>): Record<string, unknown> {
    const typeLabel = IssuesService.CAPTURE_TYPE_LABELS[capture.captureType as string] ?? (capture.captureType as string);
    const label = `${(capture.title as string | undefined) || 'Untitled'} (${typeLabel})`;
    const key = capture.captureType === 'video' ? undefined : ((capture.thumbKey as string | undefined) ?? (capture.originalKey as string));
    return { attachmentName: label, attachmentUrl: key };
  }

  async generatePdf(companyId: string, projectId: string, issueId: string): Promise<{ buffer: Buffer; filename: string }> {
    const { issue, activities, project, pinCaptures } = await this.getExportData(companyId, projectId, issueId);
    const { comments, attachments, statusEvents } = this.splitActivitiesForExport(activities);
    const filename = `${(issue.issueNumber as string) ?? issueId}.pdf`;

    const attachmentsWithImage = await Promise.all(attachments.map(async (a) => {
      const filename = a.attachmentName as string;
      const storageKey = a.attachmentUrl as string;
      const imageBuffer = this.isImageFilename(filename)
        ? await this.storage.download(storageKey).then((raw) => this.resizeAttachmentImage(raw)).catch(() => undefined)
        : undefined;
      return { filename, imageBuffer };
    }));

    const pinPhotoRows = pinCaptures.map((c) => this.pinPhotoAttachmentRow(c));
    const pinPhotosWithImage = await Promise.all(pinPhotoRows.map(async (row) => {
      const filename = row.attachmentName as string;
      const storageKey = row.attachmentUrl as string | undefined;
      const imageBuffer = storageKey
        ? await this.storage.download(storageKey).then((raw) => this.resizeAttachmentImage(raw)).catch(() => undefined)
        : undefined;
      return { filename, imageBuffer };
    }));

    const summaryBuffer = await renderIssuePdf({
      issueNumber: (issue.issueNumber as string) ?? (issue.id as string),
      title: issue.title as string,
      status: issue.status as string,
      priority: issue.priority as string,
      issueTypeLabel: ISSUE_TYPE_LABELS[issue.issueType as string] ?? (issue.issueType as string),
      disciplineLabel: issue.discipline ? ISSUE_DISCIPLINE_LABELS[issue.discipline as string] : undefined,
      categoryLabel: issue.category ? ISSUE_CATEGORY_LABELS[issue.category as string] : undefined,
      description: issue.description as string | undefined,
      createdByName: issue.createdByName as string | undefined,
      createdAt: new Date(issue.createdAt as string).toLocaleDateString('en-GB'),
      assignedToName: issue.assignedToName as string | undefined,
      deadline: issue.deadline ? new Date(issue.deadline as string).toLocaleDateString('en-GB') : undefined,
      locationName: (issue.locationName as string | undefined) ?? (issue.buildingName as string | undefined),
      closedAt: issue.closedAt ? new Date(issue.closedAt as string).toLocaleString('en-GB') : undefined,
      attachments: attachmentsWithImage,
      pinPhotos: pinPhotosWithImage,
      comments: comments.map((c) => ({
        userName: c.performedByName as string | undefined,
        body: c.content as string,
        createdAt: new Date(c.createdAt as string).toLocaleString('en-GB'),
      })),
      statusEvents: statusEvents.map((a) => ({
        action: this.activityActionLabel(a.activityType as string, a.fromValue as string | undefined, a.toValue as string | undefined),
        userName: a.performedByName as string | undefined,
        occurredAt: new Date(a.createdAt as string).toLocaleString('en-GB'),
      })),
      projectName: (project?.name as string) ?? '—',
      projectCode: project?.code as string | undefined,
    });

    const buffer = await this.mergeAttachmentPdfs(summaryBuffer, [...attachments, ...pinPhotoRows]);
    return { buffer, filename };
  }

  // Factored out of generateXls() so generateBulkXls() (below) can gather
  // each selected issue's data and add it as its own sheet on one shared
  // workbook, rather than needing N separate un-combinable workbooks --
  // exceljs has no supported way to merge sheets across workbooks after
  // the fact, so sharing this step is the only way to avoid re-deriving
  // the same field-mapping logic twice.
  private async buildXlsDataForIssue(companyId: string, projectId: string, issueId: string): Promise<IssueXlsData> {
    const { issue, activities, project, pinCaptures } = await this.getExportData(companyId, projectId, issueId);
    const { comments, attachments, statusEvents } = this.splitActivitiesForExport(activities);

    const attachmentsWithImage = await Promise.all(attachments.map(async (a) => {
      const filename = a.attachmentName as string;
      const storageKey = a.attachmentUrl as string;
      const ext = this.getFileExtension(filename);
      if (!this.isImageFilename(filename)) return { filename };
      const imageBuffer = await this.storage.download(storageKey).then((raw) => this.resizeAttachmentImage(raw)).catch(() => undefined);
      return { filename, imageBuffer, imageExtension: (ext === 'png' ? 'png' : 'jpeg') as 'png' | 'jpeg' };
    }));

    // Renditions are always .jpg (image-processing.processor.ts always
    // encodes them via sharp's .jpeg()) -- no need for the label-based
    // getFileExtension()/isImageFilename() detection attachments use above,
    // since a pin photo's label has no real extension at all.
    const pinPhotosWithImage = await Promise.all(pinCaptures.map(async (c) => {
      const row = this.pinPhotoAttachmentRow(c);
      const filename = row.attachmentName as string;
      const storageKey = row.attachmentUrl as string | undefined;
      if (!storageKey) return { filename };
      const imageBuffer = await this.storage.download(storageKey).then((raw) => this.resizeAttachmentImage(raw)).catch(() => undefined);
      return { filename, imageBuffer, imageExtension: 'jpeg' as const };
    }));

    return {
      issueNumber: (issue.issueNumber as string) ?? (issue.id as string),
      title: issue.title as string,
      status: issue.status as string,
      priority: issue.priority as string,
      issueTypeLabel: ISSUE_TYPE_LABELS[issue.issueType as string] ?? (issue.issueType as string),
      disciplineLabel: issue.discipline ? ISSUE_DISCIPLINE_LABELS[issue.discipline as string] : undefined,
      categoryLabel: issue.category ? ISSUE_CATEGORY_LABELS[issue.category as string] : undefined,
      description: issue.description as string | undefined,
      createdByName: issue.createdByName as string | undefined,
      createdAt: new Date(issue.createdAt as string).toLocaleDateString('en-GB'),
      assignedToName: issue.assignedToName as string | undefined,
      deadline: issue.deadline ? new Date(issue.deadline as string).toLocaleDateString('en-GB') : undefined,
      locationName: (issue.locationName as string | undefined) ?? (issue.buildingName as string | undefined),
      closedAt: issue.closedAt ? new Date(issue.closedAt as string).toLocaleString('en-GB') : undefined,
      attachments: attachmentsWithImage,
      pinPhotos: pinPhotosWithImage,
      comments: comments.map((c) => ({
        userName: c.performedByName as string | undefined,
        body: c.content as string,
        createdAt: new Date(c.createdAt as string).toLocaleString('en-GB'),
      })),
      activityEvents: statusEvents.map((a) => ({
        action: this.activityActionLabel(a.activityType as string, a.fromValue as string | undefined, a.toValue as string | undefined),
        userName: a.performedByName as string | undefined,
        occurredAt: new Date(a.createdAt as string).toLocaleString('en-GB'),
      })),
      projectName: (project?.name as string) ?? '—',
      projectCode: project?.code as string | undefined,
    };
  }

  async generateXls(companyId: string, projectId: string, issueId: string): Promise<{ buffer: Buffer; filename: string }> {
    const data = await this.buildXlsDataForIssue(companyId, projectId, issueId);
    const buffer = await buildIssueWorkbookBuffer(data);
    return { buffer: Buffer.from(buffer), filename: `${data.issueNumber}.xlsx` };
  }

  // ── Bulk export -- mirrors bulkClose()'s selection model (a list of
  // issue ids from the list page's checkboxes).
  //
  // Both PDF and XLS ship as a ZIP containing each selected issue's own
  // export as its own separate file -- deliberately NOT one merged PDF /
  // one multi-sheet workbook (an earlier version did that for both; per
  // explicit feedback, a bulk export of otherwise-independent documents
  // reads better as separate, individually-shareable files than as one
  // combined one, the same way downloading multiple invoices/photos from
  // most apps gives you a zip). Reuses generatePdf() / buildIssueWorkbookBuffer()
  // wholesale, unchanged, per issue.
  async generateBulkPdf(companyId: string, projectId: string, issueIds: string[]): Promise<{ buffer: Buffer; filename: string }> {
    const zip = new JSZip();
    const usedNames = new Set<string>();
    for (const issueId of issueIds) {
      const { buffer, filename } = await this.generatePdf(companyId, projectId, issueId);
      zip.file(this.uniqueZipEntryName(filename, usedNames), buffer);
    }
    const bytes = await zip.generateAsync({ type: 'nodebuffer' });
    return { buffer: bytes, filename: `issues-export-${new Date().toISOString().slice(0, 10)}.zip` };
  }

  // Same "separate files in a zip" treatment as generateBulkPdf() above,
  // per the same feedback -- each selected issue gets its own .xlsx
  // (reusing buildIssueWorkbookBuffer() wholesale, unchanged) rather than
  // being folded into one multi-sheet workbook.
  async generateBulkXls(companyId: string, projectId: string, issueIds: string[]): Promise<{ buffer: Buffer; filename: string }> {
    const zip = new JSZip();
    const usedNames = new Set<string>();
    for (const issueId of issueIds) {
      const data = await this.buildXlsDataForIssue(companyId, projectId, issueId);
      const buffer = await buildIssueWorkbookBuffer(data);
      zip.file(this.uniqueZipEntryName(`${data.issueNumber}.xlsx`, usedNames), buffer);
    }
    const bytes = await zip.generateAsync({ type: 'nodebuffer' });
    return { buffer: bytes, filename: `issues-export-${new Date().toISOString().slice(0, 10)}.zip` };
  }

  // Shared by generateBulkPdf()/generateBulkXls() above -- ensures two
  // selected issues sharing an issue_number don't silently overwrite one
  // another as the same zip entry.
  private uniqueZipEntryName(filename: string, used: Set<string>): string {
    if (!used.has(filename)) {
      used.add(filename);
      return filename;
    }
    const dot = filename.lastIndexOf('.');
    const base = dot === -1 ? filename : filename.slice(0, dot);
    const ext = dot === -1 ? '' : filename.slice(dot);
    let i = 2;
    let candidate = `${base} (${i})${ext}`;
    while (used.has(candidate)) {
      i++;
      candidate = `${base} (${i})${ext}`;
    }
    used.add(candidate);
    return candidate;
  }

  // Raster-image extensions eligible for inline PDF embedding -- everything
  // else (pdf, docx, dwg, etc.) keeps a plain "• filename" text line only.
  // Mirrors RfisService's identical constant/method pair exactly.
  private static readonly IMAGE_ATTACHMENT_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp']);
  private static readonly MERGEABLE_IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png']);

  private getFileExtension(filename: string): string {
    return filename.split('.').pop()?.toLowerCase() ?? '';
  }

  private isImageFilename(filename: string): boolean {
    return IssuesService.IMAGE_ATTACHMENT_EXTENSIONS.has(this.getFileExtension(filename));
  }

  private async resizeAttachmentImage(buffer: Buffer): Promise<Buffer> {
    return sharp(buffer).rotate().resize(900, 900, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 78 }).toBuffer();
  }

  // Full-page section-marker page -- plain drawText(), not routed through
  // react-pdf. Mirrors RfisService's identical method exactly.
  private addAttachmentDividerPage(mainDoc: PDFDocument, headingFont: PDFFont, bodyFont: PDFFont, filename: string): void {
    const [, pageHeight] = PageSizes.A4;
    const page = mainDoc.addPage(PageSizes.A4);
    const margin = 50;
    page.drawText('ATTACHMENT', { x: margin, y: pageHeight - margin - 24, size: 20, font: headingFont, color: rgb(0.04, 0.08, 0.11) });
    page.drawText(filename, { x: margin, y: pageHeight - margin - 54, size: 13, font: bodyFont, color: rgb(0.04, 0.08, 0.11) });
  }

  // Mirrors RfisService.appendAttachmentPages() exactly, adapted for
  // issue_activities' attachment_url/attachment_name fields in place of
  // rfi_attachments' storage_key/filename. Extension is read from the
  // storage key, not the display name -- for a real uploaded attachment
  // those always match (generateKey() preserves the original extension),
  // but a pin photo's "filename" here is a human label ("Crack near
  // entrance (Photo)") with no real extension at all, while its storage
  // key (a capture_renditions row) always genuinely ends .jpg.
  private async appendAttachmentPages(mainDoc: PDFDocument, row: Record<string, unknown>, headingFont: PDFFont, bodyFont: PDFFont): Promise<void> {
    const filename = row.attachmentName as string;
    const storageKey = row.attachmentUrl as string | undefined;
    const ext = this.getFileExtension(storageKey ?? '');
    const isPdf = ext === 'pdf';
    const isMergeableImage = IssuesService.MERGEABLE_IMAGE_EXTENSIONS.has(ext);
    if (!storageKey || (!isPdf && !isMergeableImage)) return;

    try {
      const bytes = await this.storage.download(storageKey);
      // MUST copy into a fresh Uint8Array before handing to pdf-lib -- see
      // RfisService.appendAttachmentPages()'s identical comment on the
      // Buffer.concat / pdf-lib JpegEmbedder byteOffset bug.
      const normalizedBytes = Uint8Array.from(bytes);

      if (isPdf) {
        const attachmentDoc = await PDFDocument.load(normalizedBytes);
        const copiedPages = await mainDoc.copyPages(attachmentDoc, attachmentDoc.getPageIndices());
        this.addAttachmentDividerPage(mainDoc, headingFont, bodyFont, filename);
        copiedPages.forEach((p) => mainDoc.addPage(p));
      } else {
        const image = ext === 'png' ? await mainDoc.embedPng(normalizedBytes) : await mainDoc.embedJpg(normalizedBytes);
        const [pageWidth, pageHeight] = PageSizes.A4;
        const margin = 40;
        const { width, height } = image.scaleToFit(pageWidth - margin * 2, pageHeight - margin * 2);
        this.addAttachmentDividerPage(mainDoc, headingFont, bodyFont, filename);
        const page = mainDoc.addPage(PageSizes.A4);
        page.drawImage(image, { x: (pageWidth - width) / 2, y: (pageHeight - height) / 2, width, height });
      }
    } catch (err) {
      this.logger.warn(`[generatePdf] Skipping attachment "${filename}" while merging PDF appendix: ${(err as Error)?.message ?? err}`);
    }
  }

  private async mergeAttachmentPdfs(summaryBuffer: Buffer, attachmentRows: Array<Record<string, unknown>>): Promise<Buffer> {
    const mainDoc = await PDFDocument.load(summaryBuffer);
    const headingFont = await mainDoc.embedFont(StandardFonts.HelveticaBold);
    const bodyFont = await mainDoc.embedFont(StandardFonts.Helvetica);
    for (const row of attachmentRows) {
      await this.appendAttachmentPages(mainDoc, row, headingFont, bodyFont);
    }
    const bytes = await mainDoc.save();
    return Buffer.from(bytes);
  }

  // ══════════════════════════════════════════════════════════════════════
  // Scheduled reminders -- a specific future date/time for one issue,
  // targeting its current assignee. Distinct from broadcastReminder()/
  // userReminder() above (admin-only, immediate, all-of-a-user's-issues) --
  // open to anyone who can view the issue (no @RequireProjectPermission or
  // @Roles gate), same baseline as forward()/addActivity() already have.
  // ══════════════════════════════════════════════════════════════════════

  async scheduleReminder(companyId: string, projectId: string, issueId: string, userId: string, dto: ScheduleIssueReminderDto) {
    const issue = await this.findOne(companyId, projectId, issueId);
    if (!issue.assignedTo) {
      throw new BadRequestException('This issue has no assignee yet -- assign it to someone before scheduling a reminder.');
    }
    const scheduledFor = new Date(dto.scheduledFor);
    if (Number.isNaN(scheduledFor.getTime()) || scheduledFor.getTime() <= Date.now()) {
      throw new BadRequestException('scheduledFor must be a valid date/time in the future.');
    }

    const [reminder] = await this.db.withTenant(companyId, sql => sql`
      INSERT INTO issue_reminders (company_id, project_id, issue_id, sent_by, sent_to, message, scheduled_for)
      VALUES (${companyId}, ${projectId}, ${issueId}, ${userId}, ${issue.assignedTo}::uuid, ${dto.message}, ${scheduledFor.toISOString()})
      RETURNING *
    `);
    return reminder;
  }

  // Pending == scheduled but not yet fired (sent_at IS NULL) -- fired ones
  // already show up in the issue's own Activity feed as a 'reminder' entry,
  // so there's no need to surface them here too.
  async listPendingReminders(companyId: string, projectId: string, issueId: string) {
    return this.db.withTenant(companyId, sql => sql`
      SELECT id, message, scheduled_for, sent_to, u.first_name || ' ' || u.last_name AS sent_to_name
      FROM issue_reminders r
      LEFT JOIN users u ON u.id = r.sent_to
      WHERE r.issue_id = ${issueId} AND r.project_id = ${projectId} AND r.company_id = ${companyId}
        AND r.scheduled_for IS NOT NULL AND r.sent_at IS NULL
      ORDER BY r.scheduled_for ASC
    `);
  }

  async cancelScheduledReminder(companyId: string, projectId: string, issueId: string, reminderId: string) {
    const result = await this.db.withTenant(companyId, sql => sql`
      DELETE FROM issue_reminders
      WHERE id = ${reminderId} AND issue_id = ${issueId} AND project_id = ${projectId} AND company_id = ${companyId}
        AND sent_at IS NULL
    `);
    if (result.count === 0) throw new NotFoundException('No pending scheduled reminder found with that id.');
    return { message: 'Scheduled reminder cancelled.' };
  }
}