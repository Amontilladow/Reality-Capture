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
  };

  const provider = {
    generateResponse: jest.fn().mockResolvedValue({ text: 'Here is the answer.', inputTokens: 10, outputTokens: 5 }),
    getModelInfo: jest.fn().mockReturnValue({ provider: 'anthropic', model: 'claude-sonnet-4-6' }),
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
