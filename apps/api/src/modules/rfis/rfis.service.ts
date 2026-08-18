import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import sharp from 'sharp';
import { PDFDocument, PDFFont, StandardFonts, rgb, PageSizes } from 'pdf-lib';
import { DatabaseService } from '../../database/database.service';
import { NotificationsService } from '../notifications/notifications.service';
import { StorageService } from '../storage/storage.service';
import { renderRfiPdf } from './rfi-pdf.template';
import { ATTACHMENT_MAX_SIZE, ATTACHMENT_ALLOWED_EXTENSIONS } from '../../common/constants/attachment-limits';
import type { CreateRfiDto } from './dto/create-rfi.dto';
import type { UpdateRfiDto } from './dto/update-rfi.dto';
import type { RfiAttachmentUploadUrlDto } from './dto/rfi-attachment-upload-url.dto';
import type { AddRfiAttachmentDto } from './dto/add-rfi-attachment.dto';
import type { RequestClarificationDto } from './dto/request-clarification.dto';
import type { RespondToRfiDto } from './dto/respond-to-rfi.dto';
import type { AddRfiCommentDto } from './dto/add-rfi-comment.dto';
import {
  RFI_DISCIPLINE_LABELS, RFI_DISCIPLINE_CODES, RFI_DOCUMENT_TYPE_LABELS,
  PROJECT_ORGANIZATION_SLOT_LABELS, PROJECT_ORGANIZATION_SLOTS,
  type PaginationQuery, type RfiDiscipline, type RfiImpactLevel, type RfiDocumentType,
} from '@engineeringos/types';

// ── Workflow state machine (Phase 1) ────────────────────────────────────────
// Legacy 'open'/'answered' are the pre-existing names for the same lifecycle
// positions as 'submitted'/'responded' -- an RFI created through the
// untouched create() method (which still always sets status='open') can
// walk through these same transitions without ever being renamed at the
// data layer; only the app-layer state machine treats them as equivalent.
const RFI_TERMINAL_STATUSES = new Set(['closed', 'rejected', 'cancelled', 'void']);

// Statuses a request-clarification / respond call may legally start from.
const CLARIFICATION_SOURCE_STATUSES = new Set(['submitted', 'open', 'under_review']);
const RESPOND_SOURCE_STATUSES = new Set(['submitted', 'open', 'under_review', 'awaiting_clarification']);

