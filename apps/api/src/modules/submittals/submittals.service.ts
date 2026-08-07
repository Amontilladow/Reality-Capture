import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { NotificationsService } from '../notifications/notifications.service';
import type { CreateSubmittalDto } from './dto/create-submittal.dto';
import type { UpdateSubmittalDto } from './dto/update-submittal.dto';
import type { PaginationQuery } from '@engineeringos/types';

const REVIEW_OUTCOMES = new Set(['approved', 'approved_as_noted', 'revise_and_resubmit', 'rejected']);

@Injectable()
export class SubmittalsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly notifications: NotificationsService,
  ) {}

  private async generateSubmittalNumber(projectId: string): Promise<string> {
    const [proj] = await this.db.query`SELECT code FROM projects WHERE id = ${projectId}`;
    const prefix = (proj?.code as string ?? 'PRJ').toUpperCase();
    const [cnt] = await this.db.query`SELECT COUNT(*) AS n FROM submittals WHERE project_id = ${projectId}`;
    const seq = String(Number(cnt.n) + 1).padStart(4, '0');
    return `${prefix}-SUB-${seq}`;
  }

  async create(companyId: string, projectId: string, userId: string, dto: CreateSubmittalDto) {
    const submittalNumber = await this.generateSubmittalNumber(projectId);
    const [submittal] = await this.db.query`
      INSERT INTO submittals (
        company_id, project_id, submittal_number, title, spec_section, description,
        priority, discipline, revision, assigned_to, due_date, status, created_by
      ) VALUES (
        ${companyId}, ${projectId}, ${submittalNumber}, ${dto.title}, ${dto.specSection ?? null},
        ${dto.description ?? null}, ${dto.priority ?? 'medium'}, ${dto.discipline ?? null},
        ${dto.revision ?? null}, ${dto.assignedTo ?? null}, ${dto.dueDate ?? null},
        'submitted', ${userId}
      )
      RETURNING *`;

    if (dto.assignedTo && dto.assignedTo !== userId) {
      await this.notifications.create(companyId, {
        userId: dto.assignedTo,
        type: 'submittal_assigned',
        title: `You were assigned to review submittal ${submittalNumber}: ${dto.title}`,
        resourceType: 'submittal',
        projectId,
        resourceId: submittal.id as string,
        createdBy: userId,
      });
    }

    return submittal;
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
      FROM submittals s
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

  async findOne(companyId: string, projectId: string, submittalId: string) {
    const [submittal] = await this.db.withTenant(companyId, sql => sql`
      SELECT s.*,
        u_c.first_name || ' ' || u_c.last_name AS created_by_name,
        u_a.first_name || ' ' || u_a.last_name AS assigned_to_name
      FROM submittals s
      LEFT JOIN users u_c ON u_c.id = s.created_by
      LEFT JOIN users u_a ON u_a.id = s.assigned_to
      WHERE s.id = ${submittalId} AND s.project_id = ${projectId} AND s.company_id = ${companyId}
    `);
    if (!submittal) throw new NotFoundException(`Submittal ${submittalId} not found.`);
    return submittal;
  }

  async update(companyId: string, projectId: string, submittalId: string, userId: string, dto: UpdateSubmittalDto) {
    const existing = await this.findOne(companyId, projectId, submittalId);
    const isReviewing = Boolean(dto.status && REVIEW_OUTCOMES.has(dto.status) && existing.status !== dto.status);

    const [updated] = await this.db.query`
      UPDATE submittals SET
        title           = COALESCE(${dto.title ?? null}, title),
        spec_section    = COALESCE(${dto.specSection ?? null}, spec_section),
        description     = COALESCE(${dto.description ?? null}, description),
        status          = COALESCE(${dto.status ?? null}, status),
        priority        = COALESCE(${dto.priority ?? null}, priority),
        discipline      = COALESCE(${dto.discipline ?? null}, discipline),
        revision        = COALESCE(${dto.revision ?? null}, revision),
        assigned_to     = COALESCE(${dto.assignedTo ?? null}::uuid, assigned_to),
        due_date        = COALESCE(${dto.dueDate ?? null}::timestamptz, due_date),
        review_comments = COALESCE(${dto.reviewComments ?? null}, review_comments),
        reviewed_at     = CASE WHEN ${isReviewing} THEN NOW() ELSE reviewed_at END,
        reviewed_by     = CASE WHEN ${isReviewing} THEN ${userId}::uuid ELSE reviewed_by END,
        updated_at      = NOW()
      WHERE id = ${submittalId} AND project_id = ${projectId} AND company_id = ${companyId}
      RETURNING *
    `;
    return updated;
  }

  async delete(companyId: string, projectId: string, submittalId: string) {
    await this.db.query`DELETE FROM submittals WHERE id = ${submittalId} AND project_id = ${projectId} AND company_id = ${companyId}`;
    return { message: 'Submittal deleted.' };
  }

  async getSummary(companyId: string, projectId: string) {
    const [summary] = await this.db.withTenant(companyId, sql => sql`
      SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE status IN ('submitted', 'under_review')) AS pending,
        COUNT(*) FILTER (WHERE status IN ('approved', 'approved_as_noted')) AS approved,
        COUNT(*) FILTER (WHERE due_date < NOW() AND status IN ('submitted','under_review')) AS overdue
      FROM submittals
      WHERE project_id = ${projectId} AND company_id = ${companyId}
    `);
    return summary;
  }
}
