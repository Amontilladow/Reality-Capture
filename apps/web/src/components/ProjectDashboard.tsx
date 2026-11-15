import { Link } from 'react-router-dom';
import type { IssueSummary } from '../lib/issues.api';
import { StatTile } from './ui/StatTile';
import type { ProjectBriefing } from './overview/useProjectBriefing';
import { PROCESSING_STATUS_LABELS, type RecentActivity } from './overview/overview-data';

// The Overview's numbers and its secondary sections: four key numbers,
// each linking to its module, then the recent activity feed and BIM
// processing, which the page shows inside collapsible sections.

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function KpiCard({ to, label, value, note, tone }: { to: string; label: string; value?: number; note?: string; tone?: 'danger' }) {
  return (
    <Link to={to} className="panel panel-interactive p-6 flex flex-col gap-2 min-w-0">
      <span className="flex items-center justify-between gap-2 text-xs text-ink-300">
        <span className="truncate">{label}</span>
        <svg aria-hidden="true" viewBox="0 0 24 24" className="w-4 h-4 shrink-0 opacity-60" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </span>
      <span className={`text-2xl font-semibold tabular-nums ${tone === 'danger' && (value ?? 0) > 0 ? 'text-danger' : 'text-ink-100'}`}>{value ?? '–'}</span>
      {note && <span className="text-xs text-ink-500 truncate">{note}</span>}
    </Link>
  );
}

export function OverviewKpis({ projectId, issues, brief }: { projectId: string; issues?: IssueSummary; brief: ProjectBriefing }) {
  const rfis = brief.kpis?.rfis.summary;
  const snags = brief.kpis?.snagging.summary;
  const base = `/projects/${projectId}`;
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      <KpiCard to={`${base}/issues`} label="Open issues" value={issues?.open} note={issues ? `${issues.createdThisWeek} new this week` : undefined} />
      <KpiCard to={`${base}/issues`} label="Overdue issues" value={issues?.overdue} tone="danger" note={issues ? `${issues.critical} critical` : undefined} />
      <KpiCard to={`${base}/rfis`} label="Open RFIs" value={rfis?.open} note={rfis ? `${rfis.overdue} overdue` : undefined} />
      <KpiCard to={`${base}/snagging`} label="Open snags" value={snags?.open} note={snags ? `${snags.verified} verified` : undefined} />
    </div>
  );
}

export function RecentActivityList({ activity }: { activity: RecentActivity }) {
  if (activity.isLoading) return <p className="text-sm text-ink-500">Loading…</p>;
  if (activity.isLoaded && activity.entries.length === 0) return <p className="text-sm text-ink-500">Nothing recorded yet.</p>;
  return (
    <div className="divide-y divide-ink-100/10">
      {activity.entries.slice(0, 8).map((entry) => (
        <div key={entry.id} className="py-2 flex items-start justify-between gap-4 text-sm">
          <div className="min-w-0 line-clamp-2">
            <span className="text-ink-100 font-medium">{entry.userName ?? 'Someone'}</span>{' '}
            <span className="text-ink-300">{entry.text}</span>
          </div>
          <span className="text-xs text-ink-500 shrink-0 tabular-nums">{timeAgo(entry.occurredAt)}</span>
        </div>
      ))}
    </div>
  );
}

const PROCESSING_STATUS_TONE: Record<string, 'warn' | 'danger' | 'ok' | undefined> = { pending: undefined, processing: 'warn', ready: 'ok', failed: 'danger' };

export function BimProcessing({ projectId, brief }: { projectId: string; brief: ProjectBriefing }) {
  const models = brief.bimModels ?? [];
  const counts = models.reduce<Record<string, number>>((acc, m) => ({ ...acc, [m.status]: (acc[m.status] ?? 0) + 1 }), {});
  return (
    <div className="space-y-4">
      {models.length === 0 ? (
        <p className="text-sm text-ink-500">No BIM models uploaded yet.</p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {(['ready', 'processing', 'pending', 'failed'] as const).map((status) => (
            <StatTile key={status} label={PROCESSING_STATUS_LABELS[status]} value={counts[status] ?? 0} tone={PROCESSING_STATUS_TONE[status]} />
          ))}
        </div>
      )}
      <Link to={`/projects/${projectId}/bim`} className="text-xs font-medium text-blueprint hover:text-blueprint-hover">View models</Link>
    </div>
  );
}
