import type { ConfigService } from '@nestjs/config';
import type { AuthenticatedUser } from '@engineeringos/types';
import { AiService, AssistantQuotaExceededError } from './ai.service';
import { DomainGuardService } from './domain-guard.service';
import type { AiUsageService } from './ai-usage.service';
import type { AiToolsService } from './ai-tools.service';
import type { ProviderFactory } from './providers/provider.factory';
import type { AiConnectionsService } from '../ai-connections/ai-connections.service';
import type { SiteRoleService } from '../../common/authorization/site-role.service';

const user: AuthenticatedUser = {
  id: 'user-1', email: 'u@example.com', companyId: 'company-1', companyRole: 'consultant',
  firstName: 'Pat', lastName: 'Consultant', pendingApproval: false,
};

function makeService(opts: {
  usageAllowed?: boolean;
  usageReason?: 'daily_limit' | 'rate_limit';
  siteRoleRestricted?: boolean;
} = {}) {
  const domainGuard = new DomainGuardService();

  const usage = {
    checkAndReserve: jest.fn().mockResolvedValue(
      opts.usageAllowed === false
        ? { allowed: false, reason: opts.usageReason ?? 'daily_limit', dailyUsed: 30, dailyLimit: 30 }
        : { allowed: true, dailyUsed: 1, dailyLimit: 30 },
    ),
    getRemaining: jest.fn().mockResolvedValue({ dailyUsed: 1, dailyLimit: 30 }),
    log: jest.fn(),
  };

  const tools = {
    getProjectSummary: jest.fn().mockResolvedValue({ tool: 'getProjectSummary', category: 'project', data: { name: 'Test Project' } }),
    getOpenRfis: jest.fn().mockResolvedValue({ tool: 'getOpenRfis', category: 'rfi', data: [] }),
    getOpenNcrs: jest.fn().mockResolvedValue({ tool: 'getOpenNcrs', category: 'qaqc', data: [] }),
    getHighRiskIssues: jest.fn().mockResolvedValue({ tool: 'getHighRiskIssues', category: 'risk', data: [] }),
    getRiskSummary: jest.fn().mockResolvedValue({ tool: 'getRiskSummary', category: 'risk', data: {} }),
  };

  const provider = {
    generateResponse: jest.fn().mockResolvedValue({ text: 'Here is the answer.', inputTokens: 10, outputTokens: 5 }),
    getModelInfo: jest.fn().mockReturnValue({ provider: 'anthropic', model: 'claude-sonnet-4-6' }),
    // Only reached for a "weak" domain-guard match (see domain-guard.service.ts) --
    // every existing test question here matches a "strong" pattern, so this
    // default is never exercised by them; defaults to true (not the
    // fail-closed path) so a test can opt into the "weak" scenario cleanly.
    classifyRequest: jest.fn().mockResolvedValue({ inDomain: true }),
  };
  const providerFactory = { getProvider: jest.fn().mockReturnValue(provider) };

  const aiConnections = { getProviderForUser: jest.fn().mockResolvedValue(null) };
  const siteRole = { isRestricted: jest.fn().mockResolvedValue(opts.siteRoleRestricted ?? false) };

  const config = { get: jest.fn().mockReturnValue(6) };

  const svc = new AiService(
    domainGuard,
    usage as unknown as AiUsageService,
    tools as unknown as AiToolsService,
    providerFactory as unknown as ProviderFactory,
    aiConnections as unknown as AiConnectionsService,
    siteRole as unknown as SiteRoleService,
    config as unknown as ConfigService,
  );
  return { svc, usage, tools, provider, aiConnections, siteRole };
}