@Injectable()
export class RfisService {
  constructor(
    private readonly db: DatabaseService,
    private readonly notifications: NotificationsService,
    private readonly storage: StorageService,
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

    // 4-state level fields take precedence when provided; otherwise derive
    // the level from the legacy boolean; otherwise default as before this
    // ticket ('no'/false). Both old and new columns are always written in
    // sync -- nothing outside this module reads the booleans yet, but the
    // booleans stay authoritative for the current (unmodified) frontend.
    const costImpactLevel: RfiImpactLevel = dto.costImpactLevel ?? (dto.costImpact ? 'yes' : 'no');
    const costImpactBool = dto.costImpactLevel ? dto.costImpactLevel === 'yes' : (dto.costImpact ?? false);
    const timeImpactLevel: RfiImpactLevel = dto.timeImpactLevel ?? (dto.timeImpact ? 'yes' : 'no');
    const timeImpactBool = dto.timeImpactLevel ? dto.timeImpactLevel === 'yes' : (dto.timeImpact ?? false);

    // withTenant required -- rfis carries the tenant_isolation RLS policy, same as
    // every other table. A plain this.db.query() would silently reject this insert
    // under any non-owner/non-superuser DB role.
    const [rfi] = await this.db.withTenant(companyId, sql => sql`
      INSERT INTO rfis (
        company_id, project_id, rfi_number, subject, question,
        priority, discipline, discipline_other, cost_impact, time_impact,
        cost_impact_level, cost_impact_amount, cost_impact_currency, cost_impact_description,
        time_impact_level, time_impact_days, time_impact_description,
        assigned_to, due_date, status, created_by
      ) VALUES (
        ${companyId}, ${projectId}, ${rfiNumber}, ${dto.subject}, ${dto.question},
        ${dto.priority ?? 'medium'}, ${dto.discipline}, ${dto.disciplineOther ?? null},
        ${costImpactBool}, ${timeImpactBool},
        ${costImpactLevel}, ${dto.costImpactAmount ?? null}, ${dto.costImpactCurrency ?? null}, ${dto.costImpactDescription ?? null},
        ${timeImpactLevel}, ${dto.timeImpactDays ?? null}, ${dto.timeImpactDescription ?? null},
        ${dto.assignedTo ?? null},
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

  async findAll(companyId: string, projectId: string, query: PaginationQuery & {
    status?: string; priority?: string; discipline?: string;
    costImpactLevel?: string; timeImpactLevel?: string; assignedTo?: string;
    dateFrom?: string; dateTo?: string;
  }) {
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
        AND (${query.discipline ?? null}::text IS NULL OR r.discipline::text = ${query.discipline ?? null})
        AND (${query.costImpactLevel ?? null}::text IS NULL OR r.cost_impact_level = ${query.costImpactLevel ?? null})
        AND (${query.timeImpactLevel ?? null}::text IS NULL OR r.time_impact_level = ${query.timeImpactLevel ?? null})
        AND (${query.assignedTo ?? null}::uuid IS NULL OR r.assigned_to = ${query.assignedTo ?? null}::uuid)
        AND (${query.dateFrom ?? null}::timestamptz IS NULL OR r.created_at >= ${query.dateFrom ?? null}::timestamptz)
        AND (${query.dateTo ?? null}::timestamptz IS NULL OR r.created_at <= ${query.dateTo ?? null}::timestamptz)
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
  //
  // Phase 5 additions: the 5 named-organization rows and the query/response
  // attachment lists. RfisModule doesn't import ProjectsModule (and doesn't
  // export/need ProjectsService for anything else), so rather than wiring up
  // that whole module import for one read-only SELECT, this queries
  // project_organizations directly -- the exact same query
  // ProjectsService.getOrganizations() runs, minus the resolveUrls() call
  // (the PDF needs raw buffers via storage.download(), not presigned URLs;
  // see generatePdf() below). Documented here as the judgment call the
  // ticket asked for.
  async getPdfData(companyId: string, projectId: string, rfiId: string) {
    const rfi = await this.findOne(companyId, projectId, rfiId);
    // Stakeholder free-text columns (client_name/lead_designer/etc.) and
    // location dropped from this SELECT -- the PDF/XLS no longer render a
    // Stakeholders or standalone Project section (neither exists on the
    // live RfiDetailPage; see rfi-pdf.template.ts / rfi-xls.ts), so nothing
    // downstream of this query reads them anymore.
    const [project] = await this.db.withTenant(companyId, sql => sql`
      SELECT name, code, org_code, logo_storage_key, stamp_storage_key
      FROM projects WHERE id = ${projectId} AND company_id = ${companyId}
    `);
    const organizations = await this.db.withTenant(companyId, sql => sql`
      SELECT slot, name, logo_storage_key
      FROM project_organizations
      WHERE project_id = ${projectId} AND company_id = ${companyId}
      ORDER BY slot
    `);
    // Filename + document type + storage_key -- no presigned read URL
    // needed (these aren't clickable links in a static generated document,
    // see rfi-xls.ts), but storage_key is needed here so generatePdf() can
    // download+embed image-type attachments directly as PDF thumbnails (see
    // rfi-pdf.template.ts's attachmentsBlock()). id is needed so
    // getExportAssets() can key its returned thumbnails to the exact
    // attachment the browser already has (RfiAttachment.id) -- filename
    // alone isn't a safe key, two attachments can share a name.
    const attachmentRows = await this.db.withTenant(companyId, sql => sql`
      SELECT id, filename, kind, document_type, document_type_other, storage_key
      FROM rfi_attachments
      WHERE rfi_id = ${rfiId} AND company_id = ${companyId}
      ORDER BY uploaded_at ASC
    `);
    // Comments and audit trail -- shown live on RfiDetailPage's
    // Communication/Clarifications and Audit Trail sections, but never made
    // it into either export. Same data, same read pattern as
    // getComments()/the audit endpoint, just inlined here for the export.
    const commentRows = await this.db.withTenant(companyId, sql => sql`
      SELECT c.body, c.organization_slot, c.created_at, u.first_name || ' ' || u.last_name AS user_name
      FROM rfi_comments c
      LEFT JOIN users u ON u.id = c.user_id
      WHERE c.rfi_id = ${rfiId} AND c.company_id = ${companyId}
      ORDER BY c.created_at ASC
    `);
    // writeRfiAudit() (the workflow state machine below) only ever sets
    // user_id, not the denormalized user_name/user_email columns the
    // generic AuditInterceptor fills in for other routes -- resolve the
    // name via users here rather than showing blank for every RFI-specific
    // event, which would otherwise be most of this list.
    const auditRows = await this.db.withTenant(companyId, sql => sql`
      SELECT a.action, COALESCE(a.user_name, u.first_name || ' ' || u.last_name) AS user_name, a.occurred_at
      FROM audit_log a
      LEFT JOIN users u ON u.id = a.user_id
      WHERE a.resource_type = 'rfi' AND a.resource_id = ${rfiId} AND a.company_id = ${companyId}
      ORDER BY a.occurred_at ASC
    `);
    return { rfi, project, organizations, attachmentRows, commentRows, auditRows };
  }

  async generatePdf(companyId: string, projectId: string, rfiId: string): Promise<{ buffer: Buffer; filename: string }> {
    const { rfi, project, organizations, attachmentRows, commentRows, auditRows } = await this.getPdfData(companyId, projectId, rfiId);
    const discipline = rfi.discipline as RfiDiscipline | undefined;
    const filename = `${(rfi.rfiNumber as string) ?? rfiId}.pdf`;

    // Downloaded straight to a Buffer rather than a presigned URL -- the
    // template embeds it directly (see rfi-pdf.template.ts), no URL-expiry
    // race since this all happens synchronously server-side. Both optional:
    // a project with no logo/stamp set yet still renders a clean PDF.
    const [logoBuffer, stampBuffer] = await Promise.all([
      project?.logoStorageKey ? this.storage.download(project.logoStorageKey as string).catch(() => undefined) : undefined,
      project?.stampStorageKey ? this.storage.download(project.stampStorageKey as string).catch(() => undefined) : undefined,
    ]);

    // Always all 5 slots, matching RfiDetailPage's own OrganizationSlotRow
    // exactly -- an unconfigured slot still shows up there (as a "No logo"
    // placeholder), so silently dropping it here would make the export show
    // less than what the live page shows, not just render it differently.
    const orgsBySlot = new Map((organizations as Array<Record<string, unknown>>).map(o => [o.slot as string, o]));
    const orgLogos = await Promise.all(
      PROJECT_ORGANIZATION_SLOTS.map(async (slot) => {
        const org = orgsBySlot.get(slot);
        const key = org?.logoStorageKey as string | undefined;
        const buffer = key ? await this.storage.download(key).catch(() => undefined) : undefined;
        return {
          slot,
          label: (org?.name as string | undefined) || PROJECT_ORGANIZATION_SLOT_LABELS[slot],
          buffer,
        };
      }),
    );

    // Image-type attachments (png/jpg/jpeg/gif/webp) get downloaded +
    // resized to an embeddable thumbnail in parallel with everything else
    // (same Promise.all-per-row convention as the org-logo fetch above);
    // non-image attachments and any image whose download/resize fails just
    // get imageBuffer: undefined, which rfi-pdf.template.ts's
    // attachmentsBlock() falls back to the plain text line for.
    const attachmentRowsTyped = attachmentRows as Array<Record<string, unknown>>;
    const withImageBuffer = async (a: Record<string, unknown>) => {
      const filename = a.filename as string;
      const storageKey = a.storageKey as string | undefined;
      const imageBuffer = storageKey && this.isImageFilename(filename)
        ? await this.storage.download(storageKey).then((raw) => this.resizeAttachmentImage(raw)).catch(() => undefined)
        : undefined;
      return {
        filename,
        documentType: a.documentType as RfiDocumentType | undefined,
        documentTypeOther: a.documentTypeOther as string | undefined,
        imageBuffer,
      };
    };
    const [queryAttachments, responseAttachments] = await Promise.all([
      Promise.all(attachmentRowsTyped.filter((a) => (a.kind ?? 'query') === 'query').map(withImageBuffer)),
      Promise.all(attachmentRowsTyped.filter((a) => a.kind === 'response').map(withImageBuffer)),
    ]);

    const comments = (commentRows as Array<Record<string, unknown>>).map((c) => ({
      userName: c.userName as string | undefined,
      organizationSlot: c.organizationSlot as string | undefined,
      body: c.body as string,
      createdAt: new Date(c.createdAt as string).toLocaleString('en-GB'),
    }));
    const auditEvents = (auditRows as Array<Record<string, unknown>>).map((a) => ({
      action: a.action as string,
      userName: a.userName as string | undefined,
      occurredAt: new Date(a.occurredAt as string).toLocaleString('en-GB'),
    }));

    const summaryBuffer = await renderRfiPdf({
      logoBuffer,
      stampBuffer,
      organizations: orgLogos,
      comments,
      auditEvents,
      assignedToName: rfi.assignedToName as string | undefined,
      dueDate: rfi.dueDate ? new Date(rfi.dueDate as string).toLocaleDateString('en-GB') : undefined,
      costImpactLevel: (rfi.costImpactLevel as string | undefined) ?? (rfi.costImpact ? 'yes' : 'no'),
      costImpactAmount: rfi.costImpactAmount != null ? Number(rfi.costImpactAmount) : undefined,
      costImpactCurrency: rfi.costImpactCurrency as string | undefined,
      costImpactDescription: rfi.costImpactDescription as string | undefined,
      timeImpactLevel: (rfi.timeImpactLevel as string | undefined) ?? (rfi.timeImpact ? 'yes' : 'no'),
      timeImpactDays: rfi.timeImpactDays != null ? Number(rfi.timeImpactDays) : undefined,
      timeImpactDescription: rfi.timeImpactDescription as string | undefined,
      // Only rendered by the template if set -- an unsubmitted/legacy RFI
      // has no query_stamp/answer_stamp yet. "Uploaded By"/"date-time" mirror
      // exactly what RfiDetailPage's own StampPanel already shows on screen
      // for these two stamps (createdByName/updatedAt for the query stamp --
      // there's no dedicated "submitted at" column, and submit() is the only
      // thing that touches updated_at at that point; answeredByName/answeredAt
      // for the answer stamp) so the PDF and the live page never disagree.
      queryStamp: rfi.queryStamp
        ? { uploadedBy: rfi.createdByName as string | undefined, dateTime: new Date(rfi.updatedAt as string).toLocaleString('en-GB'), stamp: rfi.queryStamp as string }
        : undefined,
      answerStamp: rfi.answerStamp
        ? { uploadedBy: rfi.answeredByName as string | undefined, dateTime: rfi.answeredAt ? new Date(rfi.answeredAt as string).toLocaleString('en-GB') : undefined, stamp: rfi.answerStamp as string }
        : undefined,
      queryAttachments,
      responseAttachments,
      rfiNumber: (rfi.rfiNumber as string) ?? rfi.id as string,
      status: rfi.status as string,
      priority: rfi.priority as string,
      subject: rfi.subject as string,
      question: rfi.question as string,
      answer: rfi.answer as string | undefined,
      disciplineLabel: discipline ? RFI_DISCIPLINE_LABELS[discipline] : '—',
      disciplineOther: rfi.disciplineOther as string | undefined,
      projectName: (project?.name as string) ?? '—',
      projectCode: project?.code as string | undefined,
      createdByName: rfi.createdByName as string | undefined,
      createdAt: new Date(rfi.createdAt as string).toLocaleDateString('en-GB'),
      answeredByName: rfi.answeredByName as string | undefined,
      answeredAt: rfi.answeredAt ? new Date(rfi.answeredAt as string).toLocaleDateString('en-GB') : undefined,
    });

    // Appends the real, full content of every query/response attachment as
    // additional pages after the react-pdf summary -- the summary's own
    // attachment list (plain text lines + small in-summary image
    // thumbnails, both rendered above via renderRfiPdf()) is left entirely
    // untouched; this is a separate appendix, not a replacement.
    const buffer = await this.mergeAttachmentPdfs(summaryBuffer, attachmentRowsTyped);

    return { buffer, filename };
  }

  // Raster-image extensions eligible for inline PDF embedding (see
  // rfi-pdf.template.ts's attachmentsBlock()) -- everything else (pdf,
  // docx, dwg, etc.) has no reasonable inline-image treatment and keeps the
  // existing plain "• filename (type)" text line only.
  private static readonly IMAGE_ATTACHMENT_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp']);

  // Extensions that can actually be turned into real appendix PAGES (as
  // opposed to IMAGE_ATTACHMENT_EXTENSIONS above, which is only about the
  // small in-summary thumbnail and includes gif/webp -- neither of which
  // pdf-lib's embedJpg()/embedPng() can decode, and neither of which
  // ATTACHMENT_ALLOWED_EXTENSIONS even allows as a real upload today
  // anyway). xls/xlsx/doc/docx/zip have no document-conversion tooling
  // available in this environment (confirmed: no LibreOffice), so they
  // deliberately stay appendix-less -- the summary's existing
  // "• filename (type)" text line is their only representation, unchanged.
  private static readonly MERGEABLE_IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png']);

  private getFileExtension(filename: string): string {
    return filename.split('.').pop()?.toLowerCase() ?? '';
  }

  // Same label format as rfi-pdf.template.ts's own attachmentLabel() (kept
  // as a separate copy rather than exported/shared -- the template's
  // version formats a full "• filename (type)" line for react-pdf, this one
  // only needs the "(type)" fragment for the divider page).
  private attachmentTypeLabel(row: Record<string, unknown>): string {
    const documentType = row.documentType as RfiDocumentType | undefined;
    const documentTypeOther = row.documentTypeOther as string | undefined;
    const typeLabel = documentType ? RFI_DOCUMENT_TYPE_LABELS[documentType] : 'Other';
    const otherSuffix = documentType === 'other' && documentTypeOther ? ` — ${documentTypeOther}` : '';
    return `${typeLabel}${otherSuffix}`;
  }

  // Full-page section-marker page -- plain drawText(), not routed through
  // react-pdf (per the ticket: "no need to match the summary's exact
  // branded font, this is a functional section marker"). Bold heading +
  // regular filename/type line, per the ticket's explicit font split.
  private addAttachmentDividerPage(mainDoc: PDFDocument, headingFont: PDFFont, bodyFont: PDFFont, filename: string, typeLabel: string): void {
    const [pageWidth, pageHeight] = PageSizes.A4;
    const page = mainDoc.addPage(PageSizes.A4);
    const margin = 50;
    page.drawText('ATTACHMENT', {
      x: margin,
      y: pageHeight - margin - 24,
      size: 20,
      font: headingFont,
      color: rgb(0.04, 0.08, 0.11),
    });
    page.drawText(filename, {
      x: margin,
      y: pageHeight - margin - 54,
      size: 13,
      font: bodyFont,
      color: rgb(0.04, 0.08, 0.11),
    });
    page.drawText(`(${typeLabel})`, {
      x: margin,
      y: pageHeight - margin - 74,
      size: 10.5,
      font: bodyFont,
      color: rgb(0.29, 0.38, 0.47),
    });
  }

  // Downloads one attachment and appends its divider page + real content
  // pages to mainDoc. Deliberately swallows every failure here (bad
  // storage key, network error, corrupt/encrypted PDF pdf-lib can't
  // parse, corrupt image) -- a console.warn plus a skipped attachment,
  // never a thrown error, so one bad attachment can't take the rest of the
  // merged document (summary + every other attachment) down with it.
  private async appendAttachmentPages(mainDoc: PDFDocument, row: Record<string, unknown>, headingFont: PDFFont, bodyFont: PDFFont): Promise<void> {
    const filename = row.filename as string;
    const storageKey = row.storageKey as string | undefined;
    const ext = this.getFileExtension(filename);
    const isPdf = ext === 'pdf';
    const isMergeableImage = RfisService.MERGEABLE_IMAGE_EXTENSIONS.has(ext);
    if (!storageKey || (!isPdf && !isMergeableImage)) return; // xls/xlsx/doc/docx/zip/unknown -- text line only, no appendix page

    try {
      const bytes = await this.storage.download(storageKey);
      // pdf-lib's JpegEmbedder reads the SOI marker via `new
      // DataView(bytes.buffer)` with no byteOffset/length -- it assumes
      // bytes.buffer *is* the image, not a slice of a larger one. But
      // storage.download()'s Buffer.concat(chunks) returns the lone chunk
      // completely untouched whenever the S3 stream yields exactly one
      // chunk (Node's own Buffer.concat short-circuits for length-1
      // arrays), and that chunk is very often a pooled Buffer sliced out
      // of a larger internal allocation with a nonzero byteOffset --
      // confirmed live against this RFI's real site-photo.jpg attachment,
      // which pdf-lib rejected with "SOI not found in JPEG" even though
      // the bytes are a perfectly valid JPEG (sharp decodes it fine).
      // Uint8Array.from() copies into a fresh, byteOffset-0 buffer, which
      // sidesteps this for every pdf-lib embedder, not just JPEG's.
      const normalizedBytes = Uint8Array.from(bytes);
      const typeLabel = this.attachmentTypeLabel(row);

      // Build the real content FIRST and only add the divider page once
      // that succeeds -- if PDFDocument.load()/copyPages()/embedJpg()/
      // embedPng() throws (corrupt file, encrypted PDF, truncated image),
      // nothing has been added to mainDoc yet, so a failed attachment
      // never leaves a stray, content-less divider page behind.
      if (isPdf) {
        const attachmentDoc = await PDFDocument.load(normalizedBytes);
        const copiedPages = await mainDoc.copyPages(attachmentDoc, attachmentDoc.getPageIndices());
        this.addAttachmentDividerPage(mainDoc, headingFont, bodyFont, filename, typeLabel);
        copiedPages.forEach((p) => mainDoc.addPage(p));
      } else {
        const image = ext === 'png' ? await mainDoc.embedPng(normalizedBytes) : await mainDoc.embedJpg(normalizedBytes);
        const [pageWidth, pageHeight] = PageSizes.A4;
        const margin = 40;
        const { width, height } = image.scaleToFit(pageWidth - margin * 2, pageHeight - margin * 2);
        this.addAttachmentDividerPage(mainDoc, headingFont, bodyFont, filename, typeLabel);
        const page = mainDoc.addPage(PageSizes.A4);
        page.drawImage(image, { x: (pageWidth - width) / 2, y: (pageHeight - height) / 2, width, height });
      }
    } catch (err) {
      // Per-attachment failure only -- everything else (summary + every
      // other attachment) still comes through fine.
      console.warn(`[RfisService.generatePdf] Skipping attachment "${filename}" while merging PDF appendix: ${(err as Error)?.message ?? err}`);
    }
  }

