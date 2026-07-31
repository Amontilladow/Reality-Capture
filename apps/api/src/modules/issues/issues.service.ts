import { Injectable, NotFoundException, ForbiddenException, Logger } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { AiClientService } from '../ai-client/ai-client.service';
import { NotificationsService } from '../notifications/notifications.service';
import type { CreateIssueDto } from './dto/create-issue.dto';
import type { UpdateIssueDto } from './dto/update-issue.dto';
import type { AddActivityDto } from './dto/add-activity.dto';
import type { PaginationQuery } from '@engineeringos/types';

@Injectable()
export class IssuesService {
  private readonly logger = new Logger(IssuesService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly aiClient: AiClientService,
    private readonly notifications: NotificationsService,
  ) {}

  // ── Generate issue number ─────────────────────────────────────────────────
  private async generateIssueNumber(companyId: string, projectId: string, issueType: string): Promise<string> {
    const [proj] = await this.db.query`SELECT code FROM projects WHERE id = ${projectId}`;
    const prefix = (proj?.code as string ?? 'PRJ').toUpperCase();
    const typeCode = { defect:'DEF', punch_item:'PNC', rfi:'RFI', coordination_clash:'CLH',
      safety_observation:'SAF', quality_hold:'QHD', inspection_point:'INS', general:'GEN' }[issueType] ?? 'ISS';
    const [cnt] = await this.db.query`
      SELECT COUNT(*) AS n FROM issues WHERE project_id = ${projectId}`;
    const seq = String(Number(cnt.n) + 1).padStart(4, '0');
    return `${prefix}-${typeCode}-${seq}`;
  }

  // ── Create ────────────────────────────────────────────────────────────────
  async create(companyId: string, projectId: string, userId: string, dto: CreateIssueDto) {
    const issueNumber = await this.generateIssueNumber(companyId, projectId, dto.issueType);

    const [issue] = await this.db.query`
      INSERT INTO issues (
        company_id, project_id, building_id, level_id, location_id, element_id,
        issue_type, issue_number, title, description, priority, discipline, trade,
        specification_ref, status, assigned_to, responsible_company, deadline,
        capture_id, drawing_id, pos_x_norm, pos_y_norm, hotspot_yaw, hotspot_pitch,
        tags, created_by
      ) VALUES (
        ${companyId}, ${projectId}, ${dto.buildingId ?? null}, ${dto.levelId ?? null},
        ${dto.locationId ?? null}, ${dto.elementId ?? null},
        ${dto.issueType}, ${issueNumber}, ${dto.title}, ${dto.description ?? null},
        ${dto.priority ?? 'medium'}, ${dto.discipline ?? null}, ${dto.trade ?? null},
        ${dto.specificationRef ?? null}, 'open',
        ${dto.assignedTo ?? null}, ${dto.responsibleCompany ?? null},
        ${dto.deadline ?? null},
        ${dto.captureId ?? null}, ${dto.drawingId ?? null},
        ${dto.posXNorm ?? null}, ${dto.posYNorm ?? null},
        ${dto.hotspotYaw ?? null}, ${dto.hotspotPitch ?? null},
        ${dto.tags ? JSON.stringify(dto.tags) : '{}'}, ${userId}
      )
      RETURNING *`;

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
    return issue;
  }

  // ── Update ────────────────────────────────────────────────────────────────
  async update(companyId: string, projectId: string, issueId: string, userId: string, dto: UpdateIssueDto) {
    const existing = await this.findOne(companyId, projectId, issueId);
    const isClosing = dto.status === 'closed' && existing.status !== 'closed';

    const [updated] = await this.db.query`
      UPDATE issues SET
        title               = COALESCE(${dto.title ?? null}, title),
        description         = COALESCE(${dto.description ?? null}, description),
        priority            = COALESCE(${dto.priority ?? null}, priority),
        status              = COALESCE(${dto.status ?? null}, status),
        discipline          = COALESCE(${dto.discipline ?? null}, discipline),
        trade               = COALESCE(${dto.trade ?? null}, trade),
        assigned_to         = COALESCE(${dto.assignedTo ?? null}::uuid, assigned_to),
        responsible_company = COALESCE(${dto.responsibleCompany ?? null}, responsible_company),
        deadline            = COALESCE(${dto.deadline ?? null}::timestamptz, deadline),
        tags                = COALESCE(${dto.tags ? JSON.stringify(dto.tags) : null}::text[], tags),
        closed_at           = CASE WHEN ${isClosing} THEN NOW() ELSE closed_at END,
        closed_by           = CASE WHEN ${isClosing} THEN ${userId}::uuid ELSE closed_by END,
        updated_at          = NOW()
      WHERE id = ${issueId} AND project_id = ${projectId} AND company_id = ${companyId}
      RETURNING *
    `;

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
    await this.db.query`DELETE FROM issues WHERE id = ${issueId} AND company_id = ${companyId}`;
    return { message: `Issue ${issue.issueNumber as string} deleted.` };
  }

  // ── Activities ────────────────────────────────────────────────────────────
  async getActivities(companyId: string, issueId: string) {
    return this.db.withTenant(companyId, sql => sql`
      SELECT a.*, u.first_name || ' ' || u.last_name AS performed_by_name, u.avatar_url
      FROM issue_activities a
      JOIN users u ON u.id = a.performed_by
      WHERE a.issue_id = ${issueId} AND a.company_id = ${companyId}
      ORDER BY a.created_at ASC
    `);
  }

  async addActivity(companyId: string, issueId: string, userId: string, dto: AddActivityDto) {
    const [activity] = await this.db.query`
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
    await this.db.query`UPDATE issues SET updated_at = NOW() WHERE id = ${issueId}`;
    return activity;
  }

  // ── Add evidence capture ──────────────────────────────────────────────────
  async addCapture(companyId: string, issueId: string, userId: string, captureId: string, isPrimary = false, caption?: string) {
    const [link] = await this.db.query`
      INSERT INTO issue_captures (issue_id, capture_id, company_id, is_primary, caption, added_by)
      VALUES (${issueId}, ${captureId}, ${companyId}, ${isPrimary}, ${caption ?? null}, ${userId})
      ON CONFLICT (issue_id, capture_id) DO UPDATE SET caption = ${caption ?? null}
      RETURNING *
    `;
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
}