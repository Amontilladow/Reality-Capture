import { RiskService, AI_QUOTA_REACHED } from './risk.service';
import type { AiClientService } from '../ai-client/ai-client.service';
import type { AiUsageService } from '../ai/ai-usage.service';

// The risk briefing/explanation endpoints are paid LLM calls on the shared
// provider: they must draw on the same per-role AiUsageService quota as the
// assistant, and must not reach the model once that quota is spent.
describe('RiskService AI quota', () => {
  const user = { id: 'user-1', companyRole: 'project_engineer' };

  function makeService(allowed: boolean) {
    const aiClient = {
      generateRiskBriefing: jest.fn().mockResolvedValue({ narrative: 'briefing' }),
      explainRisk: jest.fn().mockResolvedValue({ narrative: 'explanation' }),
    };
    const aiUsage = { checkAndReserve: jest.fn().mockResolvedValue({ allowed, dailyUsed: 1, dailyLimit: 10 }) };
    const svc = new RiskService(
      null as never, null as never, null as never, null as never, null as never,
      aiClient as unknown as AiClientService,
      aiUsage as unknown as AiUsageService,
    );
    jest.spyOn(svc, 'getExecutiveSummary').mockResolvedValue({ totalOpenRisks: 3 } as never);
    jest.spyOn(svc, 'getTopRisks').mockResolvedValue([] as never);
    jest.spyOn(svc, 'getRiskClusters').mockResolvedValue([] as never);
    jest.spyOn(svc, 'getRisk').mockResolvedValue({ title: 'Risk', factors: [] } as never);
    jest.spyOn(svc, 'getEvidenceWithNodes').mockResolvedValue([] as never);
    jest.spyOn(svc, 'getRiskChain').mockResolvedValue({ steps: [] } as never);
    return { svc, aiClient, aiUsage };
  }

  it('charges the briefing to the requesting user and calls the model when within quota', async () => {
    const { svc, aiClient, aiUsage } = makeService(true);
    await expect(svc.generateAiBriefing('company-1', 'project-1', user)).resolves.toEqual({ narrative: 'briefing' });
    expect(aiUsage.checkAndReserve).toHaveBeenCalledWith('user-1', 'project_engineer');
    expect(aiClient.generateRiskBriefing).toHaveBeenCalledTimes(1);
  });

  it('does not call the model for a briefing once the quota is spent', async () => {
    const { svc, aiClient } = makeService(false);
    await expect(svc.generateAiBriefing('company-1', 'project-1', user))
      .resolves.toEqual({ unavailable: true, reason: AI_QUOTA_REACHED });
    expect(aiClient.generateRiskBriefing).not.toHaveBeenCalled();
  });

  it('does not call the model for a risk explanation once the quota is spent', async () => {
    const { svc, aiClient } = makeService(false);
    await expect(svc.generateAiExplanation('company-1', 'project-1', 'risk-1', user))
      .resolves.toEqual({ unavailable: true, reason: AI_QUOTA_REACHED });
    expect(aiClient.explainRisk).not.toHaveBeenCalled();
  });

  it('spends no quota when there is nothing to summarize', async () => {
    const { svc, aiUsage } = makeService(true);
    jest.spyOn(svc, 'getExecutiveSummary').mockResolvedValue({ totalOpenRisks: 0 } as never);
    await svc.generateAiBriefing('company-1', 'project-1', user);
    expect(aiUsage.checkAndReserve).not.toHaveBeenCalled();
  });
});
