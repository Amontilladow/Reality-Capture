import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { NotificationsService } from '../notifications/notifications.service';
import type { CreateSnagItemDto } from './dto/create-snag-item.dto';
import type { UpdateSnagItemDto } from './dto/update-snag-item.dto';
import type { PaginationQuery } from '@engineeringos/types';

@Injectable()
export class SnaggingService {
  constructor(
    private readonly db: DatabaseService,
    private readonly notifications: NotificationsService,
  ) {}

  private async generateSnagNumber(projectId: string): Promise<string> {
    const [proj] = await this.db.query`SELECT code FROM projects WHERE id = ${projectId}`;
    const prefix = (proj?.code as string ?? 'PRJ').toUpperCase();
    const [cnt] = await this.db.query`SELECT COUNT(*) AS n FROM snag_items WHERE project_id = ${projectId}`;
    const seq = String(Number(cnt.n) + 1).padStart(4, '0');
    return `${prefix}-SNAG-${seq}`;
  }

  async create(companyId: string, projectId: string, userId: string, dto: CreateSnagItemDto) {
    const snagNumber = await this.generateSnagNumber(projectId);
    const [snag] = await this.db.query`
      INSERT INTO snag_items (
        company_id, project_id, snag_number, title, description, location,
        trade, priority, assigned_to, due_date, status, created_by
      ) VALUES (
        ${companyId}, ${projectId}, ${snagNumber}, ${dto.title}, ${dto.description ?? null},
        ${dto.location ?? null}, ${dto.trade ?? null}, ${dto.priority ?? 'medium'},
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
}
