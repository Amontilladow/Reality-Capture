import { Injectable, Logger } from '@nestjs/common';
import { RfisService } from '../rfis/rfis.service';
import { IssuesService } from '../issues/issues.service';
import { SnaggingService } from '../snagging/snagging.service';
import { RiskService } from '../risk/risk.service';
import { ProgressReportsService } from '../progress-reports/progress-reports.service';
import { DocumentsService } from '../documents/documents.service';
import { ProjectsService } from '../projects/projects.service';
import { DrawingsService } from '../drawings/drawings.service';
import { AiClientService } from '../ai-client/ai-client.service';
import { QaqcService } from '../qaqc/qaqc.service';
import { SubmittalsService } from '../submittals/submittals.service';
import { TransmittalsService } from '../transmittals/transmittals.service';
import { QaService } from '../qa/qa.service';

export interface ToolResult {
  tool: string;
  category: string;
  data: unknown;
}

export interface AssistantContext {
  companyId: string;
  projectId: string;
  // The authenticated user asking the question -- required so RFI/Issue
  // tools can pass it as viewerId to RfisService/IssuesService's own
  // subcontractor-isolation check (isViewerSubcontractor). Without it, that
  // check silently no-ops (viewerId undefined -> isolateToViewer false) and
  // a subcontractor asking the assistant sees every other subcontractor's
  // records too -- the exact leak that check exists to prevent on the
  // regular REST routes. See getOpenRfis/getRfiDetails/getIssueDetails.
  userId: string;
  // What the user is currently looking at in the app, if anything -- lets
  // "why is this high risk?" resolve without the user re-explaining what
  // "this" is (spec section 18).
  currentResourceType?: 'issue' | 'rfi' | 'snag_item';
  currentResourceId?: string;
}

// Every method here enforces tenancy exactly like the equivalent read route
// already does (companyId from the authenticated session, projectId from
// the route/context -- never client-controllable beyond that), and returns
// a small, already-aggregated/trimmed shape -- never a raw table dump (spec
// section 8 and 10's "minimal context principle"). Reuses the SAME service
// methods the normal REST endpoints call, so there is exactly one place
// (RfisService, IssuesService, ...) that owns the actual query/authorization
// logic -- these wrappers only shape the result down to what the model
// needs to answer, and tag it with a resource-type source for citation.
@Injectable()
export class AiToolsService {
  private readonly logger = new Logger(AiToolsService.name);

  constructor(
    private readonly rfis: RfisService,
    private readonly issues: IssuesService,
    private readonly snagging: SnaggingService,
    private readonly risk: RiskService,
    private readonly progressReports: ProgressReportsService,
    private readonly documents: DocumentsService,
    private readonly projects: ProjectsService,
    private readonly drawings: DrawingsService,
    private readonly aiClient: AiClientService,
    private readonly qaqc: QaqcService,
    private readonly submittals: SubmittalsService,
    private readonly transmittals: TransmittalsService,
    private readonly qa: QaService,
  ) {}

  async getProjectSummary(ctx: AssistantContext): Promise<ToolResult> {
    const project = await this.projects.findOne(ctx.companyId, ctx.projectId) as unknown as Record<string, unknown>;
    return {
      tool: 'getProjectSummary', category: 'project',
      data: {
        name: project.name, code: project.code, status: project.status,
        memberCount: project.memberCount, openIssueCount: project.openIssueCount,
        startDate: project.startDate, expectedEndDate: project.expectedEndDate,
      },
    };
  }

  async getOpenRfis(ctx: AssistantContext, limit = 10): Promise<ToolResult> {
    const page = await this.rfis.findAll(ctx.companyId, ctx.projectId, { status: 'open', page: 1, perPage: limit }, ctx.userId);
    return {
      tool: 'getOpenRfis', category: 'rfi',
      data: (page.data as Record<string, unknown>[]).map((r) => ({
        rfiNumber: r.rfiNumber, subject: r.subject, priority: r.priority,
        discipline: r.discipline, dueDate: r.dueDate, assignedToName: r.assignedToName,
      })),
    };
  }

