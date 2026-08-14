import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { NotificationsService } from '../notifications/notifications.service';
import { renderRfiPdf } from './rfi-pdf.template';
import type { CreateRfiDto } from './dto/create-rfi.dto';
import type { UpdateRfiDto } from './dto/update-rfi.dto';
import { RFI_DISCIPLINE_LABELS, RFI_DISCIPLINE_CODES, type PaginationQuery, type RfiDiscipline } from '@engineeringos/types';

@Injectable()
export class RfisService {
  constructor(
    private readonly db: DatabaseService,
    private readonly notifications: NotificationsService,
  ) {}

  // withTenant required for the projects lookup -- projects carries the tenant_isolation
  // RLS policy. A plain this.db.query() never sets app.current_company_id, so under any DB
  // role that isn't the table owner/a superuser this SELECT sees no rows and silently falls
  // back to the generic 'PRJ' prefix instead of the real project code.
  //
  // Format: {ProjectCode}-{OrgCode}-RFI-{DisciplineCode}-{0001}, matching the
  // real-world reference document this scheme was modeled on (e.g.
  // P162-CSC-RFI-STR-0186). Sequence counts per (project, discipline), same
  // approach issues.service.ts already uses -- so STR and ARC RFIs on the
  // same project each get their own independent 0001, 0002, ...
  private async generateRfiNumber(companyId: string, projectId: string, discipline: string): Promise<string> {
    return this.db.withTenant(companyId, async (sql) => {
      const [proj] = await sql`SELECT code, org_code FROM projects WHERE id = ${projectId} AND company_id = ${companyId}`;
      const projectCode = (proj?.code as string ?? 'PRJ').toUpperCase();
      const orgCode = (proj?.orgCode as string ?? 'GEN').toUpperCase();
      const disciplineCode = RFI_DISCIPLINE_CODES[discipline as keyof typeof RFI_DISCIPLINE_CODES] ?? 'OTH';
      const [cnt] = await sql`SELECT COUNT(*) AS n FROM rfis WHERE project_id = ${projectId} AND discipline = ${discipline}`;
      const seq = String(Number(cnt.n) + 1).padStart(4, '0');
      return `${projectCode}-${orgCode}-RFI-${disciplineCode}-${seq}`;
    });
  }

