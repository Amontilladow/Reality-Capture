import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AuthenticatedUser } from '@engineeringos/types';
import { DomainGuardService } from './domain-guard.service';
import { AiUsageService } from './ai-usage.service';
import { AiToolsService, type AssistantContext, type ToolResult } from './ai-tools.service';
import { ProviderFactory } from './providers/provider.factory';
import { AiConnectionsService } from '../ai-connections/ai-connections.service';
import { SiteRoleService } from '../../common/authorization/site-role.service';
import { AI_SYSTEM_PROMPT } from './ai-system-prompt';
import type { AskAssistantDto } from './dto/ask-assistant.dto';
import type { AIMessage, AIProvider } from './providers/ai-provider.interface';

export interface AskAssistantResult {
  answer: string;
  blocked?: boolean;
  draft?: { type: 'rfi' | 'issue' | 'snag'; fields: Record<string, unknown> };
  toolsUsed: string[];
  remainingQuota: { dailyUsed: number; dailyLimit: number };
}

// CTO spec sections 16-21: Site Engineer/Construction Manager/Project
// Engineer have full working access to Issues and Snagging (so AI drafts
// for those stay enabled), but RFIs sit outside their three allowed
// modules -- the assistant must decline to draft one for them, with this
// exact message, rather than silently producing a draft the create
// endpoint would reject anyway.
const RFI_DRAFT_RESTRICTED_MESSAGE = 'Your current RealityCapture role does not have permission to create RFIs. I can help you review the issue or prepare information for an authorized user.';

export class AssistantQuotaExceededError extends Error {
  constructor(message: string, public readonly reason: 'daily_limit' | 'rate_limit') { super(message); }
}

// Prevents retrieved/stored free-text (an issue description, an RFI
// question someone typed) from forging a closing </context> tag and
// injecting fake instructions into the prompt -- same mitigation the
// Python ai-service's old /assistant/ endpoint used, ported here since
// this Gateway now owns prompt construction. Applied to every string value
// pulled from a tool result before it's ever concatenated into the prompt.
function escapeForContext(value: unknown): unknown {
  if (typeof value === 'string') return value.replace(/</g, '‹').replace(/>/g, '›');
  if (Array.isArray(value)) return value.map(escapeForContext);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, escapeForContext(v)]));
  }
  return value;
}

function buildContextBlock(results: ToolResult[]): string {
  if (results.length === 0) return 'No matching project data was found for this question.';
  return results
    .map((r) => `<context type="${r.tool}">${JSON.stringify(escapeForContext(r.data))}</context>`)
    .join('\n');
}

// Deterministic, zero-cost intent routing (no LLM call just to decide which
// tool to use -- spec section 10's minimal-context principle applies to
// tool selection too, not just the final context payload). Checked in
// order; draft intents are checked first since "draft an RFI about this
// issue" would otherwise also match the plain RFI-lookup pattern below.
type Intent =
  | { kind: 'draft_rfi' } | { kind: 'draft_issue' } | { kind: 'draft_snag' }
  | { kind: 'tools'; tools: string[] };

