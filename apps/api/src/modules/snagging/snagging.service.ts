import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { NotificationsService } from '../notifications/notifications.service';
import { StorageService } from '../storage/storage.service';
import type { CreateSnagItemDto } from './dto/create-snag-item.dto';
import type { UpdateSnagItemDto } from './dto/update-snag-item.dto';
import type { AddSnagActivityDto } from './dto/add-snag-activity.dto';
import type { ForwardSnagDto } from './dto/forward-snag.dto';
import type { ForceSnagStatusDto } from './dto/force-snag-status.dto';
import type { SnagAttachmentUploadUrlDto } from './dto/snag-attachment-upload-url.dto';
import type { AddSnagAttachmentDto } from './dto/add-snag-attachment.dto';
import { ATTACHMENT_MAX_SIZE as SNAG_ATTACHMENT_MAX_SIZE, ATTACHMENT_ALLOWED_EXTENSIONS as SNAG_ATTACHMENT_ALLOWED_EXTENSIONS } from '../../common/constants/attachment-limits';
import type { PaginationQuery } from '@engineeringos/types';

@Injectable()
export class SnaggingService {
  constructor(
    private readonly db: DatabaseService,
    private readonly notifications: NotificationsService,
    private readonly storage: StorageService,
  ) {}

  // withTenant required for the projects lookup -- projects carries the tenant_isolation
  // RLS policy. A plain this.db.query() never sets app.current_company_id, so under any DB
  // role that isn't the table owner/a superuser this SELECT sees no rows and silently falls
  // back to the generic 'PRJ' prefix instead of the real project code.
  private async generateSnagNumber(companyId: string, projectId: string): Promise<string> {
    return this.db.withTenant(companyId, async (sql) => {
      const [proj] = await sql`SELECT code FROM projects WHERE id = ${projectId} AND company_id = ${companyId}`;
      const prefix = (proj?.code as string ?? 'PRJ').toUpperCase();
      const [cnt] = await sql`SELECT COUNT(*) AS n FROM snag_items WHERE project_id = ${projectId}`;
      const seq = String(Number(cnt.n) + 1).padStart(4, '0');
      return `${prefix}-SNAG-${seq}`;
    });
  }

  async create(companyId: string, projectId: string, userId: string, dto: CreateSnagItemDto) {
    const snagNumber = await this.generateSnagNumber(companyId, projectId);
    const [snag] = await this.db.query`
      INSERT INTO snag_items (
        company_id, project_id, snag_number, title, description, location, location_id,
        trade, priority, assigned_to, due_date, status, created_by
      ) VALUES (
        ${companyId}, ${projectId}, ${snagNumber}, ${dto.title}, ${dto.description ?? null},
        ${dto.location ?? null}, ${dto.locationId ?? null}, ${dto.trade ?? null}, ${dto.priority ?? 'medium'},
        ${dto.assignedTo ?? null}, ${dto.dueDate ?? null}, 'open', ${userId}
      )
      RETURNING *`;

    if (dto.assignedTo && dto.assignedTo !== userId) {
      await this.notifications.create(companyId, {
        userId: dto.assignedTo,
        type: 'snag_assigned',
        title: `You were assigned snag item ${snagNumber}: ${dto.title}`,
        resourceType: 'snag_item',
        projectId,
        resourceId: snag.id as string,
        createdBy: userId,
      });
    }

    return snag;
  }

  async findAll(companyId: string, projectId: string, query: PaginationQuery & { status?: string; priority?: string }) {
    const page    = query.page ?? 1;
    const perPage = Math.min(query.perPage ?? 20, 100);
    const offset  = (page - 1) * perPage;

    const rows = await this.db.withTenant(companyId, sql => sql`
      SELECT s.*,
        u_c.first_name || ' ' || u_c.last_name AS created_by_name,
        u_a.first_name || ' ' || u_a.last_name AS assigned_to_name,
        COUNT(*) OVER() AS full_count
      FROM snag_items s
      LEFT JOIN users u_c ON u_c.id = s.created_by
      LEFT JOIN users u_a ON u_a.id = s.assigned_to
      WHERE s.project_id = ${projectId} AND s.company_id = ${companyId}
        AND (${query.status ?? null}::text IS NULL OR s.status = ${query.status ?? null})
        AND (${query.priority ?? null}::text IS NULL OR s.priority = ${query.priority ?? null})
      ORDER BY
        CASE s.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
        s.created_at DESC
      LIMIT ${perPage} OFFSET ${offset}
    `);

    return this.db.paginate(rows, page, perPage);
  }

