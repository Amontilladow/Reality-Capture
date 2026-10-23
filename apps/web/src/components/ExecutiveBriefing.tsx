import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { getRiskSummary } from '../lib/risk.api';
import { getReportKpis, type ReportKpis } from '../lib/reports.api';
import { listBimModels } from '../lib/bim.api';
import { StatusBadge } from './ui/Badge';
import type { StatusTone } from '../lib/status-tone';

// Executive Command Center (Minto Pyramid Principle): the conclusion first,
// the two or three reasons behind it second, full evidence only on demand.
// Every number here is read from backend-aggregated, already-validated
// sources this app already computes and already shows elsewhere (Risk's
// own executive summary, Reports' own KPI endpoint, BIM's own model list)
// -- nothing here is a new calculation invented for this screen, per the
// brief's own "reuse existing calculations" / "do not introduce unsupported
// composite health scores" constraints. The only thing genuinely new is
// the RANKING and the plain-language sentence built from those numbers --
// both are deterministic, auditable rules, not a black-box score and not
// an LLM call (an AI-polished version exists for Risk specifically --
// RiskIntelligenceSection's "AI Project Risk Briefing" -- and could be
// extended here later; this stays data-grounded and instant).

type Severity = 'critical' | 'high' | 'medium';

interface PrioritySignal {
  domain: string;
  label: string;
  explanation: string;
  severity: Severity;
  to: string;
}

const SEVERITY_RANK: Record<Severity, number> = { critical: 0, high: 1, medium: 2 };
const SEVERITY_TONE: Record<Severity, StatusTone> = { critical: 'critical', high: 'warning', medium: 'progress' };
const SEVERITY_LABEL: Record<Severity, string> = { critical: 'Critical', high: 'High', medium: 'Medium' };

type OverallStatus = 'critical' | 'at_risk' | 'stable' | 'no_data';
const STATUS_LABEL: Record<OverallStatus, string> = {
  critical: 'Needs immediate attention', at_risk: 'At risk', stable: 'Stable', no_data: 'Not enough data yet',
};
const STATUS_TONE: Record<OverallStatus, StatusTone> = {
  critical: 'critical', at_risk: 'warning', stable: 'success', no_data: 'neutral',
};

// The transparent, documented rule this screen's "overall status" is
// derived from -- never a hidden formula. CRITICAL whenever any signal is
// itself critical-severity; AT_RISK when nothing is critical but something
// needs attention soon; STABLE only once both of those are empty AND there
// is enough real project activity recorded to say so with any confidence.
function deriveOverallStatus(signals: PrioritySignal[], hasAnyActivity: boolean): OverallStatus {
  if (!hasAnyActivity) return 'no_data';
  if (signals.some((s) => s.severity === 'critical')) return 'critical';
  if (signals.some((s) => s.severity === 'high')) return 'at_risk';
  return 'stable';
}

function buildConclusion(status: OverallStatus, signals: PrioritySignal[]): string {
  if (status === 'no_data') {
    return 'No risks, issues, RFIs, QA records, or snag items have been recorded on this project yet — there is not enough activity to assess overall status.';
  }
  if (signals.length === 0) {
    return 'No critical issues, overdue items, or unresolved risks were found. The project is stable.';
  }
  const top = signals[0];
  if (status === 'critical') return `Engineering delivery is at risk because ${top.explanation}.`;
  if (status === 'at_risk') return `The project is largely on track, but ${top.explanation} and needs attention.`;
  return `The project is stable. ${signals.length} routine item${signals.length === 1 ? '' : 's'} may be worth a look.`;
}