  async getRfiDetails(ctx: AssistantContext, rfiId: string): Promise<ToolResult> {
    const rfi = await this.rfis.findOne(ctx.companyId, ctx.projectId, rfiId, ctx.userId) as Record<string, unknown>;
    return {
      tool: 'getRfiDetails', category: 'rfi',
      data: {
        rfiNumber: rfi.rfiNumber, subject: rfi.subject, question: rfi.question, answer: rfi.answer,
        status: rfi.status, priority: rfi.priority, discipline: rfi.discipline, dueDate: rfi.dueDate,
        assignedToName: rfi.assignedToName, createdByName: rfi.createdByName,
      },
    };
  }

  // NCR/SOR/WIR/MIR all live in qaqc_records (record_type discriminator) --
  // getOpenNcrs covers the one users actually ask the assistant about
  // ("open NCRs"); QaqcService.findAll's recordType filter already supports
  // sor/wir/mir the same way if those are ever needed here too.
  async getOpenNcrs(ctx: AssistantContext, limit = 10): Promise<ToolResult> {
    const page = await this.qaqc.findAll(ctx.companyId, ctx.projectId, { recordType: 'ncr', status: 'open', page: 1, perPage: limit });
    return {
      tool: 'getOpenNcrs', category: 'qaqc',
      data: (page.data as Record<string, unknown>[]).map((r) => ({
        recordNumber: r.recordNumber, subject: r.subject, priority: r.priority,
        discipline: r.discipline, dueDate: r.dueDate, assignedToName: r.assignedToName,
      })),
    };
  }

  async getOpenSors(ctx: AssistantContext, limit = 10): Promise<ToolResult> {
    const page = await this.qaqc.findAll(ctx.companyId, ctx.projectId, { recordType: 'sor', status: 'open', page: 1, perPage: limit });
    return {
      tool: 'getOpenSors', category: 'qaqc',
      data: (page.data as Record<string, unknown>[]).map((r) => ({
        recordNumber: r.recordNumber, subject: r.subject, priority: r.priority,
        discipline: r.discipline, dueDate: r.dueDate, assignedToName: r.assignedToName,
      })),
    };
  }

  async getOpenWirs(ctx: AssistantContext, limit = 10): Promise<ToolResult> {
    const page = await this.qaqc.findAll(ctx.companyId, ctx.projectId, { recordType: 'wir', status: 'open', page: 1, perPage: limit });
    return {
      tool: 'getOpenWirs', category: 'qaqc',
      data: (page.data as Record<string, unknown>[]).map((r) => ({
        recordNumber: r.recordNumber, subject: r.subject, priority: r.priority,
        discipline: r.discipline, dueDate: r.dueDate, assignedToName: r.assignedToName,
      })),
    };
  }

  async getOpenMirs(ctx: AssistantContext, limit = 10): Promise<ToolResult> {
    const page = await this.qaqc.findAll(ctx.companyId, ctx.projectId, { recordType: 'mir', status: 'open', page: 1, perPage: limit });
    return {
      tool: 'getOpenMirs', category: 'qaqc',
      data: (page.data as Record<string, unknown>[]).map((r) => ({
        recordNumber: r.recordNumber, subject: r.subject, priority: r.priority,
        discipline: r.discipline, dueDate: r.dueDate, assignedToName: r.assignedToName,
      })),
    };
  }

  // Submittals: same trailing-viewerId isolation convention as RFIs. No
  // single "open" status exists (submitted/under_review/approved/
  // approved_as_noted/revise_and_resubmit/rejected), so "open" here means
  // still awaiting a review outcome.
  async getOpenSubmittals(ctx: AssistantContext, limit = 10): Promise<ToolResult> {
    const page = await this.submittals.findAll(ctx.companyId, ctx.projectId, { page: 1, perPage: 100 }, ctx.userId);
    const pending = (page.data as Record<string, unknown>[])
      .filter((s) => s.status === 'submitted' || s.status === 'under_review')
      .slice(0, limit);
    return {
      tool: 'getOpenSubmittals', category: 'submittal',
      data: pending.map((s) => ({
        submittalNumber: s.submittalNumber, title: s.title, status: s.status, priority: s.priority,
        discipline: s.discipline, dueDate: s.dueDate, assignedToName: s.assignedToName,
      })),
    };
  }

  // Transmittals: no subcontractor isolation (by design, same as Snagging/
  // QAQC/QA Inspections). No single "open" status (draft/sent/
  // acknowledged/void), so this returns the most recent ones rather than
  // filtering to a status the user didn't actually ask about.
  async getRecentTransmittals(ctx: AssistantContext, limit = 10): Promise<ToolResult> {
    const page = await this.transmittals.findAll(ctx.companyId, ctx.projectId, { page: 1, perPage: limit });
    return {
      tool: 'getRecentTransmittals', category: 'transmittal',
      data: (page.data as Record<string, unknown>[]).map((t) => ({
        transmittalNumber: t.transmittalNumber, subject: t.subject, status: t.status,
        recipientName: t.recipientName, recipientCompany: t.recipientCompany, dueDate: t.dueDate,
      })),
    };
  }

  // QA Inspections: no subcontractor isolation. Statuses are
  // scheduled/in_progress (pending) and passed/passed_with_exceptions/failed
  // (outcomes) -- "open" here means not yet completed.
  async getOpenInspections(ctx: AssistantContext, limit = 10): Promise<ToolResult> {
    const page = await this.qa.findAll(ctx.companyId, ctx.projectId, { page: 1, perPage: 100 });
    const pending = (page.data as Record<string, unknown>[])
      .filter((i) => i.status === 'scheduled' || i.status === 'in_progress')
      .slice(0, limit);
    return {
      tool: 'getOpenInspections', category: 'inspection',
      data: pending.map((i) => ({
        inspectionNumber: i.inspectionNumber, title: i.title, inspectionType: i.inspectionType,
        location: i.location, status: i.status, assignedToName: i.assignedToName, inspectionDate: i.inspectionDate,
      })),
    };
  }

  async getHighRiskIssues(ctx: AssistantContext, limit = 10): Promise<ToolResult> {
    const risks = await this.risk.getTopRisks(ctx.companyId, ctx.projectId, limit);
    return {
      tool: 'getHighRiskIssues', category: 'risk',
      data: risks.map((r) => ({
        title: r.title, category: r.category, discipline: r.discipline,
        level: r.level, score: r.score, trend: r.trend, status: r.status, dueDate: r.dueDate,
      })),
    };
  }

  async getIssueDetails(ctx: AssistantContext, issueId: string): Promise<ToolResult> {
    const issue = await this.issues.findOne(ctx.companyId, ctx.projectId, issueId, ctx.userId) as Record<string, unknown>;
    return {
      tool: 'getIssueDetails', category: 'issue',
      data: {
        issueNumber: issue.issueNumber, title: issue.title, description: issue.description,
        status: issue.status, priority: issue.priority, discipline: issue.discipline,
        deadline: issue.deadline, assignedToName: issue.assignedToName,
      },
    };
  }

  // Issues list: isolation is driven by query.userId here (not a trailing
  // param) -- IssuesService.findAll's own isViewerSubcontractor check reads
  // it off the query object, unlike RfisService/SubmittalsService.
  async getOpenIssues(ctx: AssistantContext, limit = 10): Promise<ToolResult> {
    const page = await this.issues.findAll(ctx.companyId, ctx.projectId, {
      status: 'open', page: 1, perPage: limit, userId: ctx.userId,
    });
    return {
      tool: 'getOpenIssues', category: 'issue',
      data: (page.data as Record<string, unknown>[]).map((i) => ({
        issueNumber: i.issueNumber, title: i.title, priority: i.priority,
        discipline: i.discipline, deadline: i.deadline, assignedToName: i.assignedToName,
      })),
    };
  }

  async getOpenSnags(ctx: AssistantContext, limit = 10): Promise<ToolResult> {
    const snags = await this.snagging.getOpenList(ctx.companyId, ctx.projectId, limit);
    return { tool: 'getOpenSnags', category: 'snag', data: snags };
  }

  async getSnagDetails(ctx: AssistantContext, snagId: string): Promise<ToolResult> {
    const snag = await this.snagging.findOne(ctx.companyId, ctx.projectId, snagId) as Record<string, unknown>;
    return {
      tool: 'getSnagDetails', category: 'snag',
      data: {
        title: snag.title, description: snag.description, status: snag.status,
        priority: snag.priority, trade: snag.trade, location: snag.location,
        buildingName: snag.buildingName, levelName: snag.levelName,
        assignedToName: snag.assignedToName, dueDate: snag.dueDate,
      },
    };
  }

  // Floor Plans (spec sections 16-21): a per-level listing, trimmed to what
  // the assistant needs to answer "which drawings cover level 3?" etc --
  // never the full capture-pin payload the real floor-plan viewer needs.
  async getFloorPlanDetails(ctx: AssistantContext, levelId?: string): Promise<ToolResult> {
    const rows = await this.drawings.findAll(ctx.companyId, ctx.projectId, levelId) as unknown as Record<string, unknown>[];
    return {
      tool: 'getFloorPlanDetails', category: 'drawing',
      data: rows.map((d) => ({
        title: d.title, levelName: d.levelName, revision: d.revision,
        isCurrent: d.isCurrent, linkedCaptureCount: d.linkedCaptureCount,
      })),
    };
  }

  async getRiskSummary(ctx: AssistantContext): Promise<ToolResult> {
    const summary = await this.risk.getExecutiveSummary(ctx.companyId, ctx.projectId);
    return { tool: 'getRiskSummary', category: 'risk', data: summary };
  }

  // Context-aware (spec section 18): when the user is currently viewing a
  // specific issue/RFI/snag and asks "why is this high risk?", resolve the
  // risk row for that exact entity rather than making them name it again.
  async getRiskForCurrentResource(ctx: AssistantContext): Promise<ToolResult | null> {
    if (!ctx.currentResourceType || !ctx.currentResourceId) return null;
    const nodeType = ctx.currentResourceType === 'snag_item' ? 'snag_item' : ctx.currentResourceType;
    const risk = await this.risk.getRiskByEntity(ctx.companyId, nodeType as 'issue' | 'rfi' | 'snag_item', ctx.currentResourceId);
    if (!risk) return null;
    return {
      tool: 'getRiskForCurrentResource', category: 'risk',
      data: {
        title: risk.title, level: risk.level, score: risk.score, trend: risk.trend,
        explanation: risk.explanation, recommendedAction: risk.recommendedAction,
        probability: risk.probability, impact: risk.impact,
      },
    };
  }

  async getProgressSummary(ctx: AssistantContext): Promise<ToolResult> {
    // No explicit date range requested yet (routeIntent() doesn't parse one
    // out of the question today) -- default to the last 30 days, a
    // reasonable "recent progress" window matching how a PM would read
    // "summarize progress this month" without over-promising date-range
    // parsing this pass doesn't actually do.
    const dateTo = new Date();
    const dateFrom = new Date(dateTo.getTime() - 30 * 86_400_000);
    const report = await this.progressReports.generate(ctx.companyId, ctx.projectId, {
      dateFrom: dateFrom.toISOString(), dateTo: dateTo.toISOString(),
    });
    const data = report as unknown as Record<string, unknown>;
    return {
      tool: 'getProgressSummary', category: 'progress',
      data: {
        captureCount: data.captureCount,
        newIssues: (data.newIssues as unknown[])?.length,
        closedIssues: (data.closedIssues as unknown[])?.length,
        overdueIssues: (data.overdueIssues as unknown[])?.length,
        blockers: (data.blockers as unknown[])?.length,
        elementProgress: (data as { elementProgress?: { overallCompletionPct?: number } }).elementProgress?.overallCompletionPct,
      },
    };
  }

