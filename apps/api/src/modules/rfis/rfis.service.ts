import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { NotificationsService } from '../notifications/notifications.service';
import type { CreateRfiDto } from './dto/create-rfi.dto';
import type { UpdateRfiDto } from './dto/update-rfi.dto';
import type { PaginationQuery } from '@engineeringos/types';

@Injectable()
export class RfisService {
  constructor(
    private readonly db: DatabaseService,
    private readonly notifications: NotificationsService,
  ) {}

  private async generateRfiNumber(projectId: string): Promise<string> {
    const [proj] = await this.db.query`SELECT code FROM projects WHERE id = ${projectId}`;
    const prefix = (proj?.code as string ?? 'PRJ').toUpperCase();
    const [cnt] = await this.db.query`SELECT COUNT(*) AS n FROM rfis WHERE project_id = ${projectId}`;
    const seq = String(Number(cnt.n) + 1).padStart(4, '0');
    return `${prefix}-RFI-${seq}`;
  }

  async create(companyId: string, projectId: string, userId: string, dto: CreateRfiDto) {
    const rfiNumber = await this.generateRfiNumber(projectId);
    const [rfi] = await this.db.query`
      INSERT INTO rfis (
        company_id, project_id, rfi_number, subject, question,
        priority, discipline, assigned_to, due_date, status, created_by
      ) VALUES (
        ${companyId}, ${projectId}, ${rfiNumber}, ${dto.subject}, ${dto.question},
        ${dto.priority ?? 'medium'}, ${dto.discipline ?? null}, ${dto.assignedTo ?? null},
        ${dto.dueDate ?? null}, 'open', ${userId}
      )
      RETURNING *`;

    if (dto.assignedTo && dto.assignedTo !== userId) {
      await this.notifications.create(companyId, {
        userId: dto.assignedTo,
        type: 'rfi_assigned',
        title: `You were assigned to RFI ${rfiNumber}: ${dto.subject}`,
        resourceType: 'rfi',
        resourceId: rfi.id as string,
        createdBy: userId,
      });
    }

    return rfi;
  }

  async findAll(companyId: string, projectId: string, query: PaginationQuery & { status?: string; priority?: string }) {
    const page    = query.page ?? 1;
    const perPage = Math.min(query.perPage ?? 20, 100);
    const offset  = (page - 1) * perPage;

    const rows = await this.db.withTenant(companyId, sql => sql`
      SELECT r.*,
        u_c.first_name || ' ' || u_c.last_name AS created_by_name,
        u_a.first_name || ' ' || u_a.last_name AS assigned_to_name,
        COUNT(*) OVER() AS full_count
      FROM rfis r
      LEFT JOIN users u_c ON u_c.id = r.created_by
      LEFT JOIN users u_a ON u_a.id = r.assigned_to
      WHERE r.project_id = ${projectId} AND r.company_id = ${companyId}
        AND (${query.status ?? null}::text IS NULL OR r.status = ${query.status ?? null})
        AND (${query.priority ?? null}::text IS NULL OR r.priority = ${query.priority ?? null})
      ORDER BY
        CASE r.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
        r.created_at DESC
      LIMIT ${perPage} OFFSET ${offset}
    `);

    return this.db.paginate(rows, page, perPage);
  }

  async findOne(companyId: string, projectId: string, rfiId: string) {
    const [rfi] = await this.db.withTenant(companyId, sql => sql`
      SELECT r.*,
        u_c.first_name || ' ' || u_c.last_name AS created_by_name,
        u_a.first_name || ' ' || u_a.last_name AS assigned_to_name
      FROM rfis r
      LEFT JOIN users u_c ON u_c.id = r.created_by
      LEFT JOIN users u_a ON u_a.id = r.assigned_to
      WHERE r.id = ${rfiId} AND r.project_id = ${projectId} AND r.company_id = ${companyId}
    `);
    if (!rfi) throw new NotFoundException(`RFI ${rfiId} not found.`);
    return rfi;
  }

  async update(companyId: string, projectId: string, rfiId: string, userId: string, dto: UpdateRfiDto) {
    const existing = await this.findOne(companyId, projectId, rfiId);
    const isAnswering = dto.status === 'answered' && existing.status !== 'answered';

    const [updated] = await this.db.query`
      UPDATE rfis SET
        subject     = COALESCE(${dto.subject ?? null}, subject),
        question    = COALESCE(${dto.question ?? null}, question),
        answer      = COALESCE(${dto.answer ?? null}, answer),
        status      = COALESCE(${dto.status ?? null}, status),
        priority    = COALESCE(${dto.priority ?? null}, priority),
        discipline  = COALESCE(${dto.discipline ?? null}, discipline),
        assigned_to = COALESCE(${dto.assignedTo ?? null}::uuid, assigned_to),
        due_date    = COALESCE(${dto.dueDate ?? null}::timestamptz, due_date),
        answered_at = CASE WHEN ${isAnswering} THEN NOW() ELSE answered_at END,
        answered_by = CASE WHEN ${isAnswering} THEN ${userId}::uuid ELSE answered_by END,
        updated_at  = NOW()
      WHERE id = ${rfiId} AND project_id = ${projectId} AND company_id = ${companyId}
      RETURNING *
    `;
    return updated;
  }

  async delete(companyId: string, projectId: string, rfiId: string) {
    await this.db.query`DELETE FROM rfis WHERE id = ${rfiId} AND project_id = ${projectId} AND company_id = ${companyId}`;
    return { message: 'RFI deleted.' };
  }

  async getSummary(companyId: string, projectId: string) {
    const [summary] = await this.db.withTenant(companyId, sql => sql`
      SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE status = 'open') AS open,
        COUNT(*) FILTER (WHERE status = 'answered') AS answered,
        COUNT(*) FILTER (WHERE due_date < NOW() AND status NOT IN ('closed','void','answered')) AS overdue
      FROM rfis
      WHERE project_id = ${projectId} AND company_id = ${companyId}
    `);
    return summary;
  }
}
