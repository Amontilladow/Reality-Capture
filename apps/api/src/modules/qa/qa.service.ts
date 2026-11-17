import { Injectable, Logger, NotFoundException, ForbiddenException, Optional } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { RiskService } from '../risk/risk.service';
import type { CreateQaInspectionDto } from './dto/create-qa-inspection.dto';
import type { UpdateQaInspectionDto } from './dto/update-qa-inspection.dto';
import { getOrgCategory, type PaginationQuery, type CompanyRole } from '@engineeringos/types';

const OUTCOMES = new Set(['passed', 'passed_with_exceptions', 'failed']);

@Injectable()
export class QaService {
  private readonly logger = new Logger(QaService.name);

  constructor(
    private readonly db: DatabaseService,
    // @Optional(): same rationale as RfisService's own optional RiskService
    // (keeps existing qa.service.spec.ts call sites, built before this
    // dependency existed, constructing this service unchanged). This
    // module never had a create/update-side risk trigger either -- an
    // inspection only ever entered the risk graph via the full-project
    // recalculation -- so this is solely for cleanup on delete() below.
    @Optional() private readonly risk?: RiskService,
  ) {}

  // The removal half of the event-driven risk pattern (RiskService.
  // removeEntityNode()'s own comment has the full story): fired after a
  // successful delete so a deleted inspection's risk, signals and graph
  // edges don't linger forever, including through a full Risk
  // Intelligence "Refresh" -- nothing previously called this at all.
  private async triggerRiskRemoval(companyId: string, inspectionId: string): Promise<void> {
    if (!this.risk) return;
    try {
      await this.risk.removeEntityNode(companyId, 'qa_inspection', inspectionId);
    } catch (err) {
      this.logger.warn(`Risk node removal failed for inspection ${inspectionId}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // withTenant required for the projects lookup: projects carries the tenant_isolation
  // RLS policy. A plain this.db.query() never sets app.current_company_id, so under any DB
  // role that isn't the table owner/a superuser this SELECT sees no rows and silently falls
  // back to the generic 'PRJ' prefix instead of the real project code.
  private async generateInspectionNumber(companyId: string, projectId: string): Promise<string> {
    return this.db.withTenant(companyId, async (sql) => {
      const [proj] = await sql`SELECT code FROM projects WHERE id = ${projectId} AND company_id = ${companyId}`;
      const prefix = (proj?.code as string ?? 'PRJ').toUpperCase();
      const [cnt] = await sql`SELECT COUNT(*) AS n FROM qa_inspections WHERE project_id = ${projectId}`;
      const seq = String(Number(cnt.n) + 1).padStart(4, '0');
      return `${prefix}-QAQC-${seq}`;
    });
  }

  async create(companyId: string, projectId: string, userId: string, dto: CreateQaInspectionDto) {
    const inspectionNumber = await this.generateInspectionNumber(companyId, projectId);
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

  // userRole is optional, loosely typed string; every pre-existing caller
  // omits it and is unaffected; only the controller's own PATCH route
  // passes it, to enforce the owner's org-category matrix's one
  // item-scoped rule for this module ("Construction Team: V,E; only on
  // close-out items assigned to them"), which the flat category matrix
  // table alone can't express (it's an ownership/assignment condition, not
  // a module-wide grant). Every other category holding 'edit' here
  // (QAQC Team, Engineering Manager) is unaffected; this check only
  // narrows Construction Team specifically.
  async update(companyId: string, projectId: string, inspectionId: string, userId: string, dto: UpdateQaInspectionDto, userRole?: string) {
    const existing = await this.findOne(companyId, projectId, inspectionId);
    if (userRole && getOrgCategory(userRole as CompanyRole) === 'construction_team' && existing.assignedTo !== userId) {
      throw new ForbiddenException({
        code: 'NOT_ASSIGNED_INSPECTION',
        message: 'Construction Team can only edit a QA inspection assigned to them.',
      });
    }
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

  // withTenant required: qa_inspections carries the tenant_isolation RLS
  // policy (migration 053) and FORCES it, so a plain this.db.query() DELETE
  // sets no app.current_company_id and silently matches 0 rows -- reporting
  // success while the row stays in the DB forever.
  async delete(companyId: string, projectId: string, inspectionId: string) {
    const result = await this.db.withTenant(companyId, sql => sql`
      DELETE FROM qa_inspections WHERE id = ${inspectionId} AND project_id = ${projectId} AND company_id = ${companyId}
    `);
    if (result.count === 0) throw new NotFoundException(`Inspection ${inspectionId} not found.`);
    await this.triggerRiskRemoval(companyId, inspectionId);
    return { message: 'Inspection deleted.' };
  }

  async bulkDelete(companyId: string, projectId: string, inspectionIds: string[]) {
    const result = await this.db.withTenant(companyId, sql => sql`
      DELETE FROM qa_inspections WHERE id = ANY(${inspectionIds}::uuid[]) AND project_id = ${projectId} AND company_id = ${companyId}
    `);
    await Promise.all(inspectionIds.map(id => this.triggerRiskRemoval(companyId, id)));
    return { deleted: result.count, failed: inspectionIds.length - result.count };
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