describe('AiService.ask', () => {
  it('blocks an off-topic question before checking usage or calling the provider', async () => {
    const { svc, usage, provider } = makeService();
    const result = await svc.ask(user, 'project-1', { question: 'Tell me a joke.' });
    expect(result.blocked).toBe(true);
    expect(result.answer).toContain('RealityCapture Engineering Assistant');
    expect(usage.checkAndReserve).not.toHaveBeenCalled(); // a blocked question never costs quota
    expect(provider.generateResponse).not.toHaveBeenCalled();
    expect(usage.log).toHaveBeenCalledWith(expect.objectContaining({ status: 'blocked' }));
  });

  it('throws a quota-exceeded error once the daily limit is reached, for an in-domain question', async () => {
    const { svc, provider } = makeService({ usageAllowed: false, usageReason: 'daily_limit' });
    await expect(svc.ask(user, 'project-1', { question: 'Show me my open RFIs.' }))
      .rejects.toBeInstanceOf(AssistantQuotaExceededError);
    expect(provider.generateResponse).not.toHaveBeenCalled();
  });

  // Real bug (owner-reported, reproduced via production screenshots): a
  // plain \brfi\b regex never matches the plural "RFIs" -- no word boundary
  // between "rfi" and "s" -- so a natural "summarize open RFIs" silently
  // skipped getOpenRfis entirely and the model answered from empty context,
  // indistinguishable from "this project has none." Same bug existed for
  // risk(s) and issue(s).
  it('routes a plural "RFIs" question to getOpenRfis (regression: \\brfi\\b never matched the plural)', async () => {
    const { svc, tools } = makeService();
    await svc.ask(user, 'project-1', { question: 'Summarize open RFIs.' });
    expect(tools.getOpenRfis).toHaveBeenCalledTimes(1);
  });

  it('routes a plural "risks" question to the risk tools (same regression class)', async () => {
    const { svc, tools } = makeService();
    await svc.ask(user, 'project-1', { question: 'What are the top risks right now?' });
    expect(tools.getHighRiskIssues).toHaveBeenCalledTimes(1);
    expect(tools.getRiskSummary).toHaveBeenCalledTimes(1);
  });

  it('answers an allowed question, scoping tool calls to the authenticated company and route project', async () => {
    const { svc, tools, provider } = makeService();
    const result = await svc.ask(user, 'project-1', { question: 'Summarize the current project.' });
    expect(result.blocked).toBeUndefined();
    expect(result.answer).toBe('Here is the answer.');
    expect(provider.generateResponse).toHaveBeenCalledTimes(1);
    // Project isolation: every tool call receives companyId from the JWT
    // (not anything client-supplied -- AskAssistantDto has no companyId
    // field at all) and projectId from the route param.
    expect(tools.getProjectSummary).toHaveBeenCalledWith(
      expect.objectContaining({ companyId: 'company-1', projectId: 'project-1' }),
    );
  });

  // Phase 7: input_tokens/output_tokens in ai_usage_log were NULL for every
  // row -- generate() discarded GenerateResponseResult's token counts before
  // they reached usage.log(), even though the provider mock above (and every
  // real adapter) already returns them. Locks in that the counts now flow
  // through end to end.
  it('passes the provider-reported token counts through to usage.log()', async () => {
    const { svc, usage } = makeService();
    await svc.ask(user, 'project-1', { question: 'Summarize the current project.' });
    expect(usage.log).toHaveBeenCalledWith(expect.objectContaining({ inputTokens: 10, outputTokens: 5 }));
  });

  it('routes an NCR question to getOpenNcrs', async () => {
    const { svc, tools } = makeService();
    const result = await svc.ask(user, 'project-1', { question: 'Show me open NCRs.' });
    expect(result.blocked).toBeUndefined();
    expect(tools.getOpenNcrs).toHaveBeenCalledTimes(1);
  });

  it('a combined NCR + RFI question calls both tools', async () => {
    const { svc, tools } = makeService();
    await svc.ask(user, 'project-1', { question: 'Summarize open NCRs and open RFIs.' });
    expect(tools.getOpenNcrs).toHaveBeenCalledTimes(1);
    expect(tools.getOpenRfis).toHaveBeenCalledTimes(1);
  });

  it('never lets a different company id reach a tool call, regardless of what context the client sends', async () => {
    const { svc, tools } = makeService();
    const otherCompanyUser = { ...user, companyId: 'company-1' }; // companyId always comes from the authenticated user
    await svc.ask(otherCompanyUser, 'project-1', {
      question: 'Summarize the current project.',
      // AskAssistantDto's context only carries currentResourceType/Id, never a companyId --
      // this call shape is the only one the DTO's class-validator whitelist allows through.
      context: { currentResourceType: 'issue', currentResourceId: '11111111-1111-1111-1111-111111111111' },
    });
    const ctxArg = tools.getProjectSummary.mock.calls[0][0];
    expect(ctxArg.companyId).toBe('company-1');
  });
});

