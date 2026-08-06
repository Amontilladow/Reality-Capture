import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import type { CreateTransmittalDto } from './dto/create-transmittal.dto';
import type { UpdateTransmittalDto } from './dto/update-transmittal.dto';
import type { PaginationQuery } from '@engineeringos/types';

@Injectable()
export class TransmittalsService {
  constructor(private readonly db: DatabaseService) {}

  private async generateTransmittalNumber(projectId: string): Promise<string> {
    const [proj] = await this.db.query`SELECT code FROM projects WHERE id = ${projectId}`;
    const prefix = (proj?.code as string ?? 'PRJ').toUpperCase();
    const [cnt] = await this.db.query`SELECT COUNT(*) AS n FROM transmittals WHERE project_id = ${projectId}`;
    const seq = String(Number(cnt.n) + 1).padStart(4, '0');
    return `${prefix}-TRN-${seq}`;
  }

  async create(companyId: string, projectId: string, userId: string, dto: CreateTransmittalDto) {
    const transmittalNumber = await this.generateTransmittalNumber(projectId);
    const [transmittal] = await this.db.query`
      INSERT INTO transmittals (
        company_id, project_id, transmittal_number, subject, recipient_name, recipient_company,
        purpose, items, notes, due_date, status, created_by
      ) VALUES (
        ${companyId}, ${projectId}, ${transmittalNumber}, ${dto.subject}, ${dto.recipientName},
        ${dto.recipientCompany ?? null}, ${dto.purpose ?? 'for_review'}, ${dto.items},
        ${dto.notes ?? null}, ${dto.dueDate ?? null}, 'draft', ${userId}
      )
      RETURNING *`;
    return transmittal;
  }

  async findAll(companyId: string, projectId: string, query: PaginationQuery & { status?: string; purpose?: string }) {
    const page    = query.page ?? 1;
    const perPage = Math.min(query.perPage ?? 20, 100);
    const offset  = (page - 1) * perPage;

    const rows = await this.db.withTenant(companyId, sql => sql`
      SELECT t.*,
        u_c.first_name || ' ' || u_c.last_name AS created_by_name,
        COUNT(*) OVER() AS full_count
      FROM transmittals t
      LEFT JOIN users u_c ON u_c.id = t.created_by
      WHERE t.project_id = ${projectId} AND t.company_id = ${companyId}
        AND (${query.status ?? null}::text IS NULL OR t.status = ${query.status ?? null})
        AND (${query.purpose ?? null}::text IS NULL OR t.purpose = ${query.purpose ?? null})
      ORDER BY t.created_at DESC
      LIMIT ${perPage} OFFSET ${offset}
    `);

    return this.db.paginate(rows, page, perPage);
  }

  async findOne(companyId: string, projectId: string, transmittalId: string) {
    const [transmittal] = await this.db.withTenant(companyId, sql => sql`
      SELECT t.*,
        u_c.first_name || ' ' || u_c.last_name AS created_by_name
      FROM transmittals t
      LEFT JOIN users u_c ON u_c.id = t.created_by
      WHERE t.id = ${transmittalId} AND t.project_id = ${projectId} AND t.company_id = ${companyId}
    `);
    if (!transmittal) throw new NotFoundException(`Transmittal ${transmittalId} not found.`);
    return transmittal;
  }

  async update(companyId: string, projectId: string, transmittalId: string, dto: UpdateTransmittalDto) {
    const existing = await this.findOne(companyId, projectId, transmittalId);
    // sent_date is set the first time a transmittal moves to 'sent' -- a
    // re-send (already sent, staying sent) or moving straight to
    // 'acknowledged'/'void' from 'draft' shouldn't overwrite or backfill it.
    const justSent = Boolean(dto.status === 'sent' && existing.status !== 'sent' && !existing.sentDate);

    const [updated] = await this.db.query`
      UPDATE transmittals SET
        subject           = COALESCE(${dto.subject ?? null}, subject),
        recipient_name    = COALESCE(${dto.recipientName ?? null}, recipient_name),
        recipient_company = COALESCE(${dto.recipientCompany ?? null}, recipient_company),
        purpose           = COALESCE(${dto.purpose ?? null}, purpose),
        items             = COALESCE(${dto.items ?? null}, items),
        notes             = COALESCE(${dto.notes ?? null}, notes),
        status            = COALESCE(${dto.status ?? null}, status),
        due_date          = COALESCE(${dto.dueDate ?? null}::timestamptz, due_date),
        sent_date         = CASE WHEN ${justSent} THEN NOW() ELSE sent_date END,
        updated_at        = NOW()
      WHERE id = ${transmittalId} AND project_id = ${projectId} AND company_id = ${companyId}
      RETURNING *
    `;
    return updated;
  }

  async delete(companyId: string, projectId: string, transmittalId: string) {
    await this.db.query`DELETE FROM transmittals WHERE id = ${transmittalId} AND project_id = ${projectId} AND company_id = ${companyId}`;
    return { message: 'Transmittal deleted.' };
  }

  async getSummary(companyId: string, projectId: string) {
    const [summary] = await this.db.withTenant(companyId, sql => sql`
      SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE status = 'draft') AS draft,
        COUNT(*) FILTER (WHERE status = 'sent') AS sent,
        COUNT(*) FILTER (WHERE status = 'acknowledged') AS acknowledged
      FROM transmittals
      WHERE project_id = ${projectId} AND company_id = ${companyId}
    `);
    return summary;
  }
}