  // Loads the react-pdf-rendered summary as a pdf-lib PDFDocument, then
  // appends divider + content pages for every query attachment (in the
  // same order as the summary's Query Attachments list), then every
  // response attachment -- one final PDFDocument, .save()'d once at the
  // end into the single Buffer the controller streams back.
  private async mergeAttachmentPdfs(summaryBuffer: Buffer, attachmentRows: Array<Record<string, unknown>>): Promise<Buffer> {
    const mainDoc = await PDFDocument.load(summaryBuffer);
    const headingFont = await mainDoc.embedFont(StandardFonts.HelveticaBold);
    const bodyFont = await mainDoc.embedFont(StandardFonts.Helvetica);

    const queryRows = attachmentRows.filter((a) => (a.kind ?? 'query') === 'query');
    const responseRows = attachmentRows.filter((a) => a.kind === 'response');

    for (const row of [...queryRows, ...responseRows]) {
      await this.appendAttachmentPages(mainDoc, row, headingFont, bodyFont);
    }

    const bytes = await mainDoc.save();
    return Buffer.from(bytes);
  }

  private isImageFilename(filename: string): boolean {
    const ext = filename.split('.').pop()?.toLowerCase() ?? '';
    return RfisService.IMAGE_ATTACHMENT_EXTENSIONS.has(ext);
  }

