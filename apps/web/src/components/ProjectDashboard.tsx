import { useState } from 'react';
import { Link } from 'react-router-dom';
import { DESKTOP_QUERY, useMediaQuery } from '../lib/useMediaQuery';
import { useQuery } from '@tanstack/react-query';
import { getIssueSummary } from '../lib/issues.api';
import { getProjectActivity } from '../lib/audit.api';
import { groupActivity } from '../lib/activity-feed';
import { listBimModels } from '../lib/bim.api';
import { StatTile } from './ui/StatTile';
import { SectionHeader } from './ui/SectionHeader';

const PROCESSING_STATUS_LABELS: Record<string, string> = {
  pending: 'Pending',
  processing: 'Processing',
  ready: 'Ready',
  failed: 'Failed',
};

const PROCESSING_STATUS_TONE: Record<string, 'warn' | 'danger' | 'ok' | undefined> = {
  pending: undefined,
  processing: 'warn',
  ready: 'ok',
  failed: 'danger',
};

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

export function ProjectDashboard({ projectId }: { projectId: string }) {
  const issuesQuery = useQuery({
    queryKey: ['issue-summary', projectId],
    queryFn: () => getIssueSummary(projectId),
  });

  const activityQuery = useQuery({
    queryKey: ['project-activity', projectId],
    // Fetched wider than shown: internal pipeline events are filtered out.
    queryFn: () => getProjectActivity(projectId, 30),
  });

  const desktop = useMediaQuery(DESKTOP_QUERY);
  const [activityExpanded, setActivityExpanded] = useState(false);
  const activity = groupActivity(activityQuery.data ?? []);

  const modelsQuery = useQuery({
    queryKey: ['bim-models', projectId],
    queryFn: () => listBimModels(projectId),
  });

  const modelStatusCounts = (modelsQuery.data ?? []).reduce<Record<string, number>>((acc, m) => {
    acc[m.status] = (acc[m.status] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="p-6 pb-0 space-y-6">
      <div>
        <div className="mb-4">
          <SectionHeader
            title="Issues"
            size="sm"
            actions={
              <Link to={`/projects/${projectId}/issues`} className="text-xs text-blueprint hover:text-blueprint-hover">
                View all →
              </Link>
            }
          />
        </div>
        {issuesQuery.isLoading && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="tick-frame panel p-4 h-[68px] animate-pulse bg-base-700/40" />
            ))}
          </div>
        )}
        {issuesQuery.data && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <StatTile label="Open" value={issuesQuery.data.open} />
            <StatTile label="Critical" value={issuesQuery.data.critical} tone="danger" />
            <StatTile label="Overdue" value={issuesQuery.data.overdue} tone="warn" />
            <StatTile label="Closed this week" value={issuesQuery.data.closedThisWeek} tone="ok" />
          </div>
        )}
      </div>

      <div>
        <div className="mb-4">
          <SectionHeader
            title="BIM processing"
            size="sm"
            actions={
              <Link to={`/projects/${projectId}/bim`} className="text-xs text-blueprint hover:text-blueprint-hover">
                View models →
              </Link>
            }
          />
        </div>
        {modelsQuery.isLoading && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="tick-frame panel p-4 h-[68px] animate-pulse bg-base-700/40" />
            ))}
          </div>
        )}
        {modelsQuery.data && modelsQuery.data.length === 0 && (
          <div className="tick-frame panel p-4 text-sm text-ink-500">No BIM models uploaded yet.</div>
        )}
        {modelsQuery.data && modelsQuery.data.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {(['ready', 'processing', 'pending', 'failed'] as const).map((status) => (
              <StatTile
                key={status}
                label={PROCESSING_STATUS_LABELS[status]}
                value={modelStatusCounts[status] ?? 0}
                tone={PROCESSING_STATUS_TONE[status]}
              />
            ))}
          </div>
        )}
      </div>

      <div>
        <div className="mb-4"><SectionHeader title="Recent activity" size="sm" /></div>
        <div className="tick-frame panel divide-y divide-base-600">
          {activityQuery.isLoading && <div className="p-4 text-sm text-ink-500">Loading…</div>}
          {activityQuery.data && activity.length === 0 && (
            <div className="p-4 text-sm text-ink-500">Nothing recorded yet.</div>
          )}
          {activity.slice(0, desktop || activityExpanded ? 8 : 3).map((entry) => (
            <div key={entry.id} className="px-4 py-2 flex items-start justify-between gap-4 text-sm">
              <div className="min-w-0 line-clamp-2">
                <span className="text-ink-100 font-medium">{entry.userName ?? 'Someone'}</span>{' '}
                <span className="text-ink-300">{entry.text}</span>
              </div>
              <span className="text-xs text-ink-500 shrink-0 mt-0 tabular-nums">{timeAgo(entry.occurredAt)}</span>
            </div>
          ))}
          {!desktop && activity.length > 3 && (
            <button
              type="button"
              aria-expanded={activityExpanded}
              onClick={() => setActivityExpanded((v) => !v)}
              className="w-full px-4 py-2 text-left text-sm font-medium text-ink-300 hover:text-ink-100"
            >
              {activityExpanded ? 'Show less' : `Show ${Math.min(activity.length, 8) - 3} more`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
