import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { getPriorities, type RankedItem } from '../../lib/workspace.api';
import { recordHref, RECORD_LABEL, dueLabel } from '../../lib/record-links';
import { StatusBadge } from '../ui/Badge';

// "What matters today?" A rule-ranked list of the caller's own work
// (assigned records, items waiting on them, their own tasks and reminders),
// built server-side from real records. Nothing is generated: every line
// links to the record it came from and says why it ranks where it does.
export function TodaysPriorities({ projectId, hour12 }: { projectId?: string; hour12?: boolean }) {
  const [shown, setShown] = useState(false);
  const query = useQuery({
    queryKey: ['me', 'priorities', projectId ?? null],
    queryFn: () => getPriorities(projectId, 7),
  });
  const data = query.data;
  const items = data?.items ?? [];

  return (
    <section className="panel overflow-hidden" aria-labelledby="priorities-title">
      <div className="flex flex-wrap items-center justify-between gap-4 px-6 pt-6 pb-4">
        <div>
          <h2 id="priorities-title" className="text-base font-semibold text-ink-100">Today's priorities</h2>
          <p className="text-xs text-ink-500">
            {query.isLoading ? 'Checking your work…'
              : query.isError ? "Couldn't load your priorities."
              : data && data.total > 0 ? `${data.total} open ${data.total === 1 ? 'item is' : 'items are'} yours · ${data.counts.overdue} overdue · ${data.counts.dueToday} due today`
              : 'Nothing is assigned to you or waiting on you.'}
          </p>
        </div>
        {!shown && items.length > 0 && (
          <button type="button" onClick={() => setShown(true)} className="btn-primary">
            <TargetIcon /> Show my priorities
          </button>
        )}
        {shown && (
          <button type="button" onClick={() => query.refetch()} className="text-xs font-medium text-blueprint hover:text-blueprint-hover">
            Refresh
          </button>
        )}
      </div>

      {!shown && items[0] && (
        // Before the full list: the single most important thing, so the
        // answer is on screen even if nobody presses the button.
        <div className="px-6 pb-6">
          <PriorityRow item={items[0]} index={0} today={data!.today} hour12={hour12} compact />
        </div>
      )}

      {shown && (
        <ol className="border-t border-ink-100/10">
          {items.map((it, i) => (
            <li key={`${it.source}:${it.id}`} className="px-6 py-4 border-b border-ink-100/10 last:border-b-0">
              <PriorityRow item={it} index={i} today={data!.today} hour12={hour12} />
            </li>
          ))}
          {data && data.total > items.length && (
            <li className="px-6 py-4 text-xs text-ink-500">
              {data.total - items.length} more in <Link to={projectId ? `/projects/${projectId}/my-tasks` : '/projects/my-tasks'} className="font-medium text-blueprint">My tasks</Link>
            </li>
          )}
        </ol>
      )}
    </section>
  );
}

const STATE_TONE = { overdue: 'danger', today: 'warning', tomorrow: 'info', this_week: 'neutral', later: 'neutral', none: 'neutral' } as const;

function PriorityRow({ item, index, today, hour12, compact }: { item: RankedItem; index: number; today: string; hour12?: boolean; compact?: boolean }) {
  const href = recordHref(item.source, item.projectId, item.id, item.recordType);
  return (
    <div className="flex items-start gap-4">
      <span className={`w-8 h-8 shrink-0 rounded-lg grid place-items-center text-sm font-semibold tabular-nums ${index === 0 ? 'bg-signal text-on-signal' : 'bg-ink-100/10 text-ink-100'}`}>
        {index + 1}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          {href ? (
            <Link to={href} className="text-sm font-semibold text-ink-100 hover:text-blueprint line-clamp-2">
              {item.reference ? `${item.reference} · ` : ''}{item.title}
            </Link>
          ) : (
            <span className="text-sm font-semibold text-ink-100">{item.title}</span>
          )}
        </div>
        <p className="text-sm text-ink-300">{item.reason}.</p>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-ink-500">
          <StatusBadge tone={STATE_TONE[item.dueState]} label={dueLabel(item.dueDate, item.dueTime, today, hour12)} />
          <span>{RECORD_LABEL[item.source]}</span>
          <span>· {item.status.replace(/_/g, ' ')}</span>
          {item.projectName && <span className="truncate">· {item.projectName}</span>}
        </div>
        {!compact && <p className="mt-2 text-xs text-ink-300"><span className="font-medium text-ink-100">Next:</span> {item.nextAction}</p>}
      </div>
      {href && (
        <Link to={href} className="btn-secondary shrink-0 hidden sm:inline-flex">Open</Link>
      )}
    </div>
  );
}

function TargetIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1.5" fill="currentColor" />
    </svg>
  );
}