describe('AiService — weak domain-guard matches get a second opinion', () => {
  it('a "weak" match confirmed in-domain by classifyRequest() proceeds to answer normally', async () => {
    const { svc, provider } = makeService();
    provider.classifyRequest.mockResolvedValue({ inDomain: true });

    const result = await svc.ask(user, 'project-1', { question: 'What building is this drawing for?' });

    expect(provider.classifyRequest).toHaveBeenCalledWith('What building is this drawing for?');
    expect(result.blocked).toBeUndefined();
    expect(provider.generateResponse).toHaveBeenCalledTimes(1);
  });

  it('a "weak" match that classifyRequest() rejects is blocked before any answer is generated', async () => {
    const { svc, provider, usage } = makeService();
    provider.classifyRequest.mockResolvedValue({ inDomain: false, reason: 'classification_unavailable' });

    const result = await svc.ask(user, 'project-1', { question: 'What building is this drawing for?' });

    expect(result.blocked).toBe(true);
    expect(provider.generateResponse).not.toHaveBeenCalled();
    expect(usage.checkAndReserve).not.toHaveBeenCalled(); // never reaches quota -- blocked before it
    expect(usage.log).toHaveBeenCalledWith(expect.objectContaining({ status: 'blocked', blockReason: 'weak_match_failed_classification' }));
  });

  it('fails closed (blocks) when classifyRequest() itself errors, rather than letting the question through', async () => {
    const { svc, provider } = makeService();
    provider.classifyRequest.mockRejectedValue(new Error('provider timeout'));

    const result = await svc.ask(user, 'project-1', { question: 'What zone is this in?' });

    expect(result.blocked).toBe(true);
    expect(provider.generateResponse).not.toHaveBeenCalled();
  });

  it('a "strong" match never calls classifyRequest() at all -- the common case stays free', async () => {
    const { svc, provider } = makeService();
    await svc.ask(user, 'project-1', { question: 'Show me my open RFIs.' });
    expect(provider.classifyRequest).not.toHaveBeenCalled();
  });
});

describe('AiService — BYO AI (Mode B)', () => {
  it("uses the user's own BYO provider when connected, instead of RealityCapture's own", async () => {
    const { svc, provider, aiConnections, usage } = makeService();
    const byoProvider = {
      generateResponse: jest.fn().mockResolvedValue({ text: 'BYO answer.' }),
      getModelInfo: jest.fn().mockReturnValue({ provider: 'openai', model: 'gpt-4o' }),
    };
    aiConnections.getProviderForUser.mockResolvedValue(byoProvider);

    const result = await svc.ask(user, 'project-1', { question: 'Summarize the current project.' });

    expect(result.answer).toBe('BYO answer.');
    expect(provider.generateResponse).not.toHaveBeenCalled();
    expect(byoProvider.generateResponse).toHaveBeenCalledTimes(1);
    expect(usage.log).toHaveBeenCalledWith(expect.objectContaining({ aiMode: 'byo', provider: 'openai', model: 'gpt-4o' }));
  });

  it("falls back to RealityCapture's own provider when the user has no BYO connection", async () => {
    const { svc, provider, usage } = makeService();
    await svc.ask(user, 'project-1', { question: 'Summarize the current project.' });
    expect(provider.generateResponse).toHaveBeenCalledTimes(1);
    expect(usage.log).toHaveBeenCalledWith(expect.objectContaining({ aiMode: 'realitycapture' }));
  });

  it('BYO mode still goes through the domain guard -- an off-topic question is blocked before any provider call', async () => {
    const { svc, aiConnections } = makeService();
    const byoProvider = { generateResponse: jest.fn(), getModelInfo: jest.fn() };
    aiConnections.getProviderForUser.mockResolvedValue(byoProvider);

    const result = await svc.ask(user, 'project-1', { question: 'Tell me a joke.' });

    expect(result.blocked).toBe(true);
    expect(byoProvider.generateResponse).not.toHaveBeenCalled();
    expect(aiConnections.getProviderForUser).not.toHaveBeenCalled();
  });

  it('falls back to RealityCapture AI (rather than failing the request) when BYO provider resolution itself errors', async () => {
    const { svc, provider, aiConnections } = makeService();
    aiConnections.getProviderForUser.mockRejectedValue(new Error('decrypt failed'));

    const result = await svc.ask(user, 'project-1', { question: 'Summarize the current project.' });

    expect(result.answer).toBe('Here is the answer.');
    expect(provider.generateResponse).toHaveBeenCalledTimes(1);
  });

  // Owner request: a user who has exceeded RealityCapture's own shared
  // daily/per-minute quota must still be able to keep using the assistant
  // by connecting their own paid provider -- their own account pays and
  // rate-limits the call, not RealityCapture's. Previously this was broken:
  // usage.checkAndReserve() ran BEFORE the BYO check, so a BYO user was
  // blocked by RealityCapture's quota exactly like a non-BYO user.
  it("a BYO user whose RealityCapture daily quota is already exhausted still gets answered via their own provider", async () => {
    const { svc, aiConnections, usage } = makeService({ usageAllowed: false, usageReason: 'daily_limit' });
    const byoProvider = {
      generateResponse: jest.fn().mockResolvedValue({ text: 'BYO answer, unaffected by the platform quota.' }),
      getModelInfo: jest.fn().mockReturnValue({ provider: 'openai', model: 'gpt-4o' }),
    };
    aiConnections.getProviderForUser.mockResolvedValue(byoProvider);

    const result = await svc.ask(user, 'project-1', { question: 'Summarize the current project.' });

    expect(result.blocked).toBeUndefined();
    expect(result.answer).toBe('BYO answer, unaffected by the platform quota.');
    expect(byoProvider.generateResponse).toHaveBeenCalledTimes(1);
    expect(usage.checkAndReserve).not.toHaveBeenCalled(); // BYO never touches RealityCapture's quota gate
  });

  it('the daily-limit-exceeded message for a non-BYO user mentions connecting their own provider', async () => {
    const { svc } = makeService({ usageAllowed: false, usageReason: 'daily_limit' });
    await expect(svc.ask(user, 'project-1', { question: 'Summarize the current project.' }))
      .rejects.toMatchObject({ message: expect.stringContaining('Connect your own AI provider') });
  });
});

