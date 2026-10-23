import { Injectable } from '@nestjs/common';
import { PDFDocument, PDFFont, StandardFonts, rgb, PageSizes } from 'pdf-lib';
import { DatabaseService } from '../../database/database.service';
import { StorageService } from '../storage/storage.service';
import { IssuesService } from '../issues/issues.service';
import { SnaggingService } from '../snagging/snagging.service';
import { RfisService } from '../rfis/rfis.service';
import { QaqcService } from '../qaqc/qaqc.service';
import { RiskService } from '../risk/risk.service';
import { AiClientService } from '../ai-client/ai-client.service';
import { BimService } from '../bim/bim.service';
import { renderReportsPdf, type ReportsPdfSectionData } from './reports-pdf.template';

@Injectable()
export class ReportsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly storage: StorageService,
    private readonly issues: IssuesService,
    private readonly snagging: SnaggingService,
    private readonly rfis: RfisService,
    private readonly qaqc: QaqcService,
    private readonly risk: RiskService,
    private readonly aiClient: AiClientService,
    private readonly bim: BimService,
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
  // payload for GET /reports/kpis. RFIs join this payload for the first
  // time here (previously Reports covered only Issues + Snagging) --
  // rfis.summary reuses RfisService.getSummary() completely unchanged
  // (same total/open/answered/overdue shape RfisPage's own stat tiles
  // already depend on), while the new drawing-impact rollup lives in the
  // sibling getKpiBreakdown()/getDrawingUpdatesNotApplied() methods.
  async getKpis(companyId: string, projectId: string) {
    const [
      project,
      issuesSummary, issuesBreakdown, issuesOpen,
      snaggingSummary, snaggingBreakdown, snaggingOpen,
      rfisSummary, rfisBreakdown, rfisNotApplied,
      qaqcSummary, qaqcBreakdown, qaqcOpen,
    ] = await Promise.all([
      this.getProject(companyId, projectId),
      this.issues.getSummary(companyId, projectId),
      this.issues.getKpiBreakdown(companyId, projectId),
      this.issues.getOpenList(companyId, projectId),
      this.snagging.getSummary(companyId, projectId),
      this.snagging.getKpiBreakdown(companyId, projectId),
      this.snagging.getOpenList(companyId, projectId),
      this.rfis.getSummary(companyId, projectId),
      this.rfis.getKpiBreakdown(companyId, projectId),
      this.rfis.getDrawingUpdatesNotApplied(companyId, projectId),
      this.qaqc.getSummary(companyId, projectId),
      this.qaqc.getKpiBreakdown(companyId, projectId),
      this.qaqc.getOpenList(companyId, projectId),
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
      rfis: {
        summary: rfisSummary,
        byDrawingImpact: rfisBreakdown.byDrawingImpact,
        drawingUpdateStatus: rfisBreakdown.drawingUpdateStatus,
        notAppliedList: rfisNotApplied,
      },
      // QAQC NCR/SOR -- brief §6. summary/byRecordType split NCR vs SOR
      // counts separately (not merged), per the brief's explicit ask.
      qaqc: {
        summary: qaqcSummary,
        byRecordType: qaqcBreakdown.byRecordType,
        byStatus: qaqcBreakdown.byStatus,
        byPriority: qaqcBreakdown.byPriority,
        openList: qaqcOpen,
      },
    };
  }

  // ── Company-wide executive summary (Phase 4 cross-project view) ────────
  //
  // Reuses the exact same per-project getSummary()/getExecutiveSummary()
  // methods the single-project Reports/Risk pages already call -- nothing
  // here is a new calculation. The only new thing is looping those calls
  // over every project in the company (in parallel) instead of one, and
  // returning the lean summary fields each project needs for its
  // priority-signal ranking, never the full breakdown/openList payload
  // getKpis() returns (those are heavy and unused at company scale).
  async getCompanySummary(companyId: string) {
    const projects = await this.db.withTenant(companyId, sql => sql<{ id: string; name: string; code: string | null }[]>`
      SELECT id, name, code FROM projects
      WHERE company_id = ${companyId} AND status != 'archived'
      ORDER BY created_at DESC
    `);

    const rows = await Promise.all(projects.map(async (project) => {
      const [risk, issuesSummary, snaggingSummary, rfisSummary, qaqcSummary, models] = await Promise.all([
        this.risk.getExecutiveSummary(companyId, project.id),
        this.issues.getSummary(companyId, project.id),
        this.snagging.getSummary(companyId, project.id),
        this.rfis.getSummary(companyId, project.id),
        this.qaqc.getSummary(companyId, project.id),
        this.bim.getModels(companyId, project.id),
      ]);
      // Same signal ExecutiveBriefing.tsx already derives per-project
      // client-side (filtering listBimModels() by status==='failed') --
      // reused here, not reinvented, so a failed model counts the same way
      // at both scopes.
      const bimFailedCount = (models as unknown as { status: string }[]).filter(m => m.status === 'failed').length;

      return {
        projectId: project.id,
        projectName: project.name,
        projectCode: project.code ?? undefined,
        risk: {
          criticalCount: risk.criticalCount,
          overdueCount: risk.overdueCount,
          totalOpenRisks: risk.totalOpenRisks,
          overallScore: risk.overallScore,
          overallLevel: risk.overallLevel,
        },
        issues: { critical: issuesSummary.critical, overdue: issuesSummary.overdue, total: issuesSummary.total },
        snagging: { overdue: snaggingSummary.overdue, total: snaggingSummary.total },
        rfis: { overdue: rfisSummary.overdue, total: rfisSummary.total },
        qaqc: { critical: qaqcSummary.critical, overdue: qaqcSummary.overdue, total: qaqcSummary.total },
        bimFailedCount,
      };
    }));

    return { projects: rows };
  }

  // ── AI reasoning layer (Phase 4 extension of Risk's existing one) ───────
  //
  // Same reasoning as RiskService.generateAiBriefing()'s own comment: the AI
  // never computes a figure and never sees raw project data -- it only
  // receives a plain-text context string built here from the exact same
  // already-computed KPIs/risk summary the deterministic conclusion panel
  // on this page already shows, and turns it into a short, structured
  // briefing. Degrades to an explicit "unavailable" result (never a 500,
  // never a fabricated narrative) if there's nothing to summarize, the AI
  // service is unreachable, or its response doesn't contain a usable
  // conclusion.
  async generateAiBriefing(companyId: string, projectId: string): Promise<StructuredBriefing | { unavailable: true; reason: string }> {
    const [kpis, risk] = await Promise.all([
      this.getKpis(companyId, projectId),
      this.risk.getExecutiveSummary(companyId, projectId).catch(() => null),
    ]);

    const hasActivity = kpis.issues.summary.total > 0 || kpis.snagging.summary.total > 0
      || kpis.rfis.summary.total > 0 || kpis.qaqc.summary.total > 0 || (risk?.totalOpenRisks ?? 0) > 0;
    if (!hasActivity) {
      return { unavailable: true, reason: 'No data recorded on this project yet to summarize.' };
    }

    const context = buildReportsBriefingContext(kpis, risk);
    try {
      const { narrative } = await this.aiClient.generateReportsBriefing(companyId, projectId, context);
      const parsed = parseStructuredBriefing(narrative);
      if (!parsed.conclusion) {
        return { unavailable: true, reason: 'AI briefing is not available right now.' };
      }
      return parsed;
    } catch (err) {
      console.warn(`[ReportsService.generateAiBriefing] AI reports briefing generation failed: ${err instanceof Error ? err.message : String(err)}`);
      return { unavailable: true, reason: 'AI briefing is not available right now.' };
    }
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

// ── Pure AI-briefing helpers (exported for direct unit testing, same
// pattern as risk.service.ts's buildRiskBriefingContext/computeProjectRiskIndex) ──

type Kpis = Awaited<ReturnType<ReportsService['getKpis']>>;
type RiskSummary = Awaited<ReturnType<RiskService['getExecutiveSummary']>> | null;

export interface StructuredBriefing {
  conclusion: string;
  drivers: string[];
  impact: string;
  action: string;
  evidence: string[];
}

/** Grounds the Reports AI briefing in the exact same figures the deterministic conclusion panel already shows -- nothing new computed here. */
export function buildReportsBriefingContext(kpis: Kpis, risk: RiskSummary): string {
  const lines: string[] = [];
  lines.push(`Issues: ${kpis.issues.summary.total} total, ${kpis.issues.summary.critical} critical, ${kpis.issues.summary.overdue} overdue.`);
  lines.push(`Snagging: ${kpis.snagging.summary.total} total, ${kpis.snagging.summary.overdue} overdue.`);
  lines.push(`RFIs: ${kpis.rfis.summary.total} total, ${kpis.rfis.summary.overdue} overdue.`);
  lines.push(`QA/QC: ${kpis.qaqc.summary.total} total, ${kpis.qaqc.summary.critical} critical, ${kpis.qaqc.summary.overdue} overdue.`);
  if (risk) {
    lines.push(`Risk: overall score ${risk.overallScore}/100 (${risk.overallLevel}), ${risk.totalOpenRisks} open risks, ${risk.criticalCount} critical, ${risk.overdueCount} overdue mitigation items.`);
  } else {
    lines.push('Risk: no risk data currently available.');
  }
  return lines.join('\n');
}

const BRIEFING_LABELS = ['CONCLUSION', 'DRIVERS', 'IMPACT', 'ACTION', 'EVIDENCE'] as const;

/**
 * Parses the model's CONCLUSION:/DRIVERS:/IMPACT:/ACTION:/EVIDENCE: labeled
 * text (the exact format reports.py's SYSTEM prompt requires) into a
 * structured object. Tolerant of a missing label (that field comes back
 * empty, never guessed) and of DRIVERS/EVIDENCE not being " | "-separated
 * (falls back to the whole line as a single item) -- a model that drifts
 * from the requested format should degrade gracefully, not crash the request.
 */
export function parseStructuredBriefing(raw: string): StructuredBriefing {
  const fields: Record<string, string> = {};
  for (const label of BRIEFING_LABELS) {
    const match = new RegExp(`^${label}:\\s*(.+)$`, 'im').exec(raw);
    if (match) fields[label] = match[1].trim();
  }
  const splitList = (text?: string) => (text ? text.split('|').map(s => s.trim()).filter(Boolean) : []);
  return {
    conclusion: fields.CONCLUSION ?? '',
    drivers: splitList(fields.DRIVERS),
    impact: fields.IMPACT ?? '',
    action: fields.ACTION ?? '',
    evidence: splitList(fields.EVIDENCE),
  };
}