  async findOne(companyId: string, projectId: string, snagId: string) {
    const [snag] = await this.db.withTenant(companyId, sql => sql`
      SELECT s.*,
        u_c.first_name || ' ' || u_c.last_name AS created_by_name,
        u_a.first_name || ' ' || u_a.last_name AS assigned_to_name
      FROM snag_items s
      LEFT JOIN users u_c ON u_c.id = s.created_by
      LEFT JOIN users u_a ON u_a.id = s.assigned_to
      WHERE s.id = ${snagId} AND s.project_id = ${projectId} AND s.company_id = ${companyId}
    `);
    if (!snag) throw new NotFoundException(`Snag item ${snagId} not found.`);
    return snag;
  }

  async update(companyId: string, projectId: string, snagId: string, userId: string, dto: UpdateSnagItemDto) {
    const existing = await this.findOne(companyId, projectId, snagId);
    // The two-step closure this feature is built around: a trade marks an
    // item 'fixed', then a supervisor 'verifies' it separately -- each
    // transition stamps its own timestamp/actor, and only fires once (a
    // status update that doesn't actually cross that specific transition,
    // e.g. re-saving while already 'fixed', must not re-stamp it).
    const isBeingFixed = Boolean(dto.status === 'fixed' && existing.status !== 'fixed');
    const isBeingVerified = Boolean(dto.status === 'verified' && existing.status !== 'verified');

    const [updated] = await this.db.query`
      UPDATE snag_items SET
        title       = COALESCE(${dto.title ?? null}, title),
        description = COALESCE(${dto.description ?? null}, description),
        location    = COALESCE(${dto.location ?? null}, location),
        trade       = COALESCE(${dto.trade ?? null}, trade),
        priority    = COALESCE(${dto.priority ?? null}, priority),
        status      = COALESCE(${dto.status ?? null}, status),
        assigned_to = COALESCE(${dto.assignedTo ?? null}::uuid, assigned_to),
        due_date    = COALESCE(${dto.dueDate ?? null}::timestamptz, due_date),
        fixed_at    = CASE WHEN ${isBeingFixed} THEN NOW() ELSE fixed_at END,
        fixed_by    = CASE WHEN ${isBeingFixed} THEN ${userId}::uuid ELSE fixed_by END,
        verified_at = CASE WHEN ${isBeingVerified} THEN NOW() ELSE verified_at END,
        verified_by = CASE WHEN ${isBeingVerified} THEN ${userId}::uuid ELSE verified_by END,
        updated_at  = NOW()
      WHERE id = ${snagId} AND project_id = ${projectId} AND company_id = ${companyId}
      RETURNING *
    `;

    // Log status change activity automatically -- mirrors IssuesService.update()'s
    // existing behavior for issues, added here now for snag items too.
    if (dto.status && dto.status !== existing.status) {
      await this.addActivity(companyId, snagId, userId, {
        activityType: 'status_change',
        fromValue: existing.status as string,
        toValue: dto.status,
      });
    }

    return updated;
  }

  async delete(companyId: string, projectId: string, snagId: string) {
    await this.db.query`DELETE FROM snag_items WHERE id = ${snagId} AND project_id = ${projectId} AND company_id = ${companyId}`;
    return { message: 'Snag item deleted.' };
  }

  async getSummary(companyId: string, projectId: string) {
    const [summary] = await this.db.withTenant(companyId, sql => sql`
      SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE status = 'open') AS open,
        COUNT(*) FILTER (WHERE status = 'fixed') AS fixed,
        COUNT(*) FILTER (WHERE status = 'verified') AS verified,
        COUNT(*) FILTER (WHERE due_date < NOW() AND status IN ('open', 'fixed')) AS overdue
      FROM snag_items
      WHERE project_id = ${projectId} AND company_id = ${companyId}
    `);
    return summary;
  }

  // ── Reports KPI breakdown ────────────────────────────────────────────────
  // Sibling to getSummary() above -- same reasoning as
  // IssuesService.getKpiBreakdown(): getSummary()'s shape is left untouched
  // since other pages already depend on it. Same GROUP BY / fold-in-JS
  // pattern, keyed on trade instead of discipline.
  async getKpiBreakdown(companyId: string, projectId: string) {
    const rows = await this.db.withTenant(companyId, sql => sql`
      SELECT status, priority, trade, COUNT(*) AS count
      FROM snag_items
      WHERE project_id = ${projectId} AND company_id = ${companyId}
      GROUP BY status, priority, trade
    `);

    const byStatus: Record<string, number> = {};
    const byPriority: Record<string, number> = {};
    const byTrade: Record<string, number> = {};
    for (const row of rows) {
      const count = Number(row.count);
      const status = row.status as string;
      const priority = row.priority as string;
      const trade = (row.trade as string | null) ?? 'other';
      byStatus[status] = (byStatus[status] ?? 0) + count;
      byPriority[priority] = (byPriority[priority] ?? 0) + count;
      byTrade[trade] = (byTrade[trade] ?? 0) + count;
    }
    return { byStatus, byPriority, byTrade };
  }