describe('AiService — role-aware draft blocking (CTO spec sections 16-21)', () => {
  it('declines to draft an RFI for a site-restricted user, with the exact spec decline message, before spending quota or calling the provider', async () => {
    const { svc, provider, usage, siteRole } = makeService({ siteRoleRestricted: true });

    const result = await svc.ask(user, 'project-1', { question: 'Please draft an RFI about the delayed steel delivery.' });

    expect(result.blocked).toBe(true);
    expect(result.answer).toBe(
      'Your current RealityCapture role does not have permission to create RFIs. I can help you review the issue or prepare information for an authorized user.',
    );
    expect(provider.generateResponse).not.toHaveBeenCalled();
    expect(usage.checkAndReserve).not.toHaveBeenCalled();
    expect(siteRole.isRestricted).toHaveBeenCalledWith(user, 'project-1');
    expect(usage.log).toHaveBeenCalledWith(expect.objectContaining({ status: 'blocked', blockReason: 'site_role_restricted' }));
  });

  it('does NOT block an issue draft for the same restricted user -- Issues stay fully enabled', async () => {
    const { svc, tools, provider } = makeService({ siteRoleRestricted: true });
    (tools as Record<string, unknown>).createIssueDraft = jest.fn().mockReturnValue({ tool: 'createIssueDraft', category: 'issue', data: { title: 't' } });
    provider.generateResponse.mockResolvedValue({ text: JSON.stringify({ title: 'Cracked slab', description: 'd', discipline: 'STR', priority: 'high' }) });

    const result = await svc.ask(user, 'project-1', { question: 'Please draft an issue about the cracked slab.' });

    expect(result.blocked).toBeUndefined();
    expect(result.draft?.type).toBe('issue');
  });

  it('does NOT block a snag draft for the same restricted user -- Snagging stays fully enabled', async () => {
    const { svc, tools, provider } = makeService({ siteRoleRestricted: true });
    (tools as Record<string, unknown>).createSnagDraft = jest.fn().mockReturnValue({ tool: 'createSnagDraft', category: 'snag', data: { title: 't' } });
    provider.generateResponse.mockResolvedValue({ text: JSON.stringify({ title: 'Paint touch-up', description: 'd', trade: 'Painting', priority: 'low' }) });

    const result = await svc.ask(user, 'project-1', { question: 'Please draft a snag for the paint touch-up on level 2.' });

    expect(result.blocked).toBeUndefined();
    expect(result.draft?.type).toBe('snag');
  });

  it('an unrestricted user can still draft an RFI normally', async () => {
    const { svc, tools, provider } = makeService({ siteRoleRestricted: false });
    (tools as Record<string, unknown>).createRfiDraft = jest.fn().mockReturnValue({ tool: 'createRfiDraft', category: 'rfi', data: { subject: 's' } });
    provider.generateResponse.mockResolvedValue({ text: JSON.stringify({ subject: 'Steel delivery delay', question: 'q', discipline: 'structural', priority: 'high' }) });

    const result = await svc.ask(user, 'project-1', { question: 'Please draft an RFI about the delayed steel delivery.' });

    expect(result.blocked).toBeUndefined();
    expect(result.draft?.type).toBe('rfi');
  });
});
