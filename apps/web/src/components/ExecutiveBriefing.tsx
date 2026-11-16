import { Link } from 'react-router-dom';
import { STATUS_LABEL, type OverallStatus } from '../lib/executive-signals';
import type { ProjectBriefing } from './overview/useProjectBriefing';

// The Overview's top of page, from useProjectBriefing: one banner with the
// conclusion and the single most important thing to open, then the list of
// what needs attention (each with its own Open button), and a compact risk
// card beside it.

const BANNER_ACCENT: Record<OverallStatus, string> = {
  critical: 'rgb(var(--rc-signal) / 0.16)',
  at_risk: 'rgb(var(--rc-high) / 0.14)',
  stable: 'rgb(var(--rc-ok) / 0.10)',
  no_data: 'rgb(var(--rc-ink-100) / 0.04)',
};
const BANNER_ICON: Record<OverallStatus, string> = {
  critical: 'bg-signal text-on-signal',
  at_risk: 'bg-high/20 text-high',
  stable: 'bg-ok/15 text-ok',
  no_data: 'bg-ink-100/10 text-ink-300',
};

export function BriefingBanner({ brief }: { brief: ProjectBriefing }) {
  if (brief.isLoading) return <div className="panel h-24 animate-pulse bg-base-700/40" />;
  const top = brief.signals[0];
  return (
    <section
      className="panel p-6 flex flex-col sm:flex-row sm:items-center gap-4"
      style={{ background: `linear-gradient(90deg, ${BANNER_ACCENT[brief.status]}, rgb(var(--rc-base-800) / 0.78) 60%)` }}
    >
      <span className={`w-12 h-12 rounded-xl grid place-items-center shrink-0 ${BANNER_ICON[brief.status]}`}>
        <FlagIcon />
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-2 text-xs text-ink-500">
          <span className="font-semibold text-ink-300">{STATUS_LABEL[brief.status]}</span>
          {brief.asOf && <span>· as of {new Date(brief.asOf).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</span>}
        </div>
        <p className="text-base font-semibold text-ink-100 max-w-none">{brief.conclusion}</p>
      </div>
      {top && <Link to={top.to} className="btn-primary shrink-0">Review now</Link>}
    </section>
  );
}

const LEVEL_LABEL: Record<string, string> = { LOW: 'Low', MODERATE: 'Moderate', HIGH: 'High', CRITICAL: 'Critical' };
const LEVEL_TONE: Record<string, string> = { LOW: 'text-ok', MODERATE: 'text-warn', HIGH: 'text-high', CRITICAL: 'text-danger' };

// The project's risk index (Risk's own executive summary score, 0-100, so
// higher means more risk) with a few counts beside it.
export function RiskIndexCard({ projectId, brief, closedThisWeek }: { projectId: string; brief: ProjectBriefing; closedThisWeek?: number }) {
  const risk = brief.risk;
  const score = Math.max(0, Math.min(100, Math.round(risk?.overallScore ?? 0)));
  const models = brief.bimModels ?? [];
  const ready = models.filter((m) => m.status === 'ready').length;
  return (
    <section className="panel p-6 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-ink-100">Risk index</h2>
        <Link to={`/projects/${projectId}/risk`} className="text-xs font-medium text-blueprint hover:text-blueprint-hover">View risk</Link>
      </div>
      <div className="flex items-center gap-4">
        <div
          className="relative w-20 h-20 rounded-full grid place-items-center shrink-0"
          style={{ background: `conic-gradient(rgb(var(--rc-signal)) 0 ${score}%, rgb(var(--rc-ink-100) / 0.1) ${score}% 100%)` }}
          role="img"
          aria-label={`Risk index ${score} out of 100`}
        >
          <div className="absolute inset-2 rounded-full bg-base-800 grid place-items-center text-lg font-semibold text-ink-100 tabular-nums">{risk ? score : '–'}</div>
        </div>
        <div className="min-w-0">
          <div className={`text-sm font-semibold ${risk ? LEVEL_TONE[risk.overallLevel] ?? 'text-ink-100' : 'text-ink-500'}`}>
            {risk ? `${LEVEL_LABEL[risk.overallLevel] ?? risk.overallLevel} risk` : 'No risk data yet'}
          </div>
          {risk?.overallScoreTrendPct != null && (
            <div className="text-xs text-ink-500">{risk.overallScoreTrendPct > 0 ? 'Up' : 'Down'} {Math.abs(Math.round(risk.overallScoreTrendPct))}% on last period</div>
          )}
        </div>
      </div>
      <dl className="space-y-2 text-sm">
        <div className="flex justify-between gap-4"><dt className="text-ink-300">Open risks</dt><dd className="font-medium text-ink-100 tabular-nums">{risk?.totalOpenRisks ?? 0}</dd></div>
        <div className="flex justify-between gap-4"><dt className="text-ink-300">Issues closed this week</dt><dd className="font-medium text-ink-100 tabular-nums">{closedThisWeek ?? 0}</dd></div>
        <div className="flex justify-between gap-4"><dt className="text-ink-300">BIM models ready</dt><dd className="font-medium text-ink-100 tabular-nums">{ready} / {models.length}</dd></div>
      </dl>
    </section>
  );
}

function FlagIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M5 3v18" strokeLinecap="round" /><path d="M5 4h13l-3 4 3 4H5" strokeLinejoin="round" />
    </svg>
  );
}
