import { useQuery } from '@tanstack/react-query';
import { getRiskSummary } from '../../lib/risk.api';
import { getReportKpis } from '../../lib/reports.api';
import { listBimModels } from '../../lib/bim.api';
import { buildSignals, deriveOverallStatus, buildConclusion } from '../../lib/executive-signals';

// Executive Command Center (Minto Pyramid Principle): the conclusion first,
// the reasons behind it second, full evidence only on demand. Every number
// is read from backend-aggregated, already-validated sources this app
// already computes and shows elsewhere (Risk's own executive summary,
// Reports' own KPI endpoint, BIM's own model list); nothing is a new
// calculation invented for this screen, per the brief's "reuse existing
// calculations" / "do not introduce unsupported composite health scores"
// constraints. The ranking/conclusion rules live in lib/executive-signals.ts,
// shared with the cross-project CompanyExecutiveBriefing so "critical"
// means the same thing at both scopes. Query keys match those used
// elsewhere, so the Overview's other cards share these requests.
export function useProjectBriefing(projectId: string, enabled = true) {
  const riskQuery = useQuery({ queryKey: ['risk-summary', projectId], queryFn: () => getRiskSummary(projectId), enabled });
  const kpisQuery = useQuery({ queryKey: ['report-kpis', projectId], queryFn: () => getReportKpis(projectId), enabled });
  const bimQuery = useQuery({ queryKey: ['bim-models', projectId], queryFn: () => listBimModels(projectId), enabled });

  const kpis = kpisQuery.data;
  const bimFailedCount = (bimQuery.data ?? []).filter((m) => m.status === 'failed').length;
  const signals = buildSignals(`/projects/${projectId}`, {
    risk: riskQuery.data ? { criticalCount: riskQuery.data.criticalCount, overdueCount: riskQuery.data.overdueCount } : undefined,
    issues: kpis ? { critical: kpis.issues.summary.critical, overdue: kpis.issues.summary.overdue } : undefined,
    rfis: kpis ? { overdue: kpis.rfis.summary.overdue } : undefined,
    qaqc: kpis ? { critical: kpis.qaqc.summary.critical, overdue: kpis.qaqc.summary.overdue } : undefined,
    snagging: kpis ? { overdue: kpis.snagging.summary.overdue } : undefined,
    bimFailedCount,
  });
  const hasAnyActivity = Boolean(
    (riskQuery.data?.totalOpenRisks ?? 0) > 0
    || (kpis?.issues.summary.total ?? 0) > 0
    || (kpis?.rfis.summary.total ?? 0) > 0
    || (kpis?.qaqc.summary.total ?? 0) > 0
    || (kpis?.snagging.summary.total ?? 0) > 0,
  );
  const status = deriveOverallStatus(signals, hasAnyActivity);

  // Freshness is the moment these queries last resolved (react-query's own
  // dataUpdatedAt), never a claim this screen can't back up; the oldest of
  // the three, since that's the one the reader should trust least.
  const stamps = [riskQuery.dataUpdatedAt, kpisQuery.dataUpdatedAt, bimQuery.dataUpdatedAt].filter((t) => t > 0);

  return {
    isLoading: riskQuery.isLoading || kpisQuery.isLoading || bimQuery.isLoading,
    signals,
    status,
    conclusion: buildConclusion(status, signals, 'on this project'),
    asOf: stamps.length > 0 ? Math.min(...stamps) : null,
    risk: riskQuery.data,
    kpis,
    bimModels: bimQuery.data,
  };
}

export type ProjectBriefing = ReturnType<typeof useProjectBriefing>;
