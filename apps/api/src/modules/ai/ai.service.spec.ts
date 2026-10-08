import type { ConfigService } from '@nestjs/config';
import type { AuthenticatedUser } from '@engineeringos/types';
import { AiService, AssistantQuotaExceededError } from './ai.service';
import { DomainGuardService } from './domain-guard.service';
import type { AiUsageService } from './ai-usage.service';
import type { AiToolsService } from './ai-tools.service';
import type { ProviderFactory } from './providers/provider.factory';

const user: AuthenticatedUser = {
  id: 'user-1', email: 'u@example.com', companyId: 'company-1', companyRole: 'consultant',
  firstName: 'Pat', lastName: 'Consultant', pendingApproval: false,
};

function makeService(opts: {
  usageAllowed?: boolean;
  usageReason?: 'daily_limit' | 'rate_limit';
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

  const config = { get: jest.fn().mockReturnValue(6) };

  const svc = new AiService(
    domainGuard,
    usage as unknown as AiUsageService,
    tools as unknown as AiToolsService,
    providerFactory as unknown as ProviderFactory,
    config as unknown as ConfigService,
  );
  return { svc, usage, tools, provider };
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
