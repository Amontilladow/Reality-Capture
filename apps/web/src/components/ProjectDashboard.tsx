import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { getIssueSummary } from '../lib/issues.api';
import { getProjectActivity } from '../lib/audit.api';
import { listBimModels } from '../lib/bim.api';

function StatTile({
  label,
  value,
  tone = 'default',
}: {
  label: string;
  value: number;
  tone?: 'default' | 'warn' | 'danger' | 'ok';
}) {
  const toneClass = {
    default: 'text-ink-100',
    ok: 'text-ok',
    warn: 'text-warn',
    danger: 'text-danger',
  }[tone];

  return (
    <div className="tick-frame panel p-4">
      <div className="text-[10px] font-mono uppercase tracking-widest text-ink-500 mb-1">{label}</div>
      <div className={`text-2xl font-mono font-semibold ${toneClass}`}>{value}</div>
    </div>
  );
}

const PROCESSING_STATUS_LABELS: Record<string, string> = {
  pending: 'Pending',
  processing: 'Processing',
  ready: 'Ready',
  failed: 'Failed',
};

const PROCESSING_STATUS_TONE: Record<string, 'default' | 'ok' | 'warn' | 'danger'> = {
  pending: 'default',
  processing: 'warn',
  ready: 'ok',
  failed: 'danger',
};

const ACTION_VERB_LABELS: Record<string, string> = {
  created: 'created',
  updated: 'updated',
  deleted: 'deleted',
  archived: 'archived',
  uploaded: 'uploaded',
  model_uploaded: 'uploaded a model for',
  invited: 'invited',
  login: 'logged in',
  logout: 'logged out',
};

function formatActivity(action: string, resourceType: string, resourceLabel?: string): string {
  const [, verbRaw] = action.split('.');
  const verb = ACTION_VERB_LABELS[verbRaw] ?? verbRaw ?? 'updated';
  const resourceName = resourceType.replace(/_/g, ' ');
  const label = resourceLabel ? ` "${resourceLabel}"` : '';
  if (action.startsWith('auth.') || action === 'session.login' || action === 'session.logout') return verb;
  return `${verb} ${resourceName}${label}`;
}

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
    queryFn: () => getProjectActivity(projectId, 8),
  });

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
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xs font-mono uppercase tracking-widest text-ink-500">Issues</h2>
          <Link to={`/projects/${projectId}/issues`} className="text-xs text-blueprint hover:text-blueprint-hover">
            View all →
          </Link>
        </div>
        {issuesQuery.isLoading && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="tick-frame panel p-4 h-[68px] animate-pulse bg-base-700/40" />
            ))}
          </div>
        )}
        {issuesQuery.data && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatTile label="Open" value={issuesQuery.data.open} />
            <StatTile label="Critical" value={issuesQuery.data.critical} tone="danger" />
            <StatTile label="Overdue" value={issuesQuery.data.overdue} tone="warn" />
            <StatTile label="Closed this week" value={issuesQuery.data.closedThisWeek} tone="ok" />
          </div>
        )}
      </div>

      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xs font-mono uppercase tracking-widest text-ink-500">BIM processing</h2>
          <Link to={`/projects/${projectId}/bim`} className="text-xs text-blueprint hover:text-blueprint-hover">
            View models →
          </Link>
        </div>
        {modelsQuery.isLoading && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="tick-frame panel p-4 h-[68px] animate-pulse bg-base-700/40" />
            ))}
          </div>
        )}
        {modelsQuery.data && modelsQuery.data.length === 0 && (
          <div className="tick-frame panel p-4 text-sm text-ink-500">No BIM models uploaded yet.</div>
        )}
        {modelsQuery.data && modelsQuery.data.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
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
        <h2 className="text-xs font-mono uppercase tracking-widest text-ink-500 mb-3">Recent activity</h2>
        <div className="tick-frame panel divide-y divide-base-600">
          {activityQuery.isLoading && <div className="p-4 text-sm text-ink-500">Loading…</div>}
          {activityQuery.data && activityQuery.data.length === 0 && (
            <div className="p-4 text-sm text-ink-500">Nothing recorded yet.</div>
          )}
          {activityQuery.data?.map((entry) => (
            <div key={entry.id} className="px-4 py-2.5 flex items-center justify-between gap-3 text-sm">
              <div className="min-w-0 truncate">
                <span className="text-ink-100 font-medium">{entry.userName ?? 'Someone'}</span>{' '}
                <span className="text-ink-300">
                  {formatActivity(entry.action, entry.resourceType, entry.resourceLabel)}
                </span>
              </div>
              <span className="text-[10px] font-mono text-ink-500 shrink-0">{timeAgo(entry.occurredAt)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
