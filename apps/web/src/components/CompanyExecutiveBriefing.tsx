import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { getCompanySummary, type CompanyProjectSummary } from '../lib/reports.api';
import { StatusBadge } from './ui/Badge';
import {
  buildSignals, deriveOverallStatus, buildConclusion,
  SEVERITY_RANK, SEVERITY_TONE, SEVERITY_LABEL, STATUS_LABEL, STATUS_TONE, type PrioritySignal,
} from '../lib/executive-signals';

// Cross-project Executive Command Center: the "Head of Engineering" view
// across every project in the company, same Minto Pyramid rules as the
// per-project ExecutiveBriefing -- conclusion first, then a ranked list of
// which PROJECTS need attention (not a flat list of every flagged item
// across every project, which would just recreate the cognitive overload
// this whole brief exists to remove). Each project row shows only its own
// single worst issue; the full per-project detail is one click away on
// that project's own Reports/Risk pages.
//
// Backed by GET /reports/company-summary (ReportsService.
// getCompanySummary()) -- one network round trip for the whole company,
// not N. Ranking/conclusion logic is shared with ExecutiveBriefing via
// lib/executive-signals.ts.

interface ProjectAttention {
  projectId: string;
  projectName: string;
  projectCode?: string;
  topSignal: PrioritySignal;
  flaggedCount: number;
}

function buildProjectAttentionRows(projects: CompanyProjectSummary[]): ProjectAttention[] {
  const rows: ProjectAttention[] = [];
  for (const p of projects) {
    const signals = buildSignals(`/projects/${p.projectId}`, {
      risk: { criticalCount: p.risk.criticalCount, overdueCount: p.risk.overdueCount },
      issues: { critical: p.issues.critical, overdue: p.issues.overdue },
      rfis: { overdue: p.rfis.overdue },
      qaqc: { critical: p.qaqc.critical, overdue: p.qaqc.overdue },
      snagging: { overdue: p.snagging.overdue },
    });
    if (signals.length === 0) continue;
    rows.push({
      projectId: p.projectId,
      projectName: p.projectName,
      projectCode: p.projectCode,
      topSignal: { ...signals[0], projectId: p.projectId, projectName: p.projectName },
      flaggedCount: signals.length,
    });
  }
  return rows.sort((a, b) => (
    SEVERITY_RANK[a.topSignal.severity] - SEVERITY_RANK[b.topSignal.severity]
  ) || b.flaggedCount - a.flaggedCount);
}

function hasAnyCompanyActivity(projects: CompanyProjectSummary[]): boolean {
  return projects.some((p) => (
    p.risk.totalOpenRisks > 0 || p.issues.total > 0 || p.rfis.total > 0 || p.qaqc.total > 0 || p.snagging.total > 0
  ));
}

const COLLAPSED_COUNT = 5;

export function CompanyExecutiveBriefing() {
  const [expanded, setExpanded] = useState(false);
  const summaryQuery = useQuery({ queryKey: ['company-summary'], queryFn: getCompanySummary });

  if (summaryQuery.isLoading) {
    return <div className="panel tick-frame p-6 h-40 animate-pulse bg-base-700/40 mb-6" />;
  }
  if (!summaryQuery.data || summaryQuery.data.projects.length === 0) return null;

  const projects = summaryQuery.data.projects;
  const rows = buildProjectAttentionRows(projects);
  const hasActivity = hasAnyCompanyActivity(projects);
  const status = deriveOverallStatus(rows.map((r) => r.topSignal), hasActivity);
  const conclusion = buildConclusion(status, rows.length > 0 ? [rows[0].topSignal] : [], 'across the portfolio');
  const visibleRows = expanded ? rows : rows.slice(0, COLLAPSED_COUNT);

  return (
    <div className="space-y-4 mb-6">
      <div className="panel tick-frame p-5 space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2.5">
            <StatusBadge tone={STATUS_TONE[status]} label={STATUS_LABEL[status]} dot />
            <span className="text-xs text-ink-500">{projects.length} project{projects.length === 1 ? '' : 's'}</span>
          </div>
          {rows.length > 0 && (
            <span className="text-xs text-ink-500">{rows.length} project{rows.length === 1 ? '' : 's'} with flagged items</span>
          )}
        </div>

        <p className="text-base text-ink-100 leading-relaxed font-medium">{conclusion}</p>
      </div>

      {visibleRows.length > 0 && (
        <div className="panel tick-frame divide-y divide-base-700/60">
          <div className="px-4 py-2.5 flex items-center justify-between">
            <span className="field-label !mb-0">Projects needing attention</span>
            {rows.length > COLLAPSED_COUNT && (
              <button onClick={() => setExpanded((e) => !e)} className="text-xs text-blueprint hover:text-blueprint-hover">
                {expanded ? 'Show fewer' : `Show all ${rows.length}`}
              </button>
            )}
          </div>
          {visibleRows.map((row) => (
            <Link
              key={row.projectId}
              to={`/projects/${row.projectId}`}
              className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-base-800/60 transition-colors"
            >
              <div className="flex items-center gap-3 min-w-0">
                <StatusBadge tone={SEVERITY_TONE[row.topSignal.severity]} label={SEVERITY_LABEL[row.topSignal.severity]} />
                <span className="text-sm text-ink-100 font-medium shrink-0">{row.projectName}</span>
                <span className="text-sm text-ink-300 truncate">{row.topSignal.label}</span>
                {row.flaggedCount > 1 && (
                  <span className="text-xs text-ink-500 shrink-0">+{row.flaggedCount - 1} more</span>
                )}
              </div>
              <span className="text-xs text-blueprint shrink-0">Open project →</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
