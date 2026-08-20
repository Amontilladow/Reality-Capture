import { Injectable, NotFoundException, ForbiddenException, BadRequestException, Logger } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { AiClientService } from '../ai-client/ai-client.service';
import { NotificationsService } from '../notifications/notifications.service';
import { StorageService } from '../storage/storage.service';
import type { CreateIssueDto } from './dto/create-issue.dto';
import type { UpdateIssueDto } from './dto/update-issue.dto';
import type { AddActivityDto } from './dto/add-activity.dto';
import type { ForwardIssueDto } from './dto/forward-issue.dto';
import type { ForceStatusDto } from './dto/force-status.dto';
import type { BulkCloseIssuesDto } from './dto/bulk-close-issues.dto';
import type { BroadcastReminderDto } from './dto/broadcast-reminder.dto';
import type { UserReminderDto } from './dto/user-reminder.dto';
import type { WarnUserDto } from './dto/warn-user.dto';
import type { IssueAttachmentUploadUrlDto } from './dto/issue-attachment-upload-url.dto';
import type { AddIssueAttachmentDto } from './dto/add-issue-attachment.dto';
import { ATTACHMENT_MAX_SIZE as ISSUE_ATTACHMENT_MAX_SIZE, ATTACHMENT_ALLOWED_EXTENSIONS as ISSUE_ATTACHMENT_ALLOWED_EXTENSIONS } from '../../common/constants/attachment-limits';
import type { PaginationQuery } from '@engineeringos/types';

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
  async update(companyId: string, projectId: string, issueId: string, userId: string, dto: UpdateIssueDto) {
    const existing = await this.findOne(companyId, projectId, issueId);
    const isClosing = dto.status === 'closed' && existing.status !== 'closed';

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
        closed_at           = CASE WHEN ${isClosing} THEN NOW() ELSE closed_at END,
        closed_by           = CASE WHEN ${isClosing} THEN ${userId}::uuid ELSE closed_by END,
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

  async addActivity(companyId: string, issueId: string, userId: string, dto: AddActivityDto) {
    return this.db.withTenant(companyId, async (sql) => {
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
      return activity;
    });
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

  // ══════════════════════════════════════════════════════════════════════
  // Ticket 2b — workflow actions
  // ══════════════════════════════════════════════════════════════════════

  // ── Forward ─────────────────────────────────────────────────────────────
  // Reassigns the issue to another user and logs a 'forward' activity.
  // Mirrors update()'s existing reassignment-notification behavior for
  // consistency, since this is functionally a targeted reassignment.
  async forward(companyId: string, projectId: string, issueId: string, userId: string, dto: ForwardIssueDto) {
    const existing = await this.findOne(companyId, projectId, issueId);

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
  async bulkClose(companyId: string, projectId: string, userId: string, dto: BulkCloseIssuesDto) {
    return this.db.withTenant(companyId, async (sql) => {
      const targets = await sql`
        SELECT id, status, issue_number FROM issues
        WHERE id = ANY(${dto.issueIds}::uuid[])
          AND project_id = ${projectId} AND company_id = ${companyId}
          AND status <> 'closed'
      `;
      if (targets.length === 0) return { closed: 0, issueIds: [] };

      const ids = targets.map(t => t.id as string);
      await sql`
        UPDATE issues SET status = 'closed', closed_at = NOW(), closed_by = ${userId}::uuid, updated_at = NOW()
        WHERE id = ANY(${ids}::uuid[])
      `;

      // Reuses 'status_change' (the same activity type the single-issue
      // close path logs via update()) rather than inventing a new one.
      for (const target of targets) {
        await sql`
          INSERT INTO issue_activities (issue_id, company_id, activity_type, from_value, to_value, performed_by)
          VALUES (${target.id}, ${companyId}, 'status_change', ${target.status}, 'closed', ${userId})
        `;
      }

      return { closed: targets.length, issueIds: ids };
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
          INSERT INTO issue_reminders (company_id, project_id, issue_id, sent_by, sent_to, message)
          VALUES (${companyId}, ${projectId}, ${issue.id}, ${userId}, ${issue.assignedTo ?? null}, ${dto.message})
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
          INSERT INTO issue_reminders (company_id, project_id, issue_id, sent_by, sent_to, message)
          VALUES (${companyId}, ${projectId}, ${issue.id}, ${userId}, ${dto.userId}::uuid, ${dto.message})
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
}