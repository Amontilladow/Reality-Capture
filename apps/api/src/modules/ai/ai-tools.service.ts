import { Injectable, Logger } from '@nestjs/common';
import { RfisService } from '../rfis/rfis.service';
import { IssuesService } from '../issues/issues.service';
import { SnaggingService } from '../snagging/snagging.service';
import { RiskService } from '../risk/risk.service';
import { ProgressReportsService } from '../progress-reports/progress-reports.service';
import { DocumentsService } from '../documents/documents.service';
import { ProjectsService } from '../projects/projects.service';
import { AiClientService } from '../ai-client/ai-client.service';

export interface ToolResult {
  tool: string;
  category: string;
  data: unknown;
}

export interface AssistantContext {
  companyId: string;
  projectId: string;
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
    private readonly aiClient: AiClientService,
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
    const page = await this.rfis.findAll(ctx.companyId, ctx.projectId, { status: 'open', page: 1, perPage: limit });
    return {
      tool: 'getOpenRfis', category: 'rfi',
      data: (page.data as Record<string, unknown>[]).map((r) => ({
        rfiNumber: r.rfiNumber, subject: r.subject, priority: r.priority,
        discipline: r.discipline, dueDate: r.dueDate, assignedToName: r.assignedToName,
      })),
    };
  }

  async getRfiDetails(ctx: AssistantContext, rfiId: string): Promise<ToolResult> {
    const rfi = await this.rfis.findOne(ctx.companyId, ctx.projectId, rfiId) as Record<string, unknown>;
    return {
      tool: 'getRfiDetails', category: 'rfi',
      data: {
        rfiNumber: rfi.rfiNumber, subject: rfi.subject, question: rfi.question, answer: rfi.answer,
        status: rfi.status, priority: rfi.priority, discipline: rfi.discipline, dueDate: rfi.dueDate,
        assignedToName: rfi.assignedToName, createdByName: rfi.createdByName,
      },
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
    const issue = await this.issues.findOne(ctx.companyId, ctx.projectId, issueId) as Record<string, unknown>;
    return {
      tool: 'getIssueDetails', category: 'issue',
      data: {
        issueNumber: issue.issueNumber, title: issue.title, description: issue.description,
        status: issue.status, priority: issue.priority, discipline: issue.discipline,
        deadline: issue.deadline, assignedToName: issue.assignedToName,
      },
    };
  }

  async getOpenSnags(ctx: AssistantContext, limit = 10): Promise<ToolResult> {
    const snags = await this.snagging.getOpenList(ctx.companyId, ctx.projectId, limit);
    return { tool: 'getOpenSnags', category: 'snag', data: snags };
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
}
