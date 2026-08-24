import { Injectable } from '@nestjs/common';
import { PDFDocument, PDFFont, StandardFonts, rgb, PageSizes } from 'pdf-lib';
import { DatabaseService } from '../../database/database.service';
import { StorageService } from '../storage/storage.service';
import { IssuesService } from '../issues/issues.service';
import { SnaggingService } from '../snagging/snagging.service';
import { renderReportsPdf, type ReportsPdfSectionData } from './reports-pdf.template';

@Injectable()
export class ReportsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly storage: StorageService,
    private readonly issues: IssuesService,
    private readonly snagging: SnaggingService,
  ) {}

  // withTenant required -- projects carries the tenant_isolation RLS policy,
  // same reasoning as rfis.service.ts's own project lookups.
  private async getProject(companyId: string, projectId: string) {
    const [project] = await this.db.withTenant(companyId, sql => sql`
      SELECT name, code FROM projects WHERE id = ${projectId} AND company_id = ${companyId}
    `);
    return project as { name?: string; code?: string } | undefined;
  }

  // Combines Issues + Snagging's existing getSummary() with the two new
  // sibling methods (getKpiBreakdown/getOpenList) each service gained for
  // this feature -- everything fetched in parallel, folded into one JSON
  // payload for GET /reports/kpis.
  async getKpis(companyId: string, projectId: string) {
    const [project, issuesSummary, issuesBreakdown, issuesOpen, snaggingSummary, snaggingBreakdown, snaggingOpen] = await Promise.all([
      this.getProject(companyId, projectId),
      this.issues.getSummary(companyId, projectId),
      this.issues.getKpiBreakdown(companyId, projectId),
      this.issues.getOpenList(companyId, projectId),
      this.snagging.getSummary(companyId, projectId),
      this.snagging.getKpiBreakdown(companyId, projectId),
      this.snagging.getOpenList(companyId, projectId),
    ]);

    return {
      project: { name: project?.name, code: project?.code },
      issues: {
        summary: issuesSummary,
        byStatus: issuesBreakdown.byStatus,
        byPriority: issuesBreakdown.byPriority,
        byDiscipline: issuesBreakdown.byDiscipline,
        openList: issuesOpen,
      },
      snagging: {
        summary: snaggingSummary,
        byStatus: snaggingBreakdown.byStatus,
        byPriority: snaggingBreakdown.byPriority,
        byTrade: snaggingBreakdown.byTrade,
        openList: snaggingOpen,
      },
    };
  }

  async generatePdf(companyId: string, projectId: string): Promise<{ buffer: Buffer; filename: string }> {
    const kpis = await this.getKpis(companyId, projectId);

    const issuesSummary = kpis.issues.summary as Record<string, unknown>;
    const snaggingSummary = kpis.snagging.summary as Record<string, unknown>;
    const toNum = (v: unknown) => Number(v ?? 0);

    const issuesSection: ReportsPdfSectionData = {
      title: 'Issues',
      summaryTiles: [
        { label: 'Total', value: toNum(issuesSummary.total) },
        { label: 'Open', value: toNum(issuesSummary.open) },
        { label: 'In Progress', value: toNum(issuesSummary.inProgress) },
        { label: 'Resolved', value: toNum(issuesSummary.resolved) },
        { label: 'Closed', value: toNum(issuesSummary.closed) },
        { label: 'Critical', value: toNum(issuesSummary.critical) },
        { label: 'Overdue', value: toNum(issuesSummary.overdue) },
      ],
      byStatus: kpis.issues.byStatus,
      byPriority: kpis.issues.byPriority,
      byCategory: kpis.issues.byDiscipline,
      categoryLabel: 'Discipline',
      openItems: (kpis.issues.openList as Array<Record<string, unknown>>).map((row) => ({
        number: (row.issueNumber as string | null) ?? (row.id as string),
        title: row.title as string,
        status: row.status as string,
        priority: row.priority as string,
        category: (row.discipline as string | null) ?? undefined,
        dueDate: row.deadline ? new Date(row.deadline as string).toLocaleDateString('en-GB') : undefined,
        assignedToName: (row.assignedToName as string | null) ?? undefined,
      })),
    };

    const snaggingSection: ReportsPdfSectionData = {
      title: 'Snag Items',
      summaryTiles: [
        { label: 'Total', value: toNum(snaggingSummary.total) },
        { label: 'Open', value: toNum(snaggingSummary.open) },
        { label: 'Fixed', value: toNum(snaggingSummary.fixed) },
        { label: 'Verified', value: toNum(snaggingSummary.verified) },
        { label: 'Overdue', value: toNum(snaggingSummary.overdue) },
      ],
      byStatus: kpis.snagging.byStatus,
      byPriority: kpis.snagging.byPriority,
      byCategory: kpis.snagging.byTrade,
      categoryLabel: 'Trade',
      openItems: (kpis.snagging.openList as Array<Record<string, unknown>>).map((row) => ({
        number: (row.snagNumber as string | null) ?? (row.id as string),
        title: row.title as string,
        status: row.status as string,
        priority: row.priority as string,
        category: (row.trade as string | null) ?? undefined,
        dueDate: row.dueDate ? new Date(row.dueDate as string).toLocaleDateString('en-GB') : undefined,
        assignedToName: (row.assignedToName as string | null) ?? undefined,
      })),
    };

    const summaryBuffer = await renderReportsPdf({
      projectName: kpis.project.name ?? '—',
      projectCode: kpis.project.code,
      generatedAt: new Date().toLocaleString('en-GB'),
      issues: issuesSection,
      snagging: snaggingSection,
    });

    // Every `documents` row registered as this project's report material
    // (doc_type = 'report_attachment', migration 033) -- merged in as real
    // extra pages after the react-pdf summary, exact same algorithm as
    // rfis.service.ts's generatePdf() appendix. Queried directly rather than
    // through DocumentsService -- DocumentsModule exports only DocumentsService
    // itself (no dedicated "list by doc_type" method exists there), and this
    // is a simple, tenant-scoped read with no need for findAll()'s pagination/
    // search-vector machinery.
    const attachmentRows = await this.db.withTenant(companyId, sql => sql`
      SELECT id, title, storage_key
      FROM documents
      WHERE project_id = ${projectId} AND company_id = ${companyId} AND doc_type = 'report_attachment'
      ORDER BY created_at ASC
    `);

    const buffer = await this.mergeAttachmentPdfs(summaryBuffer, attachmentRows as Array<Record<string, unknown>>);

    const date = new Date().toISOString().slice(0, 10);
    const filename = `${kpis.project.code ?? 'project'}-report-${date}.pdf`;

    return { buffer, filename };
  }

  // ── Attachment merge (private) ───────────────────────────────────────────
  // Adapted from rfis.service.ts's exact same trio
  // (addAttachmentDividerPage / appendAttachmentPages / mergeAttachmentPdfs)
  // -- private to this service, not shared/exported, mirroring how RfisService
  // keeps them private today. `documents` rows have no dedicated `filename`
  // column (unlike rfi_attachments) -- `title` stands in as the display
  // name, and the file extension is read off `storage_key` instead (see
  // StorageService.generateKey(), which preserves the original extension).
  private static readonly MERGEABLE_IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png']);

  private getFileExtension(value: string): string {
    return value.split('.').pop()?.toLowerCase() ?? '';
  }

  private addAttachmentDividerPage(mainDoc: PDFDocument, headingFont: PDFFont, bodyFont: PDFFont, title: string): void {
    const [, pageHeight] = PageSizes.A4;
    const page = mainDoc.addPage(PageSizes.A4);
    const margin = 50;
    page.drawText('ATTACHMENT', {
      x: margin,
      y: pageHeight - margin - 24,
      size: 20,
      font: headingFont,
      color: rgb(0.04, 0.08, 0.11),
    });
    page.drawText(title, {
      x: margin,
      y: pageHeight - margin - 54,
      size: 13,
      font: bodyFont,
      color: rgb(0.04, 0.08, 0.11),
    });
  }

  // Downloads one report attachment and appends its divider page + real
  // content pages to mainDoc. Deliberately swallows every failure here (bad
  // storage key, network error, corrupt/encrypted PDF, corrupt image) --
  // console.warn plus a skipped attachment, never a thrown error, same
  // isolation guarantee as rfis.service.ts's appendAttachmentPages().
  private async appendAttachmentPages(mainDoc: PDFDocument, row: Record<string, unknown>, headingFont: PDFFont, bodyFont: PDFFont): Promise<void> {
    const title = (row.title as string | null) ?? 'Attachment';
    const storageKey = row.storageKey as string | undefined;
    const ext = this.getFileExtension(storageKey ?? title);
    const isPdf = ext === 'pdf';
    const isMergeableImage = ReportsService.MERGEABLE_IMAGE_EXTENSIONS.has(ext);
    if (!storageKey || (!isPdf && !isMergeableImage)) return; // no reasonable inline treatment -- skipped, not an error

    try {
      const bytes = await this.storage.download(storageKey);
      // Same normalization rfis.service.ts's appendAttachmentPages() applies
      // and documents in full there -- pdf-lib's embedders assume
      // bytes.buffer IS the image, not a slice of a pooled Buffer, which
      // storage.download()'s Buffer.concat() can return unmodified for a
      // single-chunk stream. Uint8Array.from() copies into a fresh,
      // byteOffset-0 buffer, sidestepping this for every pdf-lib embedder.
      const normalizedBytes = Uint8Array.from(bytes);

      // Build the real content FIRST and only add the divider page once
      // that succeeds -- a failed attachment must never leave an orphan
      // divider page with no content behind it.
      if (isPdf) {
        const attachmentDoc = await PDFDocument.load(normalizedBytes);
        const copiedPages = await mainDoc.copyPages(attachmentDoc, attachmentDoc.getPageIndices());
        this.addAttachmentDividerPage(mainDoc, headingFont, bodyFont, title);
        copiedPages.forEach((p) => mainDoc.addPage(p));
      } else {
        const image = ext === 'png' ? await mainDoc.embedPng(normalizedBytes) : await mainDoc.embedJpg(normalizedBytes);
        const [pageWidth, pageHeight] = PageSizes.A4;
        const margin = 40;
        const { width, height } = image.scaleToFit(pageWidth - margin * 2, pageHeight - margin * 2);
        this.addAttachmentDividerPage(mainDoc, headingFont, bodyFont, title);
        const page = mainDoc.addPage(PageSizes.A4);
        page.drawImage(image, { x: (pageWidth - width) / 2, y: (pageHeight - height) / 2, width, height });
      }
    } catch (err) {
      console.warn(`[ReportsService.generatePdf] Skipping attachment "${title}" while merging PDF appendix: ${(err as Error)?.message ?? err}`);
    }
  }

  private async mergeAttachmentPdfs(summaryBuffer: Buffer, attachmentRows: Array<Record<string, unknown>>): Promise<Buffer> {
    const mainDoc = await PDFDocument.load(summaryBuffer);
    const headingFont = await mainDoc.embedFont(StandardFonts.HelveticaBold);
    const bodyFont = await mainDoc.embedFont(StandardFonts.Helvetica);

    for (const row of attachmentRows) {
      await this.appendAttachmentPages(mainDoc, row, headingFont, bodyFont);
    }

    const bytes = await mainDoc.save();
    return Buffer.from(bytes);
  }
}
