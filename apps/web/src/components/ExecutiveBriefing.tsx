import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { getRiskSummary } from '../lib/risk.api';
import { getReportKpis } from '../lib/reports.api';
import { listBimModels } from '../lib/bim.api';
import { StatusBadge } from './ui/Badge';
import { SectionHeader } from './ui/SectionHeader';
import {
  buildSignals, deriveOverallStatus, buildConclusion,
  SEVERITY_TONE, SEVERITY_LABEL, STATUS_LABEL, STATUS_TONE,
} from '../lib/executive-signals';

// Executive Command Center (Minto Pyramid Principle): the conclusion first,
// the two or three reasons behind it second, full evidence only on demand.
// Every number here is read from backend-aggregated, already-validated
// sources this app already computes and already shows elsewhere (Risk's
// own executive summary, Reports' own KPI endpoint, BIM's own model list)
// -- nothing here is a new calculation invented for this screen, per the
// brief's own "reuse existing calculations" / "do not introduce unsupported
// composite health scores" constraints. The ranking/conclusion rules
// themselves live in lib/executive-signals.ts, shared with the
// cross-project CompanyExecutiveBriefing so "critical" means the same
// thing at both scopes.

const COLLAPSED_COUNT = 5;

export function ExecutiveBriefing({ projectId }: { projectId: string }) {
  const [expanded, setExpanded] = useState(false);

  const riskQuery = useQuery({ queryKey: ['risk-summary', projectId], queryFn: () => getRiskSummary(projectId) });
  const kpisQuery = useQuery({ queryKey: ['report-kpis', projectId], queryFn: () => getReportKpis(projectId) });
  const bimQuery = useQuery({ queryKey: ['bim-models', projectId], queryFn: () => listBimModels(projectId) });

  const isLoading = riskQuery.isLoading || kpisQuery.isLoading || bimQuery.isLoading;
  const bimFailedCount = (bimQuery.data ?? []).filter((m) => m.status === 'failed').length;
  const kpis = kpisQuery.data;
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
  const conclusion = buildConclusion(status, signals, 'on this project');

  // Freshness is the real moment these queries last actually resolved
  // (react-query's own dataUpdatedAt) -- never a claim this screen can't
  // back up. Shows the oldest of the three, since that's the one the
  // reader should trust least.
  const freshestTimestamps = [riskQuery.dataUpdatedAt, kpisQuery.dataUpdatedAt, bimQuery.dataUpdatedAt].filter((t) => t > 0);
  const oldestUpdate = freshestTimestamps.length > 0 ? Math.min(...freshestTimestamps) : null;

  const visibleSignals = expanded ? signals : signals.slice(0, COLLAPSED_COUNT);

  if (isLoading) {
    return (
      <div className="p-6 pb-0">
        <div className="panel tick-frame p-6 h-40 animate-pulse bg-base-700/40" />
      </div>
    );
  }

  return (
    <div className="p-6 pb-0 space-y-4">
      <div className="panel tick-frame p-6 space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <StatusBadge tone={STATUS_TONE[status]} label={STATUS_LABEL[status]} dot />
            <span className="text-xs text-ink-500">
              {oldestUpdate ? `As of ${new Date(oldestUpdate).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}` : 'Live'}
            </span>
          </div>
          {signals.length > 0 && (
            <span className="text-xs text-ink-500">{signals.length} item{signals.length === 1 ? '' : 's'} flagged across risk, issues, RFIs, QA/QC, snagging and BIM</span>
          )}
        </div>

        <p className="text-base text-ink-100 leading-relaxed font-medium">{conclusion}</p>
      </div>

      {visibleSignals.length > 0 && (
        <div className="panel tick-frame divide-y divide-base-700/60">
          <div className="px-4 py-2">
            <SectionHeader
              title="Priority Actions"
              size="sm"
              actions={signals.length > COLLAPSED_COUNT && (
                <button onClick={() => setExpanded((e) => !e)} className="text-xs text-blueprint hover:text-blueprint-hover">
                  {expanded ? 'Show fewer' : `Show all ${signals.length}`}
                </button>
              )}
            />
          </div>
          {visibleSignals.map((signal, i) => (
            <Link key={`${signal.domain}-${i}`} to={signal.to} className="flex items-center justify-between gap-4 px-4 py-4 hover:bg-base-700 transition-colors">
              <div className="flex items-center gap-4 min-w-0">
                <StatusBadge tone={SEVERITY_TONE[signal.severity]} label={SEVERITY_LABEL[signal.severity]} />
                <span className="text-xs text-ink-500 shrink-0 font-medium">{signal.domain}</span>
                <span className="text-sm text-ink-100 truncate">{signal.label}</span>
              </div>
              <span className="text-xs text-blueprint shrink-0">View</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