  async create(companyId: string, projectId: string, userId: string, dto: CreateRfiDto) {
    const rfiNumber = await this.generateRfiNumber(companyId, projectId, dto.discipline);
    // withTenant required -- rfis carries the tenant_isolation RLS policy, same as
    // every other table. A plain this.db.query() would silently reject this insert
    // under any non-owner/non-superuser DB role.
    const [rfi] = await this.db.withTenant(companyId, sql => sql`
      INSERT INTO rfis (
        company_id, project_id, rfi_number, subject, question,
        priority, discipline, discipline_other, cost_impact, time_impact,
        assigned_to, due_date, status, created_by
      ) VALUES (
        ${companyId}, ${projectId}, ${rfiNumber}, ${dto.subject}, ${dto.question},
        ${dto.priority ?? 'medium'}, ${dto.discipline}, ${dto.disciplineOther ?? null},
        ${dto.costImpact ?? false}, ${dto.timeImpact ?? false}, ${dto.assignedTo ?? null},
        ${dto.dueDate ?? null}, 'open', ${userId}
      )
      RETURNING *`);

    if (dto.assignedTo && dto.assignedTo !== userId) {
      await this.notifications.create(companyId, {
        userId: dto.assignedTo,
        type: 'rfi_assigned',
        title: `You were assigned to RFI ${rfiNumber}: ${dto.subject}`,
        resourceType: 'rfi',
        projectId,
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
        u_a.first_name || ' ' || u_a.last_name AS assigned_to_name,
        u_ans.first_name || ' ' || u_ans.last_name AS answered_by_name
      FROM rfis r
      LEFT JOIN users u_c ON u_c.id = r.created_by
      LEFT JOIN users u_a ON u_a.id = r.assigned_to
      LEFT JOIN users u_ans ON u_ans.id = r.answered_by
      WHERE r.id = ${rfiId} AND r.project_id = ${projectId} AND r.company_id = ${companyId}
    `);
    if (!rfi) throw new NotFoundException(`RFI ${rfiId} not found.`);
    return rfi;
  }

  // Everything the PDF template needs, joined in one place -- the RFI (with
  // the names already joined above) plus the project's stakeholder fields,
  // which the PDF pulls in automatically rather than asking for them again.
  async getPdfData(companyId: string, projectId: string, rfiId: string) {
    const rfi = await this.findOne(companyId, projectId, rfiId);
    const [project] = await this.db.withTenant(companyId, sql => sql`
      SELECT name, code, location, org_code, client_name, lead_designer,
        consultant_name, technical_advisor, pmc_name, main_contractor, subcontractor
      FROM projects WHERE id = ${projectId} AND company_id = ${companyId}
    `);
    return { rfi, project };
  }

  async generatePdf(companyId: string, projectId: string, rfiId: string): Promise<{ buffer: Buffer; filename: string }> {
    const { rfi, project } = await this.getPdfData(companyId, projectId, rfiId);
    const discipline = rfi.discipline as RfiDiscipline | undefined;
    const filename = `${(rfi.rfiNumber as string) ?? rfiId}.pdf`;

    const buffer = await renderRfiPdf({
      rfiNumber: (rfi.rfiNumber as string) ?? rfi.id as string,
      status: rfi.status as string,
      priority: rfi.priority as string,
      subject: rfi.subject as string,
      question: rfi.question as string,
      answer: rfi.answer as string | undefined,
      disciplineLabel: discipline ? RFI_DISCIPLINE_LABELS[discipline] : '—',
      disciplineOther: rfi.disciplineOther as string | undefined,
      costImpact: Boolean(rfi.costImpact),
      timeImpact: Boolean(rfi.timeImpact),
      projectName: (project?.name as string) ?? '—',
      projectCode: project?.code as string | undefined,
      location: project?.location as string | undefined,
      date: new Date(rfi.createdAt as string).toLocaleDateString('en-GB'),
      clientName: project?.clientName as string | undefined,
      leadDesigner: project?.leadDesigner as string | undefined,
      consultantName: project?.consultantName as string | undefined,
      technicalAdvisor: project?.technicalAdvisor as string | undefined,
      pmcName: project?.pmcName as string | undefined,
      mainContractor: project?.mainContractor as string | undefined,
      subcontractor: project?.subcontractor as string | undefined,
      createdByName: rfi.createdByName as string | undefined,
      createdAt: new Date(rfi.createdAt as string).toLocaleDateString('en-GB'),
      answeredByName: rfi.answeredByName as string | undefined,
      answeredAt: rfi.answeredAt ? new Date(rfi.answeredAt as string).toLocaleDateString('en-GB') : undefined,
    });

    return { buffer, filename };
  }

  async update(companyId: string, projectId: string, rfiId: string, userId: string, dto: UpdateRfiDto) {
    const existing = await this.findOne(companyId, projectId, rfiId);
    const isAnswering = dto.status === 'answered' && existing.status !== 'answered';

    // withTenant required -- see create() above.
    const [updated] = await this.db.withTenant(companyId, sql => sql`
      UPDATE rfis SET
        subject          = COALESCE(${dto.subject ?? null}, subject),
        question         = COALESCE(${dto.question ?? null}, question),
        answer           = COALESCE(${dto.answer ?? null}, answer),
        status           = COALESCE(${dto.status ?? null}, status),
        priority         = COALESCE(${dto.priority ?? null}, priority),
        discipline       = COALESCE(${dto.discipline ?? null}, discipline),
        discipline_other = COALESCE(${dto.disciplineOther ?? null}, discipline_other),
        cost_impact      = COALESCE(${dto.costImpact ?? null}, cost_impact),
        time_impact      = COALESCE(${dto.timeImpact ?? null}, time_impact),
        assigned_to      = COALESCE(${dto.assignedTo ?? null}::uuid, assigned_to),
        due_date         = COALESCE(${dto.dueDate ?? null}::timestamptz, due_date),
        answered_at      = CASE WHEN ${isAnswering} THEN NOW() ELSE answered_at END,
        answered_by      = CASE WHEN ${isAnswering} THEN ${userId}::uuid ELSE answered_by END,
        updated_at       = NOW()
      WHERE id = ${rfiId} AND project_id = ${projectId} AND company_id = ${companyId}
      RETURNING *
    `);
    return updated;
  }

  async delete(companyId: string, projectId: string, rfiId: string) {
    // withTenant required -- see create() above. Without it this silently
    // deletes 0 rows under RLS instead of erroring or actually deleting.
    const result = await this.db.withTenant(companyId, sql => sql`
      DELETE FROM rfis WHERE id = ${rfiId} AND project_id = ${projectId} AND company_id = ${companyId}
    `);
    if (result.count === 0) throw new NotFoundException(`RFI ${rfiId} not found.`);
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
