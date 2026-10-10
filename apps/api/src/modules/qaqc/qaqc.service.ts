import { Injectable, Logger, Optional, NotFoundException, BadRequestException } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { NotificationsService } from '../notifications/notifications.service';
import { StorageService } from '../storage/storage.service';
import { RiskService } from '../risk/risk.service';
import { mergeAttachmentPdfs, type MergeableAttachment } from '../../common/pdf/attachment-pdf-merge.util';
import { ATTACHMENT_MAX_SIZE, ATTACHMENT_ALLOWED_EXTENSIONS } from '../../common/constants/attachment-limits';
import { renderQaqcPdf } from './qaqc-pdf.template';
import type { CreateQaqcRecordDto } from './dto/create-qaqc-record.dto';
import type { CloseQaqcRecordDto } from './dto/close-qaqc-record.dto';
import type { QaqcAttachmentUploadUrlDto } from './dto/qaqc-attachment-upload-url.dto';
import type { AddQaqcAttachmentDto } from './dto/add-qaqc-attachment.dto';
import type { PaginationQuery } from '@engineeringos/types';

export type QaqcRecordType = 'ncr' | 'sor';

@Injectable()
export class QaqcService {
  private readonly logger = new Logger(QaqcService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly notifications: NotificationsService,
    private readonly storage: StorageService,
    // @Optional(): same rationale as RfisService's own optional RiskService --
    // QaqcModule registers RiskModule as a real provider in production;
    // this stays optional purely so qaqc.service.spec.ts's existing
    // call sites (constructed with the pre-RiskService arg list) keep
    // working unchanged.
    @Optional() private readonly risk?: RiskService,
  ) {}