  // Resizes + re-encodes a query/response attachment image before it's
  // embedded in the PDF -- a handful of multi-MB phone screenshots/photos
  // would otherwise bloat the generated PDF into something unusable. 900px
  // on the longest side / JPEG quality 78 is deliberately smaller than
  // ImageProcessingProcessor's own 1920px "preview" rendition
  // (image-processing.processor.ts) -- these render as a ~150x110pt
  // thumbnail card in the PDF (see rfi-pdf.template.ts), not a full-page
  // image, so there's no reason to carry more pixels than that. fit:
  // 'inside' (never 'cover'/'fill') means the image is only ever shrunk to
  // fit within the box, never cropped -- aspect ratio is fully preserved
  // ("contain, not crop", per the ticket). .rotate() with no args
  // auto-applies the source image's own EXIF orientation before resizing,
  // same convention the capture-processing pipeline uses, so a sideways
  // phone photo doesn't render sideways in the PDF too.
  private async resizeAttachmentImage(buffer: Buffer): Promise<Buffer> {
    return sharp(buffer)
      .rotate()
      .resize(900, 900, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 78 })
      .toBuffer();
  }

  // PNG/JPEG magic-byte sniff -- the only two types the org-logo/project-
  // logo/stamp upload flows accept (see ManageMembersModal's/OrganizationSlotRow's
  // <input accept="image/jpeg,image/png">), so no need for anything fancier.
  // Defaults to JPEG when the signature doesn't match PNG, same fallback
  // rfi-xls.ts's old tryFetchImage() used for a non-PNG content-type.
  private detectImageMimeType(buffer: Buffer): string {
    const isPng = buffer.length >= 8
      && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47
      && buffer[4] === 0x0d && buffer[5] === 0x0a && buffer[6] === 0x1a && buffer[7] === 0x0a;
    return isPng ? 'image/png' : 'image/jpeg';
  }

  private toImageAsset(buffer?: Buffer): { base64: string; mimeType: string } | undefined {
    if (!buffer) return undefined;
    return { base64: buffer.toString('base64'), mimeType: this.detectImageMimeType(buffer) };
  }

  // Same-origin counterpart to generatePdf()'s image handling, for the XLS
  // export (apps/web/src/lib/rfi-xls.ts) -- exceljs's workbook.addImage()
  // needs raw image bytes, and fetching those straight from S3 presigned
  // URLs in a browser fetch() requires the bucket to send CORS headers for
  // the app's origin, which local MinIO's permissive default masks but a
  // real production bucket may not have configured. This reuses the exact
  // same this.storage.download(key).catch(() => undefined) pattern
  // generatePdf() already uses -- no CORS involved at all, since the
  // browser only ever talks to this same-origin API endpoint.
  async getExportAssets(companyId: string, projectId: string, rfiId: string) {
    const { project, organizations, attachmentRows } = await this.getPdfData(companyId, projectId, rfiId);

    const [logoBuffer, stampBuffer] = await Promise.all([
      project?.logoStorageKey ? this.storage.download(project.logoStorageKey as string).catch(() => undefined) : undefined,
      project?.stampStorageKey ? this.storage.download(project.stampStorageKey as string).catch(() => undefined) : undefined,
    ]);

    const orgsBySlot = new Map((organizations as Array<Record<string, unknown>>).map(o => [o.slot as string, o]));
    const orgAssets = await Promise.all(
      PROJECT_ORGANIZATION_SLOTS.map(async (slot) => {
        const org = orgsBySlot.get(slot);
        const key = org?.logoStorageKey as string | undefined;
        const buffer = key ? await this.storage.download(key).catch(() => undefined) : undefined;
        const asset = this.toImageAsset(buffer);
        return { slot, base64: asset?.base64, mimeType: asset?.mimeType };
      }),
    );

    // Same small-thumbnail treatment generatePdf() gives image-type query/
    // response attachments (see withImageBuffer() there) -- reuses the
    // exact same isImageFilename()/resizeAttachmentImage() pair, just keyed
    // by attachment id instead of embedded directly into a PDF page. Only
    // image-type rows are worth the round trip; non-image attachments (pdf/
    // doc/xls/zip) have no thumbnail either way and rfi-xls.ts already
    // renders them as a plain text line.
    const imageAttachmentRows = (attachmentRows as Array<Record<string, unknown>>)
      .filter((a) => this.isImageFilename(a.filename as string));
    const attachmentAssets = await Promise.all(
      imageAttachmentRows.map(async (a) => {
        const storageKey = a.storageKey as string;
        const buffer = await this.storage.download(storageKey)
          .then((raw) => this.resizeAttachmentImage(raw))
          .catch(() => undefined);
        const asset = this.toImageAsset(buffer);
        return { id: a.id as string, base64: asset?.base64, mimeType: asset?.mimeType };
      }),
    );

    return {
      logo: this.toImageAsset(logoBuffer),
      stamp: this.toImageAsset(stampBuffer),
      organizations: orgAssets,
      attachments: attachmentAssets,
    };
  }

  async update(companyId: string, projectId: string, rfiId: string, userId: string, dto: UpdateRfiDto) {
    const existing = await this.findOne(companyId, projectId, rfiId);
    const isAnswering = dto.status === 'answered' && existing.status !== 'answered';

    // Same precedence as create(): an explicit *Level field wins; otherwise
    // derive from the legacy boolean if that was provided; otherwise leave
    // both untouched (COALESCE keeps the existing value). Kept in sync so
    // neither shape can drift from the other.
    const costImpactLevel: RfiImpactLevel | undefined =
      dto.costImpactLevel ?? (dto.costImpact !== undefined ? (dto.costImpact ? 'yes' : 'no') : undefined);
    const costImpactBool = dto.costImpactLevel !== undefined ? dto.costImpactLevel === 'yes' : dto.costImpact;
    const timeImpactLevel: RfiImpactLevel | undefined =
      dto.timeImpactLevel ?? (dto.timeImpact !== undefined ? (dto.timeImpact ? 'yes' : 'no') : undefined);
    const timeImpactBool = dto.timeImpactLevel !== undefined ? dto.timeImpactLevel === 'yes' : dto.timeImpact;

    // withTenant required -- see create() above.
    const [updated] = await this.db.withTenant(companyId, sql => sql`
      UPDATE rfis SET
        subject                  = COALESCE(${dto.subject ?? null}, subject),
        question                 = COALESCE(${dto.question ?? null}, question),
        answer                   = COALESCE(${dto.answer ?? null}, answer),
        status                   = COALESCE(${dto.status ?? null}, status),
        priority                 = COALESCE(${dto.priority ?? null}, priority),
        discipline               = COALESCE(${dto.discipline ?? null}, discipline),
        discipline_other         = COALESCE(${dto.disciplineOther ?? null}, discipline_other),
        cost_impact               = COALESCE(${costImpactBool ?? null}, cost_impact),
        time_impact               = COALESCE(${timeImpactBool ?? null}, time_impact),
        cost_impact_level         = COALESCE(${costImpactLevel ?? null}, cost_impact_level),
        cost_impact_amount        = COALESCE(${dto.costImpactAmount ?? null}, cost_impact_amount),
        cost_impact_currency      = COALESCE(${dto.costImpactCurrency ?? null}, cost_impact_currency),
        cost_impact_description   = COALESCE(${dto.costImpactDescription ?? null}, cost_impact_description),
        time_impact_level         = COALESCE(${timeImpactLevel ?? null}, time_impact_level),
        time_impact_days          = COALESCE(${dto.timeImpactDays ?? null}, time_impact_days),
        time_impact_description   = COALESCE(${dto.timeImpactDescription ?? null}, time_impact_description),
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

  // ── Attachments ───────────────────────────────────────────────────────────
  // Same presigned-PUT pattern, allow-list, and size cap as issues.service.ts's
  // attachment methods -- RFIs have no activity/comment thread to hang these
  // off, so they're their own flat table (rfi_attachments) instead.
  async getAttachmentUploadUrl(companyId: string, projectId: string, dto: RfiAttachmentUploadUrlDto) {
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

    const key = this.storage.generateKey(companyId, projectId, 'rfi-attachments', dto.filename);
    const { uploadUrl } = await this.storage.getUploadUrl(key, 'application/octet-stream', dto.sizeBytes);
    return { uploadUrl, storageKey: key };
  }

  // Step 2: client already PUT the bytes to `storageKey` from step 1 --
  // this registers it as a new rfi_attachments row. kind/documentType/etc.
  // are all optional -- omitting them keeps the DB defaults ('query'/'other')
  // from migration 028, so older callers that don't know about kinds yet
  // still work unchanged.
  async addAttachment(companyId: string, rfiId: string, userId: string, dto: AddRfiAttachmentDto) {
    const [attachment] = await this.db.withTenant(companyId, sql => sql`
      INSERT INTO rfi_attachments (
        rfi_id, company_id, storage_key, filename, size_bytes, uploaded_by,
        kind, document_type, document_type_other, revision, description, comment_id
      ) VALUES (
        ${rfiId}, ${companyId}, ${dto.storageKey}, ${dto.filename}, ${dto.sizeBytes}, ${userId},
        ${dto.kind ?? 'query'}, ${dto.documentType ?? 'other'}, ${dto.documentTypeOther ?? null},
        ${dto.revision ?? null}, ${dto.description ?? null}, ${dto.commentId ?? null}
      )
      RETURNING *
    `);
    return attachment;
  }

  async getAttachments(companyId: string, rfiId: string) {
    const rows = await this.db.withTenant(companyId, sql => sql`
      SELECT ra.*, u.first_name || ' ' || u.last_name AS uploaded_by_name
      FROM rfi_attachments ra
      LEFT JOIN users u ON u.id = ra.uploaded_by
      WHERE ra.rfi_id = ${rfiId} AND ra.company_id = ${companyId}
      ORDER BY ra.uploaded_at DESC
    `);
    // Resolve storage keys to live presigned read URLs at read time --
    // never persist a URL that can expire, same convention as everywhere
    // else in this codebase.
    const urls = await this.storage.resolveUrls(rows.map(r => r.storageKey as string));
    return rows.map(r => ({ ...r, attachmentReadUrl: urls.get(r.storageKey as string) }));
  }

  async deleteAttachment(companyId: string, rfiId: string, attachmentId: string) {
    const result = await this.db.withTenant(companyId, sql => sql`
      DELETE FROM rfi_attachments
      WHERE id = ${attachmentId} AND rfi_id = ${rfiId} AND company_id = ${companyId}
    `);
    if (result.count === 0) throw new NotFoundException(`Attachment ${attachmentId} not found.`);
    return { message: 'Attachment deleted.' };
  }

  // ── Workflow (Phase 1) ──────────────────────────────────────────────────────
  // Resource-level authorization for submit() -- "is the creator" can't be
  // expressed by the route-level ProjectPermissionGuard alone (a creator
  // with no grant must still be able to submit their own RFI), so this
  // mirrors the guard's own bypass logic (super_admin, project_lead,
  // manage_rfis grant) for the "not the creator" branch. The four
  // reviewer-only transitions below (requestClarification/respond/close/
  // reopen) are gated at the route with @RequireProjectPermission('manage_rfis')
  // instead -- that guard already covers this exact same bypass set, so
  // those methods don't repeat the check.
  private async canManageRfiReview(companyId: string, projectId: string, userId: string): Promise<boolean> {
    return this.db.withTenant(companyId, async (sql) => {
      const [user] = await sql`SELECT company_role FROM users WHERE id = ${userId} AND company_id = ${companyId}`;
      if (user?.companyRole === 'super_admin') return true;

      const [membership] = await sql`
        SELECT role FROM project_members WHERE project_id = ${projectId} AND user_id = ${userId}
      `;
      if (membership?.role === 'project_lead') return true;

      const [grant] = await sql`
        SELECT id FROM project_permission_grants
        WHERE project_id = ${projectId} AND user_id = ${userId} AND permission = 'manage_rfis'
      `;
      return Boolean(grant);
    });
  }

  // Deterministic, unique-per-RFI stamp sequence: counts how many RFIs in
  // this project already carry a stamp in the given column and adds one.
  // Format: `{rfiNumber}-Q-{seq}` / `{rfiNumber}-A-{seq}`, zero-padded to 3
  // digits (judgment call -- ticket left the exact format open as long as
  // it's deterministic and unique per RFI; documented here for review).
  private async nextStampSequence(companyId: string, projectId: string, column: 'query_stamp' | 'answer_stamp'): Promise<number> {
    const [row] = await this.db.withTenant(companyId, sql => (
      column === 'query_stamp'
        ? sql`SELECT COUNT(*) AS n FROM rfis WHERE project_id = ${projectId} AND query_stamp IS NOT NULL`
        : sql`SELECT COUNT(*) AS n FROM rfis WHERE project_id = ${projectId} AND answer_stamp IS NOT NULL`
    ));
    return Number(row.n) + 1;
  }

  // Explicit, semantic audit_log write for a named lifecycle event -- adds
  // to, does not replace, the generic AuditInterceptor coverage every
  // mutating RFI route already gets. user_email/user_name are left null
  // here (only user_id is known at this layer); the generic interceptor
  // entry for the same request carries the full actor identity.
  private async writeRfiAudit(
    companyId: string,
    projectId: string,
    userId: string,
    rfiId: string,
    resourceLabel: string | null,
    action: string,
    changes: Record<string, unknown> | null,
    metadata: Record<string, unknown> | null = null,
  ): Promise<void> {
    await this.db.withTenant(companyId, sql => sql`
      INSERT INTO audit_log (
        company_id, project_id, user_id, action, resource_type, resource_id,
        resource_label, changes, metadata, source
      ) VALUES (
        ${companyId}, ${projectId}, ${userId}, ${action}, 'rfi', ${rfiId},
        ${resourceLabel}, ${changes ? JSON.stringify(changes) : null},
        ${metadata ? JSON.stringify(metadata) : null}, 'api'
      )
    `);
  }

  // draft -> submitted. Not reachable through the existing create() method
  // (which always sets status='open', i.e. the legacy equivalent of
  // 'submitted' itself) -- this becomes reachable once a later phase adds
  // an explicit "save as draft" creation path. Implemented per the state
  // machine as specified regardless, so it's correct the moment that
  // exists.
  async submit(companyId: string, projectId: string, rfiId: string, userId: string) {
    const rfi = await this.findOne(companyId, projectId, rfiId);
    const isCreator = rfi.createdBy === userId;
    if (!isCreator) {
      const authorized = await this.canManageRfiReview(companyId, projectId, userId);
      if (!authorized) {
        throw new ForbiddenException(
          "Only this RFI's creator, someone holding the 'manage_rfis' permission, the project lead, or a super admin can submit it.",
        );
      }
    }

    const oldStatus = rfi.status as string;
    if (oldStatus !== 'draft') {
      throw new BadRequestException(`RFI cannot be submitted from status '${oldStatus}'. Only a 'draft' RFI can be submitted.`);
    }

    const seq = await this.nextStampSequence(companyId, projectId, 'query_stamp');
    const queryStamp = `${rfi.rfiNumber as string}-Q-${String(seq).padStart(3, '0')}`;

    const [updated] = await this.db.withTenant(companyId, sql => sql`
      UPDATE rfis SET status = 'submitted', query_stamp = ${queryStamp}, updated_at = NOW()
      WHERE id = ${rfiId} AND project_id = ${projectId} AND company_id = ${companyId}
      RETURNING *
    `);

    await this.writeRfiAudit(companyId, projectId, userId, rfiId, rfi.subject as string, 'rfi.submitted', {
      previousValue: oldStatus,
      newValue: 'submitted',
    });

    if (updated.assignedTo && updated.assignedTo !== userId) {
      await this.notifications.create(companyId, {
        userId: updated.assignedTo as string,
        type: 'rfi_submitted',
        title: `RFI ${rfi.rfiNumber as string} was submitted: ${rfi.subject as string}`,
        resourceType: 'rfi',
        projectId,
        resourceId: rfiId,
        createdBy: userId,
      });
    }

    return updated;
  }

  // (submitted|open|under_review) -> awaiting_clarification. Route-gated
  // with @RequireProjectPermission('manage_rfis') -- reviewer-only, no
  // creator bypass, so no additional check here.
  async requestClarification(companyId: string, projectId: string, rfiId: string, userId: string, dto: RequestClarificationDto) {
    const rfi = await this.findOne(companyId, projectId, rfiId);
    const oldStatus = rfi.status as string;
    if (!CLARIFICATION_SOURCE_STATUSES.has(oldStatus)) {
      throw new BadRequestException(`RFI cannot move to 'awaiting_clarification' from status '${oldStatus}'.`);
    }

    const [updated] = await this.db.withTenant(companyId, sql => sql`
      UPDATE rfis SET status = 'awaiting_clarification', updated_at = NOW()
      WHERE id = ${rfiId} AND project_id = ${projectId} AND company_id = ${companyId}
      RETURNING *
    `);

    await this.writeRfiAudit(
      companyId, projectId, userId, rfiId, rfi.subject as string, 'rfi.clarification_requested',
      { previousValue: oldStatus, newValue: 'awaiting_clarification' },
      { reasonText: dto.reason },
    );

    if (rfi.createdBy !== userId) {
      await this.notifications.create(companyId, {
        userId: rfi.createdBy as string,
        type: 'rfi_clarification_requested',
        title: `Clarification requested on RFI ${rfi.rfiNumber as string}: ${rfi.subject as string}`,
        resourceType: 'rfi',
        projectId,
        resourceId: rfiId,
        createdBy: userId,
      });
    }

    return updated;
  }

  // (submitted|open|under_review|awaiting_clarification) -> responded.
  // Route-gated with @RequireProjectPermission('manage_rfis') -- reviewer-only.
  async respond(companyId: string, projectId: string, rfiId: string, userId: string, dto: RespondToRfiDto) {
    const rfi = await this.findOne(companyId, projectId, rfiId);
    const oldStatus = rfi.status as string;
    if (!RESPOND_SOURCE_STATUSES.has(oldStatus)) {
      throw new BadRequestException(`RFI cannot move to 'responded' from status '${oldStatus}'.`);
    }

    const seq = await this.nextStampSequence(companyId, projectId, 'answer_stamp');
    const answerStamp = `${rfi.rfiNumber as string}-A-${String(seq).padStart(3, '0')}`;

    const [updated] = await this.db.withTenant(companyId, sql => sql`
      UPDATE rfis SET
        answer       = ${dto.answer},
        answered_at  = NOW(),
        answered_by  = ${userId},
        status       = 'responded',
        answer_stamp = ${answerStamp},
        updated_at   = NOW()
      WHERE id = ${rfiId} AND project_id = ${projectId} AND company_id = ${companyId}
      RETURNING *
    `);

    // Two distinct audit rows, as specced -- stamp generation is its own
    // auditable event, separate from the response submission itself.
    await this.writeRfiAudit(companyId, projectId, userId, rfiId, rfi.subject as string, 'rfi.response_submitted', {
      previousValue: oldStatus,
      newValue: 'responded',
    });
    await this.writeRfiAudit(companyId, projectId, userId, rfiId, rfi.subject as string, 'rfi.answer_stamp_generated', {
      previousValue: null,
      newValue: answerStamp,
    });

    if (rfi.createdBy !== userId) {
      await this.notifications.create(companyId, {
        userId: rfi.createdBy as string,
        type: 'rfi_responded',
        title: `RFI ${rfi.rfiNumber as string} was answered: ${rfi.subject as string}`,
        resourceType: 'rfi',
        projectId,
        resourceId: rfiId,
        createdBy: userId,
      });
    }

    return updated;
  }

  // Any non-terminal status -> closed. Deliberate manager override: closing
  // is legal from any active status, not just responded/answered ("RFI
  // Manager: Full control, Close RFI" per spec) -- documented here as an
  // intentional broadening, not an oversight. Route-gated with
  // @RequireProjectPermission('manage_rfis').
  async close(companyId: string, projectId: string, rfiId: string, userId: string) {
    const rfi = await this.findOne(companyId, projectId, rfiId);
    const oldStatus = rfi.status as string;
    if (RFI_TERMINAL_STATUSES.has(oldStatus)) {
      throw new BadRequestException(`RFI is already in a terminal status ('${oldStatus}') and cannot be closed again.`);
    }

    const [updated] = await this.db.withTenant(companyId, sql => sql`
      UPDATE rfis SET status = 'closed', updated_at = NOW()
      WHERE id = ${rfiId} AND project_id = ${projectId} AND company_id = ${companyId}
      RETURNING *
    `);

    await this.writeRfiAudit(companyId, projectId, userId, rfiId, rfi.subject as string, 'rfi.closed', {
      previousValue: oldStatus,
      newValue: 'closed',
    });

    if (rfi.createdBy !== userId) {
      await this.notifications.create(companyId, {
        userId: rfi.createdBy as string,
        type: 'rfi_closed',
        title: `RFI ${rfi.rfiNumber as string} was closed: ${rfi.subject as string}`,
        resourceType: 'rfi',
        projectId,
        resourceId: rfiId,
        createdBy: userId,
      });
    }

    return updated;
  }

  // closed -> responded only. Judgment call: always reopens to 'responded'
  // rather than reading the prior status (which could have been 'answered')
  // off the most recent 'rfi.closed' audit_log row -- the ticket explicitly
  // allowed either; this is the simpler, deterministic option. Route-gated
  // with @RequireProjectPermission('manage_rfis').
  async reopen(companyId: string, projectId: string, rfiId: string, userId: string) {
    const rfi = await this.findOne(companyId, projectId, rfiId);
    const oldStatus = rfi.status as string;
    if (oldStatus !== 'closed') {
      throw new BadRequestException(`Only a 'closed' RFI can be reopened (current status: '${oldStatus}').`);
    }

    const [updated] = await this.db.withTenant(companyId, sql => sql`
      UPDATE rfis SET status = 'responded', updated_at = NOW()
      WHERE id = ${rfiId} AND project_id = ${projectId} AND company_id = ${companyId}
      RETURNING *
    `);

    await this.writeRfiAudit(companyId, projectId, userId, rfiId, rfi.subject as string, 'rfi.reopened', {
      previousValue: oldStatus,
      newValue: 'responded',
    });

    if (rfi.createdBy !== userId) {
      await this.notifications.create(companyId, {
        userId: rfi.createdBy as string,
        type: 'rfi_reopened',
        title: `RFI ${rfi.rfiNumber as string} was reopened: ${rfi.subject as string}`,
        resourceType: 'rfi',
        projectId,
        resourceId: rfiId,
        createdBy: userId,
      });
    }

    return updated;
  }

  // ── Comments ─────────────────────────────────────────────────────────────
  async addComment(companyId: string, projectId: string, rfiId: string, userId: string, dto: AddRfiCommentDto) {
    const rfi = await this.findOne(companyId, projectId, rfiId);

    const [comment] = await this.db.withTenant(companyId, sql => sql`
      INSERT INTO rfi_comments (rfi_id, company_id, user_id, organization_slot, body)
      VALUES (${rfiId}, ${companyId}, ${userId}, ${dto.organizationSlot ?? null}, ${dto.body})
      RETURNING *
    `);

    await this.writeRfiAudit(
      companyId, projectId, userId, rfiId, rfi.subject as string, 'rfi.comment_added',
      { previousValue: null, newValue: dto.body },
      { commentId: comment.id },
    );

    // Notify created_by + assigned_to, deduped -- same person (and never
    // the commenter themself) only gets notified once.
    const recipients = new Set<string>();
    if (rfi.createdBy && rfi.createdBy !== userId) recipients.add(rfi.createdBy as string);
    if (rfi.assignedTo && rfi.assignedTo !== userId) recipients.add(rfi.assignedTo as string);

    for (const recipientId of recipients) {
      await this.notifications.create(companyId, {
        userId: recipientId,
        type: 'rfi_comment_added',
        title: `New comment on RFI ${rfi.rfiNumber as string}: ${rfi.subject as string}`,
        resourceType: 'rfi',
        projectId,
        resourceId: rfiId,
        createdBy: userId,
      });
    }

    return comment;
  }

  async getComments(companyId: string, rfiId: string) {
    return this.db.withTenant(companyId, sql => sql`
      SELECT c.*, u.first_name || ' ' || u.last_name AS user_name
      FROM rfi_comments c
      LEFT JOIN users u ON u.id = c.user_id
      WHERE c.rfi_id = ${rfiId} AND c.company_id = ${companyId}
      ORDER BY c.created_at ASC
    `);
  }
}
