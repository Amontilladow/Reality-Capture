import { Link } from 'react-router-dom';
import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { showToast } from '../../store/toast.store';
import { updateMyTask, CALENDAR_PROVIDER_LABEL, type AgendaItem } from '../../lib/workspace.api';
import { recordHref, RECORD_LABEL, formatTime } from '../../lib/record-links';
import { useInvalidateWorkspace } from './hooks';

const CATEGORY_DOT: Record<AgendaItem['category'], string> = {
  my_tasks: 'bg-signal',
  project_deadlines: 'bg-ink-300',
  inspections: 'bg-warn',
  reminders: 'bg-ink-100',
  meetings: 'bg-high',
};

// One day's (or one range's) calendar items. A personal task or reminder
// can be ticked off right here; a project record links to its own page,
// where its own workflow decides how it gets closed.
export function AgendaList({ items, today, hour12, empty = 'Nothing scheduled.', showDate = false }: {
  items: AgendaItem[];
  today: string;
  hour12?: boolean;
  empty?: string;
  showDate?: boolean;
}) {
  const invalidate = useInvalidateWorkspace();
  // Ticks show at once; the server confirms, and a failure puts it back.
  const [pending, setPending] = useState<Map<string, boolean>>(new Map());
  const toggle = useMutation({
    mutationFn: ({ it, done }: { it: AgendaItem; done: boolean }) => updateMyTask(it.id, { status: done ? 'done' : 'todo' }),
    onMutate: ({ it, done }) => setPending((p) => new Map(p).set(it.key, done)),
    onError: (_e, { it }) => {
      setPending((p) => { const n = new Map(p); n.delete(it.key); return n; });
      showToast("Couldn't update the task", 'danger');
    },
    onSettled: async (_d, _e, { it }) => {
      await invalidate();
      setPending((p) => { const n = new Map(p); n.delete(it.key); return n; });
    },
  });
  if (items.length === 0) return <p className="text-sm text-ink-500">{empty}</p>;
  return (
    <ul className="divide-y divide-ink-100/10">
      {items.map((raw) => {
        const it = pending.has(raw.key) ? { ...raw, done: pending.get(raw.key)! } : raw;
        const own = it.source === 'task' || it.source === 'reminder';
        const href = recordHref(it.source, it.projectId, it.id, it.recordType);
        const overdue = !it.done && it.date < today;
        return (
          <li key={it.key} className="flex items-center gap-4 py-2">
            {own ? (
              <input
                type="checkbox"
                checked={it.done}
                onChange={() => toggle.mutate({ it: raw, done: !it.done })}
                aria-label={`Mark "${it.title}" ${it.done ? 'not done' : 'done'}`}
                className="w-5 h-5 shrink-0 accent-[rgb(var(--rc-signal))]"
              />
            ) : (
              <span aria-hidden="true" className={`w-2 h-2 mx-2 shrink-0 rounded-full ${CATEGORY_DOT[it.category]}`} />
            )}
            <div className="min-w-0 flex-1">
              {it.source === 'event' ? (
                it.url ? (
                  <a href={it.url} target="_blank" rel="noopener noreferrer" className="block text-sm font-medium truncate text-ink-100 hover:text-blueprint">
                    {it.title}<span className="sr-only"> (opens your calendar in a new tab)</span>
                  </a>
                ) : <span className="block text-sm font-medium truncate text-ink-100">{it.title}</span>
              ) : href ? (
                <Link to={href} className={`block text-sm font-medium truncate hover:text-blueprint ${it.done ? 'line-through text-ink-500' : 'text-ink-100'}`}>
                  {it.reference ? `${it.reference} · ` : ''}{it.title}
                </Link>
              ) : (
                <span className={`block text-sm font-medium truncate ${it.done ? 'line-through text-ink-500' : 'text-ink-100'}`}>{it.title}</span>
              )}
              <span className="block text-xs text-ink-500 truncate">
                {it.source === 'event' && it.provider ? `Meeting · ${CALENDAR_PROVIDER_LABEL[it.provider]}` : RECORD_LABEL[it.source]}
                {showDate && ` · ${new Date(`${it.date}T12:00:00Z`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })}`}
                {it.time ? ` · ${formatTime(it.time, hour12)}${it.endTime ? `–${formatTime(it.endTime, hour12)}` : ''}` : it.source === 'event' ? ' · All day' : ''}
                {it.location && ` · ${it.location}`}
                {it.projectName && ` · ${it.projectName}`}
              </span>
            </div>
            {it.done ? (
              <span className="text-xs font-medium text-ok shrink-0">Done</span>
            ) : overdue && it.source !== 'event' ? (
              <span className="text-xs font-medium text-danger shrink-0">Overdue</span>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
