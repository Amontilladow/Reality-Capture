import type { ReactNode } from 'react';
import type { RiskExecutiveSummary } from '../../lib/risk.api';

// Five KPIs, each computed from real data already on the page (the
// Executive Summary for criticalCount/highCount/overdueCount -- the same
// numbers the summary tiles above used to show -- plus the register itself
// for the two metrics the summary endpoint doesn't carry). Never a
// fabricated trend: the brief's "optional comparison with the previous
// period" is omitted entirely rather than shown without real history,
// since only overallScoreTrendPct has one (shown in the header instead).
export function RiskKpiStrip({
  summary, totalActive, unassignedCount, mitigationRatePct,
  onFilterTotalActive, onFilterCriticalHigh, onFilterOverdue, onFilterUnassigned, onFilterMitigated,
}: {
  summary: RiskExecutiveSummary;
  totalActive: number;
  unassignedCount: number;
  mitigationRatePct: number | null;
  onFilterTotalActive: () => void;
  onFilterCriticalHigh: () => void;
  onFilterOverdue: () => void;
  onFilterUnassigned: () => void;
  onFilterMitigated: () => void;
}) {
  const criticalHigh = summary.criticalCount + summary.highCount;
  return (
    <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
      <KpiCard
        icon={<IconLayers />}
        label="Total Active Risks"
        value={totalActive}
        onClick={onFilterTotalActive}
      />
      <KpiCard
        icon={<IconAlertTriangle />}
        label="Critical / High Risks"
        value={criticalHigh}
        tone={criticalHigh > 0 ? 'danger' : undefined}
        onClick={onFilterCriticalHigh}
      />
      <KpiCard
        icon={<IconClock />}
        label="Overdue Risk Actions"
        value={summary.overdueCount}
        tone={summary.overdueCount > 0 ? 'danger' : undefined}
        onClick={onFilterOverdue}
      />
      <KpiCard
        icon={<IconUserOff />}
        label="Risks Without an Owner"
        value={unassignedCount}
        tone={unassignedCount > 0 ? 'warn' : undefined}
        onClick={onFilterUnassigned}
      />
      <KpiCard
        icon={<IconCheckShield />}
        label="Mitigation Completion"
        value={mitigationRatePct === null ? '—' : `${mitigationRatePct}%`}
        tone={mitigationRatePct !== null && mitigationRatePct >= 50 ? 'ok' : undefined}
        onClick={onFilterMitigated}
        unavailable={mitigationRatePct === null}
      />
    </div>
  );
}

function KpiCard({ icon, label, value, tone, onClick, unavailable }: {
  icon: ReactNode; label: string; value: number | string; tone?: 'danger' | 'warn' | 'ok'; onClick: () => void; unavailable?: boolean;
}) {
  const toneClass = tone === 'danger' ? 'text-danger' : tone === 'warn' ? 'text-warn' : tone === 'ok' ? 'text-ok' : 'text-ink-100';
  return (
    <button
      onClick={onClick}
      disabled={unavailable}
      className="panel panel-interactive p-3.5 text-left flex flex-col gap-2 h-[92px] disabled:cursor-default disabled:hover:bg-base-700 disabled:hover:border-base-600 disabled:hover:translate-y-0"
    >
      <div className="flex items-center justify-between">
        <span className="text-ink-500">{icon}</span>
      </div>
      <div className="mt-auto">
        <div className={`text-xl font-semibold tabular-nums leading-none ${toneClass}`}>{value}</div>
        <div className="text-[11px] text-ink-500 mt-1 leading-tight">{label}</div>
      </div>
    </button>
  );
}

function IconLayers() {
  return (
    <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M12 3l9 5-9 5-9-5 9-5z" /><path d="M3 13l9 5 9-5" strokeLinecap="round" />
    </svg>
  );
}
function IconAlertTriangle() {
  return (
    <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M12 3l10 17H2L12 3z" strokeLinejoin="round" />
      <path d="M12 10v4" strokeLinecap="round" />
      <circle cx="12" cy="17" r="0.7" fill="currentColor" stroke="none" />
    </svg>
  );
}
function IconClock() {
  return (
    <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.6">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3.5 2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function IconUserOff() {
  return (
    <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.6">
      <circle cx="10" cy="8" r="3.5" />
      <path d="M3.5 20a6.5 6.5 0 0 1 11-4.7" strokeLinecap="round" />
      <path d="M17 16l5 5M22 16l-5 5" strokeLinecap="round" />
    </svg>
  );
}
function IconCheckShield() {
  return (
    <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M12 3l7 3v6c0 4.5-3 8-7 9-4-1-7-4.5-7-9V6z" strokeLinejoin="round" />
      <path d="M9 12l2 2 4-4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