  // Mirrors findAll()'s join pattern (assigned_to_name via u_a) -- used by
  // the Reports KPI dashboard/PDF for its "currently open" table. 'open'/
  // 'fixed' matches this codebase's own definition of "active" snag items
  // (see getSummary()'s overdue filter above).
  async getOpenList(companyId: string, projectId: string, limit = 50) {
    return this.db.withTenant(companyId, sql => sql`
      SELECT
        s.id, s.snag_number, s.title, s.status, s.priority, s.trade, s.location, s.due_date,
        u_a.first_name || ' ' || u_a.last_name AS assigned_to_name
      FROM snag_items s
      LEFT JOIN users u_a ON u_a.id = s.assigned_to
      WHERE s.project_id = ${projectId} AND s.company_id = ${companyId}
        AND s.status IN ('open', 'fixed')
      ORDER BY
        CASE s.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
        s.created_at DESC
      LIMIT ${limit}
    `);
  }

  // ══════════════════════════════════════════════════════════════════════
  // Workflow actions -- mirrors IssuesService's equivalent methods exactly
  // in structure, differing only in table/column names.
  // ══════════════════════════════════════════════════════════════════════

  // ── Activities ────────────────────────────────────────────────────────────
  async getActivities(companyId: string, snagId: string) {
    const activities = await this.db.withTenant(companyId, sql => sql`
      SELECT a.*, u.first_name || ' ' || u.last_name AS performed_by_name, u.avatar_url
      FROM snag_activities a
      JOIN users u ON u.id = a.performed_by
      WHERE a.snag_item_id = ${snagId} AND a.company_id = ${companyId}
      ORDER BY a.created_at ASC
    `);

    // attachment_url stores the raw storage key, not a usable link (see
    // addAttachment() below) -- resolve it to a presigned read URL under a
    // *different* field (attachmentReadUrl), same pattern as
    // issues.service.ts's getActivities().
    return Promise.all(activities.map(async (activity) => {
      if (!activity.attachmentUrl) return activity;
      return { ...activity, attachmentReadUrl: await this.storage.getReadUrl(activity.attachmentUrl as string) };
    }));
  }

  async addActivity(companyId: string, snagId: string, userId: string, dto: AddSnagActivityDto) {
    return this.db.withTenant(companyId, async (sql) => {
      const [activity] = await sql`
        INSERT INTO snag_activities (
          snag_item_id, company_id, activity_type, content,
          from_value, to_value, performed_by
        ) VALUES (
          ${snagId}, ${companyId}, ${dto.activityType}, ${dto.content ?? null},
          ${dto.fromValue ?? null}, ${dto.toValue ?? null}, ${userId}
        )
        RETURNING *
      `;
      // Update snag item updated_at
      await sql`UPDATE snag_items SET updated_at = NOW() WHERE id = ${snagId} AND company_id = ${companyId}`;
      return activity;
    });
  }

  // ── Forward ─────────────────────────────────────────────────────────────
  // Reassigns the snag item to another user and logs a 'forward' activity.
  async forward(companyId: string, projectId: string, snagId: string, userId: string, dto: ForwardSnagDto) {
    const existing = await this.findOne(companyId, projectId, snagId);

    const [updated] = await this.db.withTenant(companyId, sql => sql`
      UPDATE snag_items SET assigned_to = ${dto.toUserId}::uuid, updated_at = NOW()
      WHERE id = ${snagId} AND project_id = ${projectId} AND company_id = ${companyId}
      RETURNING *
    `);

    await this.addActivity(companyId, snagId, userId, {
      activityType: 'forward',
      fromValue: (existing.assignedTo as string | null) ?? undefined,
      toValue: dto.toUserId,
      content: dto.comment,
    });

    if (dto.toUserId !== userId) {
      await this.notifications.create(companyId, {
        userId: dto.toUserId,
        type: 'snag_assigned',
        title: `Snag item ${existing.snagNumber as string} was forwarded to you: ${existing.title as string}`,
        resourceType: 'snag_item',
        resourceId: snagId,
        projectId,
        createdBy: userId,
      });
    }

    return updated;
  }