function routeIntent(question: string, ctx: AssistantContext): Intent {
  const q = question.toLowerCase();
  const wantsDraft = /\b(draft|write|create|raise|log|compose)\b/.test(q);

  if (wantsDraft && /\brfi\b/.test(q)) return { kind: 'draft_rfi' };
  if (wantsDraft && /\bsnag/.test(q)) return { kind: 'draft_snag' };
  if (wantsDraft && /\bissue\b/.test(q)) return { kind: 'draft_issue' };

  const tools: string[] = [];
  if (ctx.currentResourceType && ctx.currentResourceId && /\brisk\b|\bwhy\b/.test(q)) tools.push('getRiskForCurrentResource');
  if (/\brfi\b/.test(q)) tools.push(ctx.currentResourceType === 'rfi' ? 'getRfiDetails' : 'getOpenRfis');
  if (/\bsnag/.test(q)) tools.push(ctx.currentResourceType === 'snag_item' && ctx.currentResourceId ? 'getSnagDetails' : 'getOpenSnags');
  if (/\brisk\b|\bhigh[\s-]risk\b/.test(q)) tools.push('getHighRiskIssues', 'getRiskSummary');
  if (/\bissue\b/.test(q) && ctx.currentResourceType === 'issue') tools.push('getIssueDetails');
  if (/\bfloor\s?plan|\bdrawing(s)?\b/.test(q)) tools.push('getFloorPlanDetails');
  if (/\boverdue\b/.test(q)) tools.push('getOverdueItems');
  if (/\bprogress\b/.test(q)) tools.push('getProgressSummary');
  if (/\breport(s)?\b/.test(q)) tools.push('getLatestReports');
  if (/\bdocument(s)?\b/.test(q)) tools.push('searchProjectDocuments');
  if (tools.length === 0 || /\bsummar(y|ize|ise)\b/.test(q)) tools.push('getProjectSummary');

  return { kind: 'tools', tools: Array.from(new Set(tools)).slice(0, 4) };
}

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  constructor(
    private readonly domainGuard: DomainGuardService,
    private readonly usage: AiUsageService,
    private readonly tools: AiToolsService,
    private readonly providerFactory: ProviderFactory,
    private readonly aiConnections: AiConnectionsService,
    private readonly siteRole: SiteRoleService,
    private readonly config: ConfigService,
  ) {}

  // Spec sections 5-8: a user's own BYO AI connection, when present, answers
  // in their place -- it never bypasses the domain guard, tools, permissions
  // or draft-then-confirm flow above/below it, it only changes which model
  // runs and who pays for it. Falls back to RealityCapture's own provider
  // (ProviderFactory) when the user has no connection configured.
  private async resolveProvider(user: AuthenticatedUser): Promise<{ provider: AIProvider; mode: 'realitycapture' | 'byo' }> {
    const byo = await this.aiConnections.getProviderForUser(user.companyId, user.id).catch((err: unknown) => {
      this.logger.warn(`BYO provider resolution failed, falling back to RealityCapture AI: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    });
    if (byo) return { provider: byo, mode: 'byo' };
    return { provider: this.providerFactory.getProvider(), mode: 'realitycapture' };
  }

  async getRemainingQuota(user: AuthenticatedUser) {
    return this.usage.getRemaining(user.id, user.companyRole);
  }

  async ask(user: AuthenticatedUser, projectId: string, dto: AskAssistantDto): Promise<AskAssistantResult> {
    const ctx: AssistantContext = {
      companyId: user.companyId,
      projectId,
      currentResourceType: dto.context?.currentResourceType,
      currentResourceId: dto.context?.currentResourceId,
    };

    // ── 1. Domain guard — runs before anything else costs money or quota ──
    // Not treated as an error: it's a normal, successful response that
    // happens to decline the question (spec section 22's "identify when a
    // request is outside the assistant's scope"), so the frontend can
    // render it in the conversation like any other assistant turn, just
    // styled distinctly via `blocked`.
    const guard = this.domainGuard.evaluate(dto.question);
    if (!guard.inDomain) {
      this.usage.log({
        companyId: user.companyId, projectId, userId: user.id, userRole: user.companyRole,
        status: 'blocked', blockReason: guard.reason,
      });
      const remaining = await this.usage.getRemaining(user.id, user.companyRole);
      return { answer: DomainGuardService.REJECTION_MESSAGE, blocked: true, toolsUsed: [], remainingQuota: remaining };
    }

    // ── 1.5 Role-aware draft blocking — deterministic, same zero-cost
    // philosophy as the domain guard: a restricted-role user asking for an
    // RFI draft is declined before it ever reaches usage limits or a
    // provider call (CTO spec sections 16-21). Issues and Snagging stay
    // fully enabled for these roles, so only an RFI draft intent is checked.
    const intent = routeIntent(dto.question, ctx);
    if (intent.kind === 'draft_rfi' && await this.siteRole.isRestricted(user, projectId)) {
      this.usage.log({
        companyId: user.companyId, projectId, userId: user.id, userRole: user.companyRole,
        status: 'blocked', blockReason: 'site_role_restricted',
      });
      const remaining = await this.usage.getRemaining(user.id, user.companyRole);
      return { answer: RFI_DRAFT_RESTRICTED_MESSAGE, blocked: true, toolsUsed: [], remainingQuota: remaining };
    }

    // ── 2. Usage limits — only a question the domain guard already allowed
    // ever reaches here, so a blocked question never costs quota.
    const reservation = await this.usage.checkAndReserve(user.id, user.companyRole);
    if (!reservation.allowed) {
      this.usage.log({
        companyId: user.companyId, projectId, userId: user.id, userRole: user.companyRole,
        status: 'blocked', blockReason: reservation.reason,
      });
      const message = reservation.reason === 'daily_limit'
        ? "You've reached your AI usage limit for today. Please try again tomorrow."
        : "You're sending requests too quickly. Please wait a moment and try again.";
      throw new AssistantQuotaExceededError(message, reservation.reason!);
    }

    const { provider, mode } = await this.resolveProvider(user);
    const startedAt = Date.now();
    try {
      const result = await this.generate(provider, intent, ctx, dto);
      this.usage.log({
        companyId: user.companyId, projectId, userId: user.id, userRole: user.companyRole,
        status: 'allowed', category: result.toolsUsed[0],
        provider: provider.getModelInfo().provider,
        model: provider.getModelInfo().model,
        aiMode: mode,
        latencyMs: Date.now() - startedAt,
      });
      return { ...result, remainingQuota: { dailyUsed: reservation.dailyUsed, dailyLimit: reservation.dailyLimit } };
    } catch (err) {
      this.usage.log({
        companyId: user.companyId, projectId, userId: user.id, userRole: user.companyRole,
        status: 'error', aiMode: mode, latencyMs: Date.now() - startedAt,
        errorMessage: err instanceof Error ? err.message : String(err),
      });
      this.logger.error(`AI generate() failed: ${err instanceof Error ? err.message : String(err)}`);
      throw new ServiceUnavailableException('The AI assistant is temporarily unavailable. Please try again shortly.');
    }
  }

  private async generate(provider: AIProvider, intent: Intent, ctx: AssistantContext, dto: AskAssistantDto): Promise<Omit<AskAssistantResult, 'remainingQuota'>> {
    if (intent.kind === 'draft_rfi' || intent.kind === 'draft_issue' || intent.kind === 'draft_snag') {
      return this.generateDraft(provider, intent.kind, ctx, dto.question);
    }

    const toolResults = (await Promise.all(
      intent.tools.map((name) => this.runTool(ctx, name)),
    )).filter((r): r is ToolResult => r !== null);

    const contextBlock = buildContextBlock(toolResults);
    const systemPrompt = `${AI_SYSTEM_PROMPT}\n\nCurrent project data:\n${contextBlock}`;

    const maxTurns = this.config.get<number>('ai.maxConversationTurns') ?? 6;
    const history: AIMessage[] = (dto.conversationHistory ?? []).slice(-maxTurns);
    const messages: AIMessage[] = [...history, { role: 'user', content: dto.question }];

    const { text } = await provider.generateResponse({ systemPrompt, messages, maxTokens: 1024 });
    return { answer: text, toolsUsed: toolResults.map((r) => r.tool) };
  }

  private async runTool(ctx: AssistantContext, name: string): Promise<ToolResult | null> {
    try {
      switch (name) {
        case 'getProjectSummary': return await this.tools.getProjectSummary(ctx);
        case 'getOpenRfis': return await this.tools.getOpenRfis(ctx);
        case 'getRfiDetails': return ctx.currentResourceId ? await this.tools.getRfiDetails(ctx, ctx.currentResourceId) : await this.tools.getOpenRfis(ctx);
        case 'getHighRiskIssues': return await this.tools.getHighRiskIssues(ctx);
        case 'getIssueDetails': return ctx.currentResourceId ? await this.tools.getIssueDetails(ctx, ctx.currentResourceId) : null;
        case 'getOpenSnags': return await this.tools.getOpenSnags(ctx);
        case 'getSnagDetails': return ctx.currentResourceId ? await this.tools.getSnagDetails(ctx, ctx.currentResourceId) : await this.tools.getOpenSnags(ctx);
        case 'getFloorPlanDetails': return await this.tools.getFloorPlanDetails(ctx);
        case 'getRiskSummary': return await this.tools.getRiskSummary(ctx);
        case 'getRiskForCurrentResource': return await this.tools.getRiskForCurrentResource(ctx);
        case 'getProgressSummary': return await this.tools.getProgressSummary(ctx);
        case 'getOverdueItems': return await this.tools.getOverdueItems(ctx);
        case 'getLatestReports': return await this.tools.getLatestReports(ctx);
        case 'searchProjectDocuments': return await this.tools.searchProjectDocuments(ctx, 'project documents');
        default: return null;
      }
    } catch (err) {
      this.logger.warn(`Tool ${name} failed: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }

  // Draft generation (spec section 9): gathers whatever context tool is
  // relevant (the issue currently being viewed, if any), asks the provider
  // for STRICT JSON matching the draft schema, and returns it as a
  // structured draft -- never prose, never a direct write. If the model
  // doesn't return parseable JSON, falls back to a plain-language answer
  // rather than silently fabricating a draft.
  private async generateDraft(
    provider: AIProvider,
    kind: 'draft_rfi' | 'draft_issue' | 'draft_snag',
    ctx: AssistantContext,
    question: string,
  ): Promise<Omit<AskAssistantResult, 'remainingQuota'>> {
    const sourceIssue = ctx.currentResourceType === 'issue' && ctx.currentResourceId
      ? await this.tools.getIssueDetails(ctx, ctx.currentResourceId).catch(() => null)
      : null;
    const contextBlock = buildContextBlock(sourceIssue ? [sourceIssue] : []);

    const schema = kind === 'draft_rfi'
      ? '{"subject": string (max 500 chars), "question": string, "discipline": one of "structural"|"architectural"|"mechanical"|"electrical"|"plumbing"|"civil"|"other", "priority": one of "critical"|"high"|"medium"|"low"}'
      : kind === 'draft_issue'
      ? '{"title": string (max 500 chars), "description": string, "discipline": one of "MEP"|"ARC"|"STR"|"CIV"|"ELE"|"INFRA"|"LANDSCAPE"|"OTHER", "priority": one of "critical"|"high"|"medium"|"low"}'
      : '{"title": string (max 500 chars), "description": string, "trade": string, "priority": one of "critical"|"high"|"medium"|"low"}';

    const systemPrompt = `${AI_SYSTEM_PROMPT}\n\nThe user wants a draft. Respond with ONLY a single valid JSON object matching this exact shape, no other text, no markdown fences: ${schema}\n\nSource context:\n${contextBlock}`;

    const { text } = await provider.generateResponse({ systemPrompt, messages: [{ role: 'user', content: question }], maxTokens: 500 });

    try {
      const parsed = JSON.parse(text.trim().replace(/^```(json)?/i, '').replace(/```$/, '').trim());
      if (kind === 'draft_rfi') {
        const d = this.tools.createRfiDraft(parsed.subject, parsed.question, parsed.discipline, parsed.priority);
        return { answer: 'Here is a draft RFI. Review and edit it before submitting.', draft: { type: 'rfi', fields: d.data as Record<string, unknown> }, toolsUsed: ['createRfiDraft'] };
      }
      if (kind === 'draft_issue') {
        const d = this.tools.createIssueDraft(parsed.title, parsed.description, parsed.discipline, parsed.priority);
        return { answer: 'Here is a draft issue. Review and edit it before submitting.', draft: { type: 'issue', fields: d.data as Record<string, unknown> }, toolsUsed: ['createIssueDraft'] };
      }
      const d = this.tools.createSnagDraft(parsed.title, parsed.description, parsed.trade, parsed.priority);
      return { answer: 'Here is a draft snag item. Review and edit it before submitting.', draft: { type: 'snag', fields: d.data as Record<string, unknown> }, toolsUsed: ['createSnagDraft'] };
    } catch {
      return { answer: `I couldn't put together a structured draft from that -- could you give me a bit more detail (what happened, and roughly which discipline it concerns)?`, toolsUsed: [] };
    }
  }
}
