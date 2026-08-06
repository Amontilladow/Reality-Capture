import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import type { CreateQaInspectionDto } from './dto/create-qa-inspection.dto';
import type { UpdateQaInspectionDto } from './dto/update-qa-inspection.dto';
import type { PaginationQuery } from '@engineeringos/types';

const OUTCOMES = new Set(['passed', 'passed_with_exceptions', 'failed']);

@Injectable()
export class QaService {
  constructor(private readonly db: DatabaseService) {}

  private async generateInspectionNumber(projectId: string): Promise<string> {
    const [proj] = await this.db.query`SELECT code FROM projects WHERE id = ${projectId}`;
    const prefix = (proj?.code as string ?? 'PRJ').toUpperCase();
    const [cnt] = await this.db.query`SELECT COUNT(*) AS n FROM qa_inspections WHERE project_id = ${projectId}`;
    const seq = String(Number(cnt.n) + 1).padStart(4, '0');
    return `${prefix}-QAQC-${seq}`;
  }

  async create(companyId: string, projectId: string, userId: string, dto: CreateQaInspectionDto) {
    const inspectionNumber = await this.generateInspectionNumber(projectId);
    const [inspection] = await this.db.query`
      INSERT INTO qa_inspections (
        company_id, project_id, inspection_number, title, inspection_type, location,
        checklist, assigned_to, inspection_date, status, created_by
      ) VALUES (
        ${companyId}, ${projectId}, ${inspectionNumber}, ${dto.title}, ${dto.inspectionType ?? null},
        ${dto.location ?? null}, ${dto.checklist}, ${dto.assignedTo ?? null},
        ${dto.inspectionDate ?? null}, 'scheduled', ${userId}
      )
      RETURNING *`;
    return inspection;
  }

  async findAll(companyId: string, projectId: string, query: PaginationQuery & { status?: string }) {
    const page    = query.page ?? 1;
    const perPage = Math.min(query.perPage ?? 20, 100);
    const offset  = (page - 1) * perPage;

    const rows = await this.db.withTenant(companyId, sql => sql`
      SELECT q.*,
        u_c.first_name || ' ' || u_c.last_name AS created_by_name,
        u_a.first_name || ' ' || u_a.last_name AS assigned_to_name,
        COUNT(*) OVER() AS full_count
      FROM qa_inspections q
      LEFT JOIN users u_c ON u_c.id = q.created_by
      LEFT JOIN users u_a ON u_a.id = q.assigned_to
      WHERE q.project_id = ${projectId} AND q.company_id = ${companyId}
        AND (${query.status ?? null}::text IS NULL OR q.status = ${query.status ?? null})
      ORDER BY q.created_at DESC
      LIMIT ${perPage} OFFSET ${offset}
    `);

    return this.db.paginate(rows, page, perPage);
  }

  async findOne(companyId: string, projectId: string, inspectionId: string) {
    const [inspection] = await this.db.withTenant(companyId, sql => sql`
      SELECT q.*,
        u_c.first_name || ' ' || u_c.last_name AS created_by_name,
        u_a.first_name || ' ' || u_a.last_name AS assigned_to_name
      FROM qa_inspections q
      LEFT JOIN users u_c ON u_c.id = q.created_by
      LEFT JOIN users u_a ON u_a.id = q.assigned_to
      WHERE q.id = ${inspectionId} AND q.project_id = ${projectId} AND q.company_id = ${companyId}
    `);
    if (!inspection) throw new NotFoundException(`Inspection ${inspectionId} not found.`);
    return inspection;
  }

  async update(companyId: string, projectId: string, inspectionId: string, userId: string, dto: UpdateQaInspectionDto) {
    const existing = await this.findOne(companyId, projectId, inspectionId);
    const isCompleting = Boolean(dto.status && OUTCOMES.has(dto.status) && existing.status !== dto.status);

    const [updated] = await this.db.query`
      UPDATE qa_inspections SET
        title            = COALESCE(${dto.title ?? null}, title),
        inspection_type  = COALESCE(${dto.inspectionType ?? null}, inspection_type),
        location         = COALESCE(${dto.location ?? null}, location),
        checklist        = COALESCE(${dto.checklist ?? null}, checklist),
        findings         = COALESCE(${dto.findings ?? null}, findings),
        status           = COALESCE(${dto.status ?? null}, status),
        assigned_to      = COALESCE(${dto.assignedTo ?? null}::uuid, assigned_to),
        inspection_date  = COALESCE(${dto.inspectionDate ?? null}::timestamptz, inspection_date),
        completed_at     = CASE WHEN ${isCompleting} THEN NOW() ELSE completed_at END,
        completed_by     = CASE WHEN ${isCompleting} THEN ${userId}::uuid ELSE completed_by END,
        updated_at       = NOW()
      WHERE id = ${inspectionId} AND project_id = ${projectId} AND company_id = ${companyId}
      RETURNING *
    `;
    return updated;
  }

  async delete(companyId: string, projectId: string, inspectionId: string) {
    await this.db.query`DELETE FROM qa_inspections WHERE id = ${inspectionId} AND project_id = ${projectId} AND company_id = ${companyId}`;
    return { message: 'Inspection deleted.' };
  }

  async getSummary(companyId: string, projectId: string) {
    const [summary] = await this.db.withTenant(companyId, sql => sql`
      SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE status IN ('scheduled', 'in_progress')) AS pending,
        COUNT(*) FILTER (WHERE status = 'passed' OR status = 'passed_with_exceptions') AS passed,
        COUNT(*) FILTER (WHERE status = 'failed') AS failed
      FROM qa_inspections
      WHERE project_id = ${projectId} AND company_id = ${companyId}
    `);
    return summary;
  }
}
