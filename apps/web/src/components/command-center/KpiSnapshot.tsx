import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { CommandCenterSummary } from '../../lib/workspace.api';

// Four numbers, all aggregated server-side from live records. Each says
// how it's counted, right under the number, so nobody has to guess.
export function KpiSnapshot({ projectId, data, isLoading, isError, onShowAttention }: {
  projectId: string;
  data?: CommandCenterSummary;
  isLoading: boolean;
  isError: boolean;
  onShowAttention: (filter: 'all' | 'overdue') => void;
}) {
  if (isError) return <div className="panel p-6 text-sm text-danger">Couldn't load the project numbers. The rest of the page still works.</div>;
  const k = data?.kpis;
  const base = `/projects/${projectId}`;
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      <Kpi as={{ to: `${base}/site-drawings` }} label="Total drawings" value={k?.totalDrawings} loading={isLoading}
        note={k ? `${k.drawingsUnderReview} under review · excludes superseded` : undefined} />
      <Kpi as={{ onClick: () => onShowAttention('all') }} label="Pending actions" value={k?.pendingActions} loading={isLoading}
        note="Open issues, RFIs, snags, QA/QC, submittals, inspections" />
      <Kpi as={{ onClick: () => onShowAttention('overdue') }} label="Overdue items" value={k?.overdueItems} loading={isLoading} danger
        note="Open, with a due date already passed" />
      <Kpi as={{ to: `${base}/site-drawings` }} label="Document compliance" loading={isLoading}
        value={k ? (k.documentCompliance === null ? null : k.documentCompliance) : undefined} suffix="%"
        note={k ? (k.documentCompliance === null
          ? `Not enough data: needs ${k.complianceBasis.minimum}+ drawings with a status`
          : `${k.complianceBasis.approved} of ${k.complianceBasis.known} current drawings approved`) : undefined} />
    </div>
  );
}

function Kpi({ as, label, value, note, loading, danger, suffix }: {
  as: { to: string } | { onClick: () => void };
  label: string;
  value?: number | null;
  note?: string;
  loading: boolean;
  danger?: boolean;
  suffix?: string;
}) {
  const body: ReactNode = (
    <>
      <span className="flex items-center justify-between gap-2 text-xs text-ink-300">
        <span className="truncate">{label}</span>
        <svg aria-hidden="true" viewBox="0 0 24 24" className="w-4 h-4 shrink-0 opacity-60 transition-transform motion-reduce:transition-none group-hover:translate-x-1 group-hover:opacity-100" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </span>
      {loading ? (
        <span className="h-10 w-16 rounded bg-ink-100/10 animate-pulse" />
      ) : (
        <span className={`text-2xl font-semibold tabular-nums ${danger && (value ?? 0) > 0 ? 'text-danger' : value === null ? 'text-ink-500' : 'text-ink-100'}`}>
          {value === null ? '–' : value === undefined ? '–' : `${value}${suffix ?? ''}`}
        </span>
      )}
      {note && <span className="text-xs text-ink-500 line-clamp-2">{note}</span>}
    </>
  );
  const cls = 'group panel panel-interactive p-6 flex flex-col gap-2 min-w-0 text-left';
  return 'to' in as ? <Link to={as.to} className={cls}>{body}</Link> : <button type="button" onClick={as.onClick} className={cls}>{body}</button>;
}