  // ── Admin force-status ─────────────────────────────────────────────────
  // Bypasses the normal update() path entirely -- distinct, @Roles-gated
  // path that logs a dedicated 'status_force' activity instead of
  // 'status_change'. Snag items have no closed_at/closed_by columns (see
  // 018_snag_items.sql) -- but they DO have fixed_at/fixed_by/verified_at/
  // verified_by, which update() (above) already stamps on the equivalent
  // transitions. Bypassing that bookkeeping here left a real gap: a force-
  // verified snag showed the "Verified" badge with no verified date/actor,
  // a misleading audit trail. Mirrors update()'s isBeingFixed/isBeingVerified
  // pattern exactly.
  async forceStatus(companyId: string, projectId: string, snagId: string, userId: string, dto: ForceSnagStatusDto) {
    const existing = await this.findOne(companyId, projectId, snagId);
    const isBeingFixed = Boolean(dto.status === 'fixed' && existing.status !== 'fixed');
    const isBeingVerified = Boolean(dto.status === 'verified' && existing.status !== 'verified');

    const [updated] = await this.db.withTenant(companyId, sql => sql`
      UPDATE snag_items SET
        status      = ${dto.status},
        fixed_at    = CASE WHEN ${isBeingFixed} THEN NOW() ELSE fixed_at END,
        fixed_by    = CASE WHEN ${isBeingFixed} THEN ${userId}::uuid ELSE fixed_by END,
        verified_at = CASE WHEN ${isBeingVerified} THEN NOW() ELSE verified_at END,
        verified_by = CASE WHEN ${isBeingVerified} THEN ${userId}::uuid ELSE verified_by END,
        updated_at  = NOW()
      WHERE id = ${snagId} AND project_id = ${projectId} AND company_id = ${companyId}
      RETURNING *
    `);

    await this.addActivity(companyId, snagId, userId, {
      activityType: 'status_force',
      fromValue: existing.status as string,
      toValue: dto.status,
    });

    return updated;
  }

  // ── Attachments ─────────────────────────────────────────────────────────
  // Step 1 of the presigned-PUT pattern: validate extension + declared
  // size, then hand back a presigned PUT URL. The client uploads directly
  // to storage; our API never sees the file bytes.
  async getAttachmentUploadUrl(companyId: string, projectId: string, dto: SnagAttachmentUploadUrlDto) {
    const ext = dto.filename.split('.').pop()?.toLowerCase() ?? '';
    if (!SNAG_ATTACHMENT_ALLOWED_EXTENSIONS.has(ext)) {
      throw new BadRequestException(
        `File type ".${ext}" is not supported. Allowed: ${[...SNAG_ATTACHMENT_ALLOWED_EXTENSIONS].join(', ')}.`,
      );
    }
    if (dto.sizeBytes > SNAG_ATTACHMENT_MAX_SIZE) {
      throw new BadRequestException(
        `File too large (${(dto.sizeBytes / 1024 / 1024).toFixed(1)} MB). Max: ${SNAG_ATTACHMENT_MAX_SIZE / 1024 / 1024} MB.`,
      );
    }

    const key = this.storage.generateKey(companyId, projectId, 'snag-items', dto.filename);
    const { uploadUrl } = await this.storage.getUploadUrl(key, 'application/octet-stream', dto.sizeBytes);
    return { uploadUrl, storageKey: key };
  }

  // Step 2: client already PUT the bytes to `storageKey` from step 1 --
  // this registers it as a new snag_activities row. attachment_url stores
  // the storage key (not a raw presigned URL, which would expire), resolved
  // to a live presigned URL by getActivities() when needed.
  async addAttachment(companyId: string, snagId: string, userId: string, dto: AddSnagAttachmentDto) {
    return this.db.withTenant(companyId, async (sql) => {
      const [activity] = await sql`
        INSERT INTO snag_activities (
          snag_item_id, company_id, activity_type, content,
          attachment_url, attachment_name, attachment_size_bytes, performed_by
        ) VALUES (
          ${snagId}, ${companyId}, 'comment', ${dto.comment ?? `Attached file: ${dto.filename}`},
          ${dto.storageKey}, ${dto.filename}, ${dto.sizeBytes}, ${userId}
        )
        RETURNING *
      `;
      await sql`UPDATE snag_items SET updated_at = NOW() WHERE id = ${snagId} AND company_id = ${companyId}`;
      return activity;
    });
  }
}