function buildSignals(projectId: string, risk: Awaited<ReturnType<typeof getRiskSummary>> | undefined, kpis: ReportKpis | undefined, bimFailedCount: number): PrioritySignal[] {
  const signals: PrioritySignal[] = [];
  const riskPath = `/projects/${projectId}/risk`;

  if (risk) {
    if (risk.criticalCount > 0) {
      signals.push({
        domain: 'Risk', severity: 'critical', to: riskPath,
        label: `${risk.criticalCount} critical risk${risk.criticalCount === 1 ? '' : 's'} open`,
        explanation: `${risk.criticalCount} critical risk${risk.criticalCount === 1 ? '' : 's'} remain open`,
      });
    }
    if (risk.overdueCount > 0) {
      signals.push({
        domain: 'Risk', severity: 'high', to: riskPath,
        label: `${risk.overdueCount} overdue risk action${risk.overdueCount === 1 ? '' : 's'}`,
        explanation: `${risk.overdueCount} risk mitigation action${risk.overdueCount === 1 ? ' is' : 's are'} overdue`,
      });
    }
  }

  if (kpis) {
    if (kpis.issues.summary.critical > 0) {
      signals.push({
        domain: 'Issues', severity: 'critical', to: `/projects/${projectId}/issues`,
        label: `${kpis.issues.summary.critical} critical issue${kpis.issues.summary.critical === 1 ? '' : 's'}`,
        explanation: `${kpis.issues.summary.critical} critical issue${kpis.issues.summary.critical === 1 ? ' is' : 's are'} open`,
      });
    }
    if (kpis.issues.summary.overdue > 0) {
      signals.push({
        domain: 'Issues', severity: 'high', to: `/projects/${projectId}/issues`,
        label: `${kpis.issues.summary.overdue} overdue issue${kpis.issues.summary.overdue === 1 ? '' : 's'}`,
        explanation: `${kpis.issues.summary.overdue} issue${kpis.issues.summary.overdue === 1 ? ' is' : 's are'} overdue`,
      });
    }
    if (kpis.rfis.summary.overdue > 0) {
      signals.push({
        domain: 'RFIs', severity: 'high', to: `/projects/${projectId}/rfis`,
        label: `${kpis.rfis.summary.overdue} overdue RFI${kpis.rfis.summary.overdue === 1 ? '' : 's'}`,
        explanation: `${kpis.rfis.summary.overdue} RFI${kpis.rfis.summary.overdue === 1 ? ' is' : 's are'} overdue, which can block downstream design information`,
      });
    }
    if (kpis.qaqc.summary.critical > 0) {
      signals.push({
        domain: 'QAQC', severity: 'critical', to: `/projects/${projectId}/qaqc`,
        label: `${kpis.qaqc.summary.critical} critical QA/QC record${kpis.qaqc.summary.critical === 1 ? '' : 's'}`,
        explanation: `${kpis.qaqc.summary.critical} critical QA/QC record${kpis.qaqc.summary.critical === 1 ? ' is' : 's are'} open`,
      });
    }
    if (kpis.qaqc.summary.overdue > 0) {
      signals.push({
        domain: 'QAQC', severity: 'high', to: `/projects/${projectId}/qaqc`,
        label: `${kpis.qaqc.summary.overdue} overdue QA/QC record${kpis.qaqc.summary.overdue === 1 ? '' : 's'}`,
        explanation: `${kpis.qaqc.summary.overdue} QA/QC record${kpis.qaqc.summary.overdue === 1 ? ' is' : 's are'} overdue`,
      });
    }
    if (kpis.snagging.summary.overdue > 0) {
      signals.push({
        domain: 'Snagging', severity: 'medium', to: `/projects/${projectId}/snagging`,
        label: `${kpis.snagging.summary.overdue} overdue snag${kpis.snagging.summary.overdue === 1 ? '' : 's'}`,
        explanation: `${kpis.snagging.summary.overdue} snag item${kpis.snagging.summary.overdue === 1 ? ' is' : 's are'} overdue`,
      });
    }
  }

  if (bimFailedCount > 0) {
    signals.push({
      domain: 'BIM', severity: 'medium', to: `/projects/${projectId}/bim`,
      label: `${bimFailedCount} BIM model${bimFailedCount === 1 ? '' : 's'} failed processing`,
      explanation: `${bimFailedCount} BIM model${bimFailedCount === 1 ? ' failed' : 's failed'} to process`,
    });
  }

  return signals.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
}

const COLLAPSED_COUNT = 5;

export function ExecutiveBriefing({ projectId }: { projectId: string }) {
  const [expanded, setExpanded] = useState(false);

  const riskQuery = useQuery({ queryKey: ['risk-summary', projectId], queryFn: () => getRiskSummary(projectId) });
  const kpisQuery = useQuery({ queryKey: ['report-kpis', projectId], queryFn: () => getReportKpis(projectId) });
  const bimQuery = useQuery({ queryKey: ['bim-models', projectId], queryFn: () => listBimModels(projectId) });

  const isLoading = riskQuery.isLoading || kpisQuery.isLoading || bimQuery.isLoading;
  const bimFailedCount = (bimQuery.data ?? []).filter((m) => m.status === 'failed').length;
  const signals = buildSignals(projectId, riskQuery.data, kpisQuery.data, bimFailedCount);

  const hasAnyActivity = Boolean(
    (riskQuery.data?.totalOpenRisks ?? 0) > 0
    || (kpisQuery.data?.issues.summary.total ?? 0) > 0
    || (kpisQuery.data?.rfis.summary.total ?? 0) > 0
    || (kpisQuery.data?.qaqc.summary.total ?? 0) > 0
    || (kpisQuery.data?.snagging.summary.total ?? 0) > 0,
  );
  const status = deriveOverallStatus(signals, hasAnyActivity);
  const conclusion = buildConclusion(status, signals);

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
      <div className="panel tick-frame p-5 space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2.5">
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
          <div className="px-4 py-2.5 flex items-center justify-between">
            <span className="field-label !mb-0">Priority Actions</span>
            {signals.length > COLLAPSED_COUNT && (
              <button onClick={() => setExpanded((e) => !e)} className="text-xs text-blueprint hover:text-blueprint-hover">
                {expanded ? 'Show fewer' : `Show all ${signals.length}`}
              </button>
            )}
          </div>
          {visibleSignals.map((signal, i) => (
            <Link key={`${signal.domain}-${i}`} to={signal.to} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-base-800/60 transition-colors">
              <div className="flex items-center gap-3 min-w-0">
                <StatusBadge tone={SEVERITY_TONE[signal.severity]} label={SEVERITY_LABEL[signal.severity]} />
                <span className="text-xs text-ink-500 font-mono uppercase tracking-wide shrink-0">{signal.domain}</span>
                <span className="text-sm text-ink-100 truncate">{signal.label}</span>
              </div>
              <span className="text-xs text-blueprint shrink-0">View →</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
