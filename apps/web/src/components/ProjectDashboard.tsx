import { Link } from 'react-router-dom';
import { StatTile } from './ui/StatTile';
import { recordHref } from '../lib/record-links';
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

const ACTIVITY_RECORD: Record<string, string> = {
  issue: 'issue', issues: 'issue', rfi: 'rfi', rfis: 'rfi', snag_item: 'snag', snag_items: 'snag', snags: 'snag',
  qaqc_record: 'qaqc', qaqc: 'qaqc', site_drawing: 'drawing', site_drawings: 'drawing', submittal: 'submittal', submittals: 'submittal',
};

export function RecentActivityList({ activity, projectId }: { activity: RecentActivity; projectId: string }) {
  if (activity.isLoading) return <p className="text-sm text-ink-500">Loading…</p>;
  if (activity.isLoaded && activity.entries.length === 0) return <p className="text-sm text-ink-500">Nothing recorded yet.</p>;
  return (
    <ol className="relative border-l border-ink-100/15 ml-2">
      {activity.entries.slice(0, 10).map((entry) => {
        const type = ACTIVITY_RECORD[entry.resourceType];
        const href = entry.count === 1 && type && entry.resourceId ? recordHref(type, projectId, entry.resourceId) : null;
        return (
          <li key={entry.id} className="relative pl-6 py-2 flex items-start justify-between gap-4 text-sm">
            <span aria-hidden="true" className="absolute -left-1 top-4 w-2 h-2 rounded-full bg-ink-300" />
            <div className="min-w-0 line-clamp-2">
              <span className="text-ink-100 font-medium">{entry.userName ?? 'Someone'}</span>{' '}
              {href ? <Link to={href} className="text-ink-300 hover:text-blueprint">{entry.text}</Link> : <span className="text-ink-300">{entry.text}</span>}
            </div>
            <time dateTime={entry.occurredAt} title={new Date(entry.occurredAt).toLocaleString()} className="text-xs text-ink-500 shrink-0 tabular-nums">{timeAgo(entry.occurredAt)}</time>
          </li>
        );
      })}
    </ol>
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