  // Event-driven incremental risk recalculation (mirrors RfisService's
  // triggerRiskRecalc() one-for-one) -- fired after any write that can
  // change an NCR/SOR's overdue/priority/open-vs-closed state. Never
  // allowed to fail or slow down the QAQC write it's attached to.
  private async triggerRiskRecalc(companyId: string, projectId: string, nodeType: QaqcRecordType, qaqcId: string): Promise<void> {
    if (!this.risk) return;
    try {
      await this.risk.recalculateForEntity(companyId, projectId, nodeType, qaqcId);
    } catch (err) {
      this.logger.warn(`Risk recalculation failed for ${nodeType.toUpperCase()} ${qaqcId}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Scoped per (project, record_type) -- NCR and SOR each get their own
  // independent sequence on a project (NCR-001, NCR-002, ... / SOR-001,
  // SOR-002, ...), never sharing a counter. Deliberately simpler than
  // RFI's {ProjectCode}-{OrgCode}-RFI-{Discipline}-{seq} scheme -- the
  // brief asked specifically for "NCR-001, SOR-001"-style numbering, not
  // the full RFI reference-document format.
  private async generateRecordNumber(companyId: string, projectId: string, recordType: QaqcRecordType): Promise<string> {
    return this.db.withTenant(companyId, async (sql) => {
      const [cnt] = await sql`SELECT COUNT(*) AS n FROM qaqc_records WHERE project_id = ${projectId} AND record_type = ${recordType}`;
      const seq = String(Number(cnt.n) + 1).padStart(3, '0');
      return `${recordType.toUpperCase()}-${seq}`;
    });
  }

  async create(companyId: string, projectId: string, userId: string, dto: CreateQaqcRecordDto) {
    const recordNumber = await this.generateRecordNumber(companyId, projectId, dto.recordType);

    // withTenant required -- qaqc_records carries the tenant_isolation RLS
    // policy (migration 067), same as every other tenant-scoped table.
    const [record] = await this.db.withTenant(companyId, sql => sql`
      INSERT INTO qaqc_records (
        company_id, project_id, record_type, record_number, subject, description,
        discipline, discipline_other, priority, location_id, assigned_to, due_date, issued_by
      ) VALUES (
        ${companyId}, ${projectId}, ${dto.recordType}, ${recordNumber}, ${dto.subject}, ${dto.description},
        ${dto.discipline}, ${dto.disciplineOther ?? null}, ${dto.priority ?? 'medium'},
        ${dto.locationId ?? null}, ${dto.assignedTo ?? null}, ${dto.dueDate ?? null}, ${userId}
      )
      RETURNING *
    `);

    if (dto.assignedTo) {
      await this.notifications.create(companyId, {
        userId: dto.assignedTo,
        type: `${dto.recordType}_assigned`,
        title: `You were assigned to ${recordNumber}: ${dto.subject}`,
        resourceType: 'qaqc_record',
        resourceId: record.id as string,
        projectId,
        createdBy: userId,
      });
    }

    await this.triggerRiskRecalc(companyId, projectId, dto.recordType, record.id as string);
    return record;
  }

  async findAll(companyId: string, projectId: string, query: PaginationQuery & {
    recordType?: QaqcRecordType; status?: string; priority?: string; discipline?: string; assignedTo?: string;
  }) {
    const page    = query.page ?? 1;
    const perPage = Math.min(query.perPage ?? 20, 100);
    const offset  = (page - 1) * perPage;

    const rows = await this.db.withTenant(companyId, sql => sql`
      SELECT q.*,
        u_i.first_name || ' ' || u_i.last_name AS issued_by_name,
        u_a.first_name || ' ' || u_a.last_name AS assigned_to_name,
        u_cl.first_name || ' ' || u_cl.last_name AS closed_by_name,
        loc.name AS location_name,
        COUNT(*) OVER() AS full_count
      FROM qaqc_records q
      LEFT JOIN users u_i ON u_i.id = q.issued_by
      LEFT JOIN users u_a ON u_a.id = q.assigned_to
      LEFT JOIN users u_cl ON u_cl.id = q.closed_by
      LEFT JOIN locations loc ON loc.id = q.location_id
      WHERE q.project_id = ${projectId} AND q.company_id = ${companyId}
        AND (${query.recordType ?? null}::text IS NULL OR q.record_type = ${query.recordType ?? null})
        AND (${query.status ?? null}::text IS NULL OR q.status = ${query.status ?? null})
        AND (${query.priority ?? null}::text IS NULL OR q.priority = ${query.priority ?? null})
        AND (${query.discipline ?? null}::text IS NULL OR q.discipline = ${query.discipline ?? null})
        AND (${query.assignedTo ?? null}::uuid IS NULL OR q.assigned_to = ${query.assignedTo ?? null}::uuid)
      ORDER BY
        CASE q.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
        q.created_at DESC
      LIMIT ${perPage} OFFSET ${offset}
    `);

    return this.db.paginate(rows, page, perPage);
  }

  async findOne(companyId: string, projectId: string, qaqcId: string) {
    const [record] = await this.db.withTenant(companyId, sql => sql`
      SELECT q.*,
        u_i.first_name || ' ' || u_i.last_name AS issued_by_name,
        u_a.first_name || ' ' || u_a.last_name AS assigned_to_name,
        u_cl.first_name || ' ' || u_cl.last_name AS closed_by_name,
        loc.name AS location_name
      FROM qaqc_records q
      LEFT JOIN users u_i ON u_i.id = q.issued_by
      LEFT JOIN users u_a ON u_a.id = q.assigned_to
      LEFT JOIN users u_cl ON u_cl.id = q.closed_by
      LEFT JOIN locations loc ON loc.id = q.location_id
      WHERE q.id = ${qaqcId} AND q.project_id = ${projectId} AND q.company_id = ${companyId}
    `);
    if (!record) throw new NotFoundException(`QAQC record ${qaqcId} not found.`);
    return record;
  }

  // Single respond-and-close transition -- see CloseQaqcRecordDto's own
  // comment for why this is one action, not RFI's multi-step workflow.
  // Authorization (construction_manager/technical_director/qa_qc_manager/
  // admin) is enforced at the controller via @RequireExactRoles -- this
  // method only enforces the record's own state machine.
  async close(companyId: string, projectId: string, qaqcId: string, userId: string, dto: CloseQaqcRecordDto) {
    const record = await this.findOne(companyId, projectId, qaqcId);
    if (record.status === 'closed' || record.status === 'void') {
      throw new BadRequestException(`This ${(record.recordType as string).toUpperCase()} is already ${record.status as string}.`);
    }

    const [updated] = await this.db.withTenant(companyId, sql => sql`
      UPDATE qaqc_records
      SET status = 'closed', response = ${dto.response}, closed_by = ${userId}, closed_at = NOW(), updated_at = NOW()
      WHERE id = ${qaqcId} AND project_id = ${projectId} AND company_id = ${companyId}
      RETURNING *
    `);

    if (updated.issuedBy) {
      await this.notifications.create(companyId, {
        userId: updated.issuedBy as string,
        type: `${updated.recordType as string}_closed`,
        title: `${updated.recordNumber as string} was closed: ${updated.subject as string}`,
        resourceType: 'qaqc_record',
        resourceId: qaqcId,
        projectId,
        createdBy: userId,
      });
    }

    await this.triggerRiskRecalc(companyId, projectId, updated.recordType as QaqcRecordType, qaqcId);
    return updated;
  }

  // ── Attachments ───────────────────────────────────────────────────────────
  // Same presigned-PUT pattern, allow-list, and size cap as rfis.service.ts's
  // attachment methods (which themselves mirror issues.service.ts's).
  async getAttachmentUploadUrl(companyId: string, projectId: string, dto: QaqcAttachmentUploadUrlDto) {
    const ext = dto.filename.split('.').pop()?.toLowerCase() ?? '';
    if (!ATTACHMENT_ALLOWED_EXTENSIONS.has(ext)) {
      throw new BadRequestException(
        `File type ".${ext}" is not supported. Allowed: ${[...ATTACHMENT_ALLOWED_EXTENSIONS].join(', ')}.`,
      );
    }
    if (dto.sizeBytes > ATTACHMENT_MAX_SIZE) {
      throw new BadRequestException(
        `File too large (${(dto.sizeBytes / 1024 / 1024).toFixed(1)} MB). Max: ${ATTACHMENT_MAX_SIZE / 1024 / 1024} MB.`,
      );
    }

    const key = this.storage.generateKey(companyId, projectId, 'qaqc-attachments', dto.filename);
    const { uploadUrl } = await this.storage.getUploadUrl(key, 'application/octet-stream', dto.sizeBytes);
    return { uploadUrl, storageKey: key };
  }

  async addAttachment(companyId: string, qaqcId: string, userId: string, dto: AddQaqcAttachmentDto) {
    // Real post-upload size enforcement -- dto.sizeBytes was only checked
    // against the limit at upload-url time, never trusted for persistence.
    const actualSizeBytes = await this.storage.getObjectSize(dto.storageKey);
    if (actualSizeBytes === null) {
      throw new BadRequestException('Uploaded file not found in storage. Complete the upload before adding the attachment.');
    }
    if (actualSizeBytes > ATTACHMENT_MAX_SIZE) {
      await this.storage.deleteIfExists(dto.storageKey);
      throw new BadRequestException(
        `Uploaded file (${(actualSizeBytes / 1024 / 1024).toFixed(1)} MB) exceeds the ${ATTACHMENT_MAX_SIZE / 1024 / 1024} MB ` +
        'limit for an attachment. The upload has been rejected and removed.',
      );
    }

    const [attachment] = await this.db.withTenant(companyId, sql => sql`
      INSERT INTO qaqc_attachments (qaqc_id, company_id, storage_key, filename, size_bytes, uploaded_by, kind)
      VALUES (${qaqcId}, ${companyId}, ${dto.storageKey}, ${dto.filename}, ${actualSizeBytes}, ${userId}, ${dto.kind ?? 'issue'})
      RETURNING *
    `);
    return attachment;
  }

  async getAttachments(companyId: string, qaqcId: string) {
    const rows = await this.db.withTenant(companyId, sql => sql`
      SELECT qa.*, u.first_name || ' ' || u.last_name AS uploaded_by_name
      FROM qaqc_attachments qa
      LEFT JOIN users u ON u.id = qa.uploaded_by
      WHERE qa.qaqc_id = ${qaqcId} AND qa.company_id = ${companyId}
      ORDER BY qa.uploaded_at ASC
    `);
    const urls = await this.storage.resolveUrls(rows.map(r => r.storageKey as string));
    return rows.map(r => ({ ...r, attachmentReadUrl: urls.get(r.storageKey as string) }));
  }

  async deleteAttachment(companyId: string, qaqcId: string, attachmentId: string) {
    const result = await this.db.withTenant(companyId, sql => sql`
      DELETE FROM qaqc_attachments
      WHERE id = ${attachmentId} AND qaqc_id = ${qaqcId} AND company_id = ${companyId}
    `);
    if (result.count === 0) throw new NotFoundException(`Attachment ${attachmentId} not found.`);
    return { message: 'Attachment deleted.' };
  }

  // ── Reports KPI shape (mirrors issues.service.ts's getSummary()/
  // getKpiBreakdown()/getOpenList() -- the same three-method shape already
  // reused for RFIs' own Reports integration) ──────────────────────────────

  async getSummary(companyId: string, projectId: string) {
    const [summary] = await this.db.withTenant(companyId, sql => sql`
      SELECT
        COUNT(*)                                                                    AS total,
        COUNT(*) FILTER (WHERE record_type = 'ncr')                                 AS ncr_total,
        COUNT(*) FILTER (WHERE record_type = 'sor')                                 AS sor_total,
        COUNT(*) FILTER (WHERE record_type = 'ncr' AND status NOT IN ('closed','void')) AS ncr_open,
        COUNT(*) FILTER (WHERE record_type = 'sor' AND status NOT IN ('closed','void')) AS sor_open,
        COUNT(*) FILTER (WHERE record_type = 'ncr' AND status = 'closed')           AS ncr_closed,
        COUNT(*) FILTER (WHERE record_type = 'sor' AND status = 'closed')           AS sor_closed,
        COUNT(*) FILTER (WHERE priority = 'critical' AND status NOT IN ('closed','void')) AS critical,
        COUNT(*) FILTER (WHERE due_date < NOW() AND status NOT IN ('closed','void')) AS overdue
      FROM qaqc_records
      WHERE project_id = ${projectId} AND company_id = ${companyId}
    `);
    return summary;
  }

  async getKpiBreakdown(companyId: string, projectId: string) {
    const rows = await this.db.withTenant(companyId, sql => sql`
      SELECT record_type, status, priority, COUNT(*) AS count
      FROM qaqc_records
      WHERE project_id = ${projectId} AND company_id = ${companyId}
      GROUP BY record_type, status, priority
    `);

    const byRecordType: Record<string, number> = {};
    const byStatus: Record<string, number> = {};
    const byPriority: Record<string, number> = {};
    for (const row of rows) {
      const count = Number(row.count);
      const recordType = row.recordType as string;
      const status = row.status as string;
      const priority = row.priority as string;
      byRecordType[recordType] = (byRecordType[recordType] ?? 0) + count;
      byStatus[status] = (byStatus[status] ?? 0) + count;
      byPriority[priority] = (byPriority[priority] ?? 0) + count;
    }
    return { byRecordType, byStatus, byPriority };
  }

  async getOpenList(companyId: string, projectId: string, limit = 50) {
    return this.db.withTenant(companyId, sql => sql`
      SELECT
        q.id, q.record_type, q.record_number, q.subject, q.status, q.priority, q.due_date,
        u_a.first_name || ' ' || u_a.last_name AS assigned_to_name
      FROM qaqc_records q
      LEFT JOIN users u_a ON u_a.id = q.assigned_to
      WHERE q.project_id = ${projectId} AND q.company_id = ${companyId}
        AND q.status NOT IN ('closed', 'void')
      ORDER BY
        CASE q.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
        q.created_at DESC
      LIMIT ${limit}
    `);
  }

  // ── PDF export ───────────────────────────────────────────────────────────
  // Same two-method shape as RfisService.getPdfData()/generatePdf(): gather
  // everything the template needs in one place, render a react-pdf summary,
  // then append every attachment's real content via the shared merge
  // utility extracted from RfisService (see attachment-pdf-merge.util.ts).
  async getPdfData(companyId: string, projectId: string, qaqcId: string) {
    const record = await this.findOne(companyId, projectId, qaqcId);
    const [project] = await this.db.withTenant(companyId, sql => sql`
      SELECT name, code FROM projects WHERE id = ${projectId} AND company_id = ${companyId}
    `);
    const attachmentRows = await this.db.withTenant(companyId, sql => sql`
      SELECT id, filename, kind, storage_key
      FROM qaqc_attachments
      WHERE qaqc_id = ${qaqcId} AND company_id = ${companyId}
      ORDER BY uploaded_at ASC
    `);
    return { record, project, attachmentRows };
  }

  async generatePdf(companyId: string, projectId: string, qaqcId: string): Promise<{ buffer: Buffer; filename: string }> {
    const { record, project, attachmentRows } = await this.getPdfData(companyId, projectId, qaqcId);
    const filename = `${(record.recordNumber as string) ?? qaqcId}.pdf`;

    const summaryBuffer = await renderQaqcPdf({
      recordNumber: (record.recordNumber as string) ?? (record.id as string),
      recordType: record.recordType as QaqcRecordType,
      status: record.status as string,
      priority: record.priority as string,
      subject: record.subject as string,
      description: record.description as string,
      response: record.response as string | undefined,
      disciplineLabel: record.discipline as string,
      disciplineOther: record.disciplineOther as string | undefined,
      projectName: (project?.name as string) ?? '—',
      projectCode: project?.code as string | undefined,
      issuedByName: record.issuedByName as string | undefined,
      createdAt: new Date(record.createdAt as string).toLocaleDateString('en-GB'),
      assignedToName: record.assignedToName as string | undefined,
      dueDate: record.dueDate ? new Date(record.dueDate as string).toLocaleDateString('en-GB') : undefined,
      closedByName: record.closedByName as string | undefined,
      closedAt: record.closedAt ? new Date(record.closedAt as string).toLocaleString('en-GB') : undefined,
    });

    // Issue-time attachments first, then response (closing) attachments --
    // same ordering convention as RFI's query-then-response split.
    const attachmentRowsTyped = attachmentRows as Array<Record<string, unknown>>;
    const issueRows = attachmentRowsTyped.filter((a) => (a.kind ?? 'issue') === 'issue');
    const responseRows = attachmentRowsTyped.filter((a) => a.kind === 'response');
    const mergeableAttachments: MergeableAttachment[] = [...issueRows, ...responseRows].map((row) => ({
      filename: row.filename as string,
      storageKey: row.storageKey as string | undefined,
      typeLabel: (row.kind as string) === 'response' ? 'Response attachment' : 'Issue attachment',
    }));
    const buffer = await mergeAttachmentPdfs(summaryBuffer, mergeableAttachments, this.storage);

    return { buffer, filename };
  }
}