  async getOverdueItems(ctx: AssistantContext): Promise<ToolResult> {
    const [rfiSummary, issueSummary, snagSummary] = await Promise.all([
      this.rfis.getSummary(ctx.companyId, ctx.projectId),
      this.issues.getSummary(ctx.companyId, ctx.projectId),
      this.snagging.getSummary(ctx.companyId, ctx.projectId),
    ]);
    return {
      tool: 'getOverdueItems', category: 'progress',
      data: {
        overdueRfis: (rfiSummary as Record<string, unknown>).overdue,
        overdueIssues: (issueSummary as Record<string, unknown>).overdue,
        overdueSnags: (snagSummary as Record<string, unknown>).overdue,
      },
    };
  }

  async getLatestReports(ctx: AssistantContext): Promise<ToolResult> {
    const docs = await this.documents.findAll(ctx.companyId, ctx.projectId, { docType: 'inspection_record', page: 1, perPage: 5 });
    return {
      tool: 'getLatestReports', category: 'document',
      data: (docs.data as Record<string, unknown>[]).map((d) => ({
        title: d.title, documentNumber: d.documentNumber, revision: d.revision, documentDate: d.documentDate,
      })),
    };
  }

  // Semantic search (documents, captures, issues, timeline) via the
  // narrowed Python ai-service /search/ endpoint -- the only tool that
  // isn't a direct Postgres read, since full-text/semantic matching over
  // unstructured content is what Qdrant+embeddings are for, not SQL.
  async searchProjectDocuments(ctx: AssistantContext, query: string, limit = 6): Promise<ToolResult> {
    try {
      const result = await this.aiClient.search(ctx.companyId, ctx.projectId, query, undefined, limit);
      return {
        tool: 'searchProjectDocuments', category: 'document',
        data: result.results.map((r) => ({ type: r.resource_type, id: r.resource_id, score: r.score, preview: r.text_preview })),
      };
    } catch (err) {
      this.logger.warn(`searchProjectDocuments failed: ${err instanceof Error ? err.message : String(err)}`);
      return { tool: 'searchProjectDocuments', category: 'document', data: [] };
    }
  }

  // ── Draft tools (spec section 9) ────────────────────────────────────────
  // These never touch the database. They return a structured, pre-filled
  // draft the frontend renders in the existing RfiFormModal/IssueFormModal
  // (Edit/Submit) -- only the user's own explicit Submit click calls the
  // real, already-authorized createRfi/createIssue API. The AI has no write
  // path of its own.

  createRfiDraft(subject: string, question: string, discipline: string, priority: 'critical' | 'high' | 'medium' | 'low' = 'medium'): ToolResult {
    return {
      tool: 'createRfiDraft', category: 'rfi',
      data: { subject, question, discipline, priority },
    };
  }

  createIssueDraft(title: string, description: string, discipline: string, priority: 'critical' | 'high' | 'medium' | 'low' = 'medium', issueType = 'general'): ToolResult {
    const deadline = new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10);
    return {
      tool: 'createIssueDraft', category: 'issue',
      data: { title, description, discipline, priority, issueType, deadline },
    };
  }

  createSnagDraft(title: string, description: string, trade: string, priority: 'critical' | 'high' | 'medium' | 'low' = 'medium'): ToolResult {
    const dueDate = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
    return {
      tool: 'createSnagDraft', category: 'snag',
      data: { title, description, trade, priority, dueDate },
    };
  }
}
