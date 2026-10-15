import { Injectable, Logger, Optional, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { NotificationsService } from '../notifications/notifications.service';
import { StorageService } from '../storage/storage.service';
import { RiskService } from '../risk/risk.service';
import { mergeAttachmentPdfs, type MergeableAttachment } from '../../common/pdf/attachment-pdf-merge.util';
import { ATTACHMENT_MAX_SIZE, ATTACHMENT_ALLOWED_EXTENSIONS } from '../../common/constants/attachment-limits';
import { renderQaqcPdf } from './qaqc-pdf.template';
import type { CreateQaqcRecordDto } from './dto/create-qaqc-record.dto';
import type { RespondQaqcRecordDto } from './dto/respond-qaqc-record.dto';
import type { ConfirmQaqcRecordDto } from './dto/confirm-qaqc-record.dto';
import type { QaqcAttachmentUploadUrlDto } from './dto/qaqc-attachment-upload-url.dto';
import type { AddQaqcAttachmentDto } from './dto/add-qaqc-attachment.dto';
import type { AddQaqcCaptureDto } from './dto/add-qaqc-capture.dto';
import type { PaginationQuery } from '@engineeringos/types';

export type QaqcRecordType = 'ncr' | 'sor' | 'wir' | 'mir';
const QAQC_RECORD_TYPES: QaqcRecordType[] = ['ncr', 'sor', 'wir', 'mir'];

// NCR/SOR and WIR/MIR run the two-step close with the issuer/responder
// roles SWAPPED, not the same roles for every type:
//   NCR/SOR -- issued by QAQC-in-charge, responded to by the construction
//              team, confirmed by QAQC-in-charge again (QAQC flags a
//              problem, construction fixes it, QAQC signs off).
//   WIR/MIR -- issued by the construction team (a WIR/MIR *is* the
//              construction team's request for QAQC to inspect), responded
//              to (i.e. the inspection itself is recorded) by QAQC-in-
//              charge, and ALSO confirmed by QAQC-in-charge -- confirm
//              never varies by type, unlike issue/respond.
// The controller's @RequireExactRoles only pre-filters to the union of
// roles valid for *some* type on create/respond; the actual per-type
// check happens here, where dto.recordType / record.recordType is known.
const QAQC_ROLE_SET = ['qa_qc_manager'] as const;
const CONSTRUCTION_ROLE_SET = ['construction_manager', 'project_manager', 'technical_director', 'engineering_manager'] as const;
const ADMIN_ROLE_SET = ['company_admin', 'super_admin'] as const;

const ISSUE_ROLES_BY_TYPE: Record<QaqcRecordType, readonly string[]> = {
  ncr: QAQC_ROLE_SET,
  sor: QAQC_ROLE_SET,
  wir: CONSTRUCTION_ROLE_SET,
  mir: CONSTRUCTION_ROLE_SET,
};
const RESPOND_ROLES_BY_TYPE: Record<QaqcRecordType, readonly string[]> = {
  ncr: CONSTRUCTION_ROLE_SET,
  sor: CONSTRUCTION_ROLE_SET,
  wir: QAQC_ROLE_SET,
  mir: QAQC_ROLE_SET,
};

function assertRoleAllowed(userRole: string, allowed: readonly string[], action: string, recordTypeLabel: string): void {
  if ((ADMIN_ROLE_SET as readonly string[]).includes(userRole)) return;
  if (allowed.includes(userRole)) return;
  throw new ForbiddenException(`You do not have permission to ${action} a ${recordTypeLabel}.`);
}

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
  // change a record's overdue/priority/open-vs-closed state. Never allowed
  // to fail or slow down the QAQC write it's attached to.
  private async triggerRiskRecalc(companyId: string, projectId: string, nodeType: QaqcRecordType, qaqcId: string): Promise<void> {
    if (!this.risk) return;
    try {
      await this.risk.recalculateForEntity(companyId, projectId, nodeType, qaqcId);
    } catch (err) {
      this.logger.warn(`Risk recalculation failed for ${nodeType.toUpperCase()} ${qaqcId}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Scoped per (project, record_type) -- each of NCR/SOR/WIR/MIR gets its
  // own independent sequence on a project (NCR-001, SOR-001, WIR-001,
  // MIR-001, ... never sharing a counter). Deliberately simpler than RFI's
  // {ProjectCode}-{OrgCode}-RFI-{Discipline}-{seq} scheme -- the brief
  // asked specifically for "NCR-001"-style numbering, not the full RFI
  // reference-document format.
  private async generateRecordNumber(companyId: string, projectId: string, recordType: QaqcRecordType): Promise<string> {
    return this.db.withTenant(companyId, async (sql) => {
      const [cnt] = await sql`SELECT COUNT(*) AS n FROM qaqc_records WHERE project_id = ${projectId} AND record_type = ${recordType}`;
      const seq = String(Number(cnt.n) + 1).padStart(3, '0');
      return `${recordType.toUpperCase()}-${seq}`;
    });
  }

  async create(companyId: string, projectId: string, userId: string, userRole: string, dto: CreateQaqcRecordDto) {
    assertRoleAllowed(userRole, ISSUE_ROLES_BY_TYPE[dto.recordType], 'create', dto.recordType.toUpperCase());
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
        u_r.first_name || ' ' || u_r.last_name AS responded_by_name,
        u_c.first_name || ' ' || u_c.last_name AS confirmed_by_name,
        loc.name AS location_name,
        COUNT(*) OVER() AS full_count
      FROM qaqc_records q
      LEFT JOIN users u_i ON u_i.id = q.issued_by
      LEFT JOIN users u_a ON u_a.id = q.assigned_to
      LEFT JOIN users u_r ON u_r.id = q.responded_by
      LEFT JOIN users u_c ON u_c.id = q.confirmed_by
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
        u_r.first_name || ' ' || u_r.last_name AS responded_by_name,
        u_c.first_name || ' ' || u_c.last_name AS confirmed_by_name,
        loc.name AS location_name
      FROM qaqc_records q
      LEFT JOIN users u_i ON u_i.id = q.issued_by
      LEFT JOIN users u_a ON u_a.id = q.assigned_to
      LEFT JOIN users u_r ON u_r.id = q.responded_by
      LEFT JOIN users u_c ON u_c.id = q.confirmed_by
      LEFT JOIN locations loc ON loc.id = q.location_id
      WHERE q.id = ${qaqcId} AND q.project_id = ${projectId} AND q.company_id = ${companyId}
    `);
    if (!record) throw new NotFoundException(`QAQC record ${qaqcId} not found.`);
    return record;
  }

  // ── Step 1 of the two-step close: respond ──────────────────────────────
  // Moves 'open'/'reopened' -> 'pending_confirmation'. Who's allowed
  // depends on record_type -- construction team for NCR/SOR, QAQC-in-charge
  // for WIR/MIR (see RESPOND_ROLES_BY_TYPE) -- so the controller's
  // @RequireExactRoles only pre-filters to the union of both groups; the
  // exact-for-this-type check happens here, once the record's own type is
  // known. Deliberately does NOT close the record -- see confirm() for why
  // that's a separate, narrower-gated action that never varies by type
  // (mirrors RfisService's submitForReview(), the first half of its own
  // two-step review chain).
  async respond(companyId: string, projectId: string, qaqcId: string, userId: string, userRole: string, dto: RespondQaqcRecordDto) {
    const record = await this.findOne(companyId, projectId, qaqcId);
    assertRoleAllowed(userRole, RESPOND_ROLES_BY_TYPE[record.recordType as QaqcRecordType], 'respond to', (record.recordType as string).toUpperCase());
    if (record.status !== 'open' && record.status !== 'reopened') {
      throw new BadRequestException(
        `This ${(record.recordType as string).toUpperCase()} cannot be responded to from status "${record.status as string}".`,
      );
    }

    const [updated] = await this.db.withTenant(companyId, sql => sql`
      UPDATE qaqc_records
      SET status = 'pending_confirmation', response = ${dto.response}, responded_by = ${userId}, responded_at = NOW(), updated_at = NOW()
      WHERE id = ${qaqcId} AND project_id = ${projectId} AND company_id = ${companyId}
      RETURNING *
    `);

    if (updated.issuedBy) {
      await this.notifications.create(companyId, {
        userId: updated.issuedBy as string,
        type: `${updated.recordType as string}_responded`,
        title: `${updated.recordNumber as string} received a response, pending your confirmation: ${updated.subject as string}`,
        resourceType: 'qaqc_record',
        resourceId: qaqcId,
        projectId,
        createdBy: userId,
      });
    }

    await this.triggerRiskRecalc(companyId, projectId, updated.recordType as QaqcRecordType, qaqcId);
    return updated;
  }

  // ── Step 2 of the two-step close: confirm ───────────────────────────────
  // QAQC-in-charge (or admin) only -- for every record type, NCR/SOR and
  // WIR/MIR alike. Unlike issue/respond, this role set never swaps, so the
  // controller's static @RequireExactRoles(...CONFIRM_ROLES) is the only
  // enforcement needed; no per-type check here. 'confirmed' moves
  // 'pending_confirmation' -> 'closed'
  // (confirmedBy/confirmedAt set, terminal). 'rejected' moves it ->
  // 'reopened' (mirrors RfisService's decideReview() reject path) --
  // functionally like 'open' (can be responded to again) but kept
  // distinct in status/audit history so it's visible this record bounced
  // once already.
  async confirm(companyId: string, projectId: string, qaqcId: string, userId: string, dto: ConfirmQaqcRecordDto) {
    const record = await this.findOne(companyId, projectId, qaqcId);
    if (record.status !== 'pending_confirmation') {
      throw new BadRequestException(
        `This ${(record.recordType as string).toUpperCase()} is not awaiting confirmation (status: "${record.status as string}").`,
      );
    }

    const newStatus = dto.decision === 'confirmed' ? 'closed' : 'reopened';
    const [updated] = await this.db.withTenant(companyId, sql => sql`
      UPDATE qaqc_records
      SET status = ${newStatus},
          confirmation_comment = ${dto.comment ?? null},
          confirmed_by = ${dto.decision === 'confirmed' ? userId : null},
          confirmed_at = ${dto.decision === 'confirmed' ? sql`NOW()` : null},
          updated_at = NOW()
      WHERE id = ${qaqcId} AND project_id = ${projectId} AND company_id = ${companyId}
      RETURNING *
    `);

    const notifyUserId = (updated.respondedBy ?? updated.issuedBy) as string | undefined;
    if (notifyUserId) {
      await this.notifications.create(companyId, {
        userId: notifyUserId,
        type: `${updated.recordType as string}_${newStatus}`,
        title: dto.decision === 'confirmed'
          ? `${updated.recordNumber as string} was confirmed closed: ${updated.subject as string}`
          : `${updated.recordNumber as string} was reopened by QAQC: ${updated.subject as string}`,
        resourceType: 'qaqc_record',
        resourceId: qaqcId,
        projectId,
        createdBy: userId,
      });
    }

    await this.triggerRiskRecalc(companyId, projectId, updated.recordType as QaqcRecordType, qaqcId);
    return updated;
  }

  // ── Generic document attachments ("+Add document") ─────────────────────
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
      INSERT INTO qaqc_attachments (qaqc_id, company_id, storage_key, filename, size_bytes, uploaded_by, kind, document_type)
      VALUES (${qaqcId}, ${companyId}, ${dto.storageKey}, ${dto.filename}, ${actualSizeBytes}, ${userId}, ${dto.kind ?? 'issue'}, ${dto.documentType ?? null})
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

  // ── Quick photo picker ("+Add photo") -- links an already-uploaded
  // Capture (captureType: 'photo_standard', uploaded client-side via
  // captures.api.ts's uploadCapture()) to this record, mirroring
  // issues.service.ts's addCapture()/getEvidence() one-for-one. This is
  // deliberately a different path from addAttachment() above -- the photo
  // becomes a real Capture (shows up in the project's Captures grid), not
  // a bare qaqc_attachments row. ─────────────────────────────────────────
  async linkCapture(companyId: string, qaqcId: string, userId: string, dto: AddQaqcCaptureDto) {
    const [link] = await this.db.withTenant(companyId, sql => sql`
      INSERT INTO qaqc_captures (qaqc_id, capture_id, company_id, kind, caption, added_by)
      VALUES (${qaqcId}, ${dto.captureId}, ${companyId}, ${dto.kind ?? 'issue'}, ${dto.caption ?? null}, ${userId})
      ON CONFLICT (qaqc_id, capture_id) DO UPDATE SET caption = ${dto.caption ?? null}
      RETURNING *
    `);
    return link;
  }

  // Resolves thumbnailKey/originalKey into real, usable URLs server-side --
  // mirrors issues.service.ts's getEvidence() one-for-one (the raw storage
  // keys are not themselves fetchable by the browser).
  async getLinkedCaptures(companyId: string, qaqcId: string) {
    const rows = await this.db.withTenant(companyId, sql => sql`
      SELECT qc.id, qc.capture_id, qc.kind, qc.caption, qc.created_at,
             c.capture_type, c.captured_at, c.title, c.original_key,
             cr.storage_key AS thumbnail_key,
             u.first_name || ' ' || u.last_name AS added_by_name
      FROM qaqc_captures qc
      JOIN captures c ON c.id = qc.capture_id
      LEFT JOIN capture_renditions cr ON cr.capture_id = c.id AND cr.rendition_type = 'thumbnail_sm'
      JOIN users u ON u.id = qc.added_by
      WHERE qc.qaqc_id = ${qaqcId} AND qc.company_id = ${companyId}
      ORDER BY qc.created_at ASC
    `);
    const keys = rows.flatMap(r => [r.thumbnailKey, r.originalKey].filter(Boolean)) as string[];
    const urlMap = await this.storage.resolveUrls(keys);
    return rows.map(r => ({
      ...r,
      thumbnailUrl: (r.thumbnailKey ? urlMap.get(r.thumbnailKey as string) : undefined) ?? urlMap.get(r.originalKey as string),
    }));
  }

  // ── Reports KPI shape (mirrors issues.service.ts's getSummary()/
  // getKpiBreakdown()/getOpenList() -- the same three-method shape already
  // reused for RFIs' own Reports integration) ──────────────────────────────

  async getSummary(companyId: string, projectId: string) {
    const [summary] = await this.db.withTenant(companyId, sql => sql`
      SELECT
        COUNT(*)                                                                         AS total,
        COUNT(*) FILTER (WHERE record_type = 'ncr')                                      AS ncr_total,
        COUNT(*) FILTER (WHERE record_type = 'sor')                                      AS sor_total,
        COUNT(*) FILTER (WHERE record_type = 'wir')                                      AS wir_total,
        COUNT(*) FILTER (WHERE record_type = 'mir')                                      AS mir_total,
        COUNT(*) FILTER (WHERE record_type = 'ncr' AND status <> 'closed')               AS ncr_open,
        COUNT(*) FILTER (WHERE record_type = 'sor' AND status <> 'closed')               AS sor_open,
        COUNT(*) FILTER (WHERE record_type = 'wir' AND status <> 'closed')               AS wir_open,
        COUNT(*) FILTER (WHERE record_type = 'mir' AND status <> 'closed')               AS mir_open,
        COUNT(*) FILTER (WHERE status = 'pending_confirmation')                          AS pending_confirmation,
        COUNT(*) FILTER (WHERE record_type = 'ncr' AND status = 'closed')                AS ncr_closed,
        COUNT(*) FILTER (WHERE record_type = 'sor' AND status = 'closed')                AS sor_closed,
        COUNT(*) FILTER (WHERE record_type = 'wir' AND status = 'closed')                AS wir_closed,
        COUNT(*) FILTER (WHERE record_type = 'mir' AND status = 'closed')                AS mir_closed,
        COUNT(*) FILTER (WHERE priority = 'critical' AND status <> 'closed')             AS critical,
        COUNT(*) FILTER (WHERE due_date < NOW() AND status <> 'closed')                  AS overdue
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
        AND q.status <> 'closed'
      ORDER BY
        CASE q.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
        q.created_at DESC
      LIMIT ${limit}
    `);
  }

  // ── PDF export ───────────────────────────────────────────────────────────
  // Same two-method shape as RfisService.getPdfData()/generatePdf(): gather
  // everything the template needs in one place (including linked Captures,
  // not just qaqc_attachments), render a react-pdf summary, then append
  // every attachment's/photo's real content via the shared merge utility
  // extracted from RfisService (see attachment-pdf-merge.util.ts).
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
    const captureRows = await this.db.withTenant(companyId, sql => sql`
      SELECT qc.kind, c.title, c.original_key,
             cr.storage_key AS thumbnail_key
      FROM qaqc_captures qc
      JOIN captures c ON c.id = qc.capture_id
      LEFT JOIN capture_renditions cr ON cr.capture_id = c.id AND cr.rendition_type = 'thumbnail_sm'
      WHERE qc.qaqc_id = ${qaqcId} AND qc.company_id = ${companyId}
      ORDER BY qc.created_at ASC
    `);
    return { record, project, attachmentRows, captureRows };
  }

  async generatePdf(companyId: string, projectId: string, qaqcId: string): Promise<{ buffer: Buffer; filename: string }> {
    const { record, project, attachmentRows, captureRows } = await this.getPdfData(companyId, projectId, qaqcId);
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
      respondedByName: record.respondedByName as string | undefined,
      respondedAt: record.respondedAt ? new Date(record.respondedAt as string).toLocaleString('en-GB') : undefined,
      confirmedByName: record.confirmedByName as string | undefined,
      confirmedAt: record.confirmedAt ? new Date(record.confirmedAt as string).toLocaleString('en-GB') : undefined,
      confirmationComment: record.confirmationComment as string | undefined,
    });

    // Issue-time attachments/photos first, then response-time ones -- same
    // ordering convention as RFI's query-then-response split. Documents
    // and linked-Capture photos are merged into one ordered list so both
    // kinds of evidence appear as divided pages, per the brief.
    const attachmentRowsTyped = attachmentRows as Array<Record<string, unknown>>;
    const captureRowsTyped = captureRows as Array<Record<string, unknown>>;

    const documentMergeables: (MergeableAttachment & { kind: string })[] = attachmentRowsTyped.map((row) => ({
      filename: row.filename as string,
      storageKey: row.storageKey as string | undefined,
      typeLabel: (row.kind as string) === 'response' ? 'Response document' : 'Issue document',
      kind: row.kind as string,
    }));
    const captureMergeables: (MergeableAttachment & { kind: string })[] = captureRowsTyped.map((row) => ({
      filename: (row.title as string | undefined) || 'Photo',
      storageKey: (row.thumbnailKey as string | undefined) ?? (row.originalKey as string | undefined),
      typeLabel: (row.kind as string) === 'response' ? 'Response photo' : 'Issue photo',
      kind: row.kind as string,
    }));

    const allMergeables = [...documentMergeables, ...captureMergeables];
    const issueMergeables = allMergeables.filter((a) => a.kind !== 'response');
    const responseMergeables = allMergeables.filter((a) => a.kind === 'response');
    const mergeableAttachments: MergeableAttachment[] = [...issueMergeables, ...responseMergeables];

    const buffer = await mergeAttachmentPdfs(summaryBuffer, mergeableAttachments, this.storage);

    return { buffer, filename };
  }
}

export { QAQC_RECORD_TYPES };
