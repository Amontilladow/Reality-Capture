import { ReportsService } from './reports.service';
import { AI_QUOTA_REACHED } from '../risk/risk.service';
import type { AiClientService } from '../ai-client/ai-client.service';
import type { AiUsageService } from '../ai/ai-usage.service';
import type { RiskService } from '../risk/risk.service';

// Same quota requirement as RiskService's AI calls (see risk-ai-quota.spec.ts).
describe('ReportsService AI quota', () => {
  const user = { id: 'user-1', companyRole: 'project_engineer' };
  const summary = (total: number) => ({ summary: { total, critical: 0, overdue: 0 } });

  function makeService(allowed: boolean) {
    const aiClient = { generateReportsBriefing: jest.fn().mockResolvedValue({ narrative: 'CONCLUSION: All good.' }) };
    const aiUsage = { checkAndReserve: jest.fn().mockResolvedValue({ allowed, dailyUsed: 1, dailyLimit: 10 }) };
    const risk = { getExecutiveSummary: jest.fn().mockResolvedValue(null) };
    const svc = new ReportsService(
      null as never, null as never, null as never, null as never, null as never, null as never,
      risk as unknown as RiskService,
      aiClient as unknown as AiClientService,
      null as never,
      aiUsage as unknown as AiUsageService,
    );
    jest.spyOn(svc, 'getKpis').mockResolvedValue({
      issues: summary(4), snagging: summary(0), rfis: summary(0), qaqc: summary(0),
    } as never);
    return { svc, aiClient, aiUsage };
  }

  it('charges the briefing to the requesting user when within quota', async () => {
    const { svc, aiClient, aiUsage } = makeService(true);
    await svc.generateAiBriefing('company-1', 'project-1', user);
    expect(aiUsage.checkAndReserve).toHaveBeenCalledWith('user-1', 'project_engineer');
    expect(aiClient.generateReportsBriefing).toHaveBeenCalledTimes(1);
  });

  it('does not call the model once the quota is spent', async () => {
    const { svc, aiClient } = makeService(false);
    await expect(svc.generateAiBriefing('company-1', 'project-1', user))
      .resolves.toEqual({ unavailable: true, reason: AI_QUOTA_REACHED });
    expect(aiClient.generateReportsBriefing).not.toHaveBeenCalled();
  });
});
