import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { getWorkspace, type RankedItem, type WorkspaceResponse } from '../../lib/workspace.api';
import { recordHref, RECORD_LABEL, dueLabel } from '../../lib/record-links';

type TabKey = 'assigned' | 'awaitingReview' | 'awaitingResponse' | 'dueToday' | 'overdue' | 'ownTasks';
const TABS: { key: TabKey; label: string; empty: string }[] = [
  { key: 'overdue', label: 'Overdue', empty: 'Nothing of yours is overdue.' },
  { key: 'dueToday', label: 'Due today', empty: 'Nothing of yours is due today.' },
  { key: 'assigned', label: 'Assigned to me', empty: 'Nothing is assigned to you.' },
  { key: 'awaitingReview', label: 'Awaiting my review', empty: 'Nothing is waiting on your review.' },
  { key: 'awaitingResponse', label: 'Awaiting my response', empty: 'No RFIs are waiting on your answer.' },
  { key: 'ownTasks', label: 'My tasks & reminders', empty: 'You have no open personal tasks.' },
];

// The caller's own responsibilities on this project, from the same data
// as Today's priorities (one query key family, so completing a task
// updates both).
export function MyWorkspacePanel({ projectId, hour12 }: { projectId?: string; hour12?: boolean }) {
  const query = useQuery({ queryKey: ['me', 'workspace', projectId ?? null], queryFn: () => getWorkspace(projectId) });
  const data = query.data;
  const firstWithItems = TABS.find((t) => (data?.[t.key]?.length ?? 0) > 0)?.key ?? 'assigned';
  const [tab, setTab] = useState<TabKey | null>(null);
  const active = tab ?? firstWithItems;
  const rows = data?.[active] ?? [];
  const tasksHref = projectId ? `/projects/${projectId}/my-tasks` : '/projects/my-tasks';

  return (
    <section className="panel overflow-hidden" aria-labelledby="workspace-title">
      <div className="flex items-center justify-between px-6 pt-6 pb-4">
        <h2 id="workspace-title" className="text-base font-semibold text-ink-100">My workspace</h2>
        <Link to={tasksHref} className="text-xs font-medium text-blueprint hover:text-blueprint-hover">All my tasks</Link>
      </div>
      <div role="tablist" aria-label="My workspace" className="flex gap-2 px-6 pb-4 overflow-x-auto">
        {TABS.map((t) => {
          const n = data?.[t.key]?.length ?? 0;
          const on = active === t.key;
          return (
            <button key={t.key} role="tab" aria-selected={on} type="button" onClick={() => setTab(t.key)}
              className={`shrink-0 h-8 px-4 rounded-full text-xs font-medium border ${on ? 'bg-ink-100 text-base-950 border-transparent' : 'border-ink-100/15 text-ink-300 hover:text-ink-100'}`}>
              {t.label}{data ? ` · ${n}` : ''}
            </button>
          );
        })}
      </div>
      {query.isLoading && <p className="px-6 pb-6 text-sm text-ink-500">Loading…</p>}
      {query.isError && <p className="px-6 pb-6 text-sm text-danger">Couldn't load your workspace.</p>}
      {data && rows.length === 0 && <p className="px-6 pb-6 text-sm text-ink-500">{TABS.find((t) => t.key === active)!.empty}</p>}
      <ul>
        {rows.slice(0, 6).map((it) => <WorkRow key={`${it.source}:${it.id}:${it.relation}`} it={it} data={data!} hour12={hour12} />)}
      </ul>
      {rows.length > 6 && (
        <Link to={tasksHref} className="block px-6 py-4 border-t border-ink-100/10 text-xs font-medium text-blueprint">{rows.length - 6} more in My tasks</Link>
      )}
      {data && data.recentlyAssigned.length > 0 && (
        <div className="px-6 py-4 border-t border-ink-100/10">
          <div className="text-eyebrow font-medium uppercase text-ink-500 mb-2">Recently assigned to you</div>
          <ul className="space-y-2">
            {data.recentlyAssigned.map((r) => (
              <li key={r.id} className="text-sm truncate">
                <Link to={recordHref('issue', r.projectId, r.id) ?? '#'} className="text-ink-100 hover:text-blueprint">{r.reference ? `${r.reference} · ` : ''}{r.title}</Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function WorkRow({ it, data, hour12 }: { it: RankedItem; data: WorkspaceResponse; hour12?: boolean }) {
  const href = recordHref(it.source, it.projectId, it.id, it.recordType);
  return (
    <li className="flex items-center gap-4 px-6 py-2 border-t border-ink-100/10">
      <div className="min-w-0 flex-1">
        {href ? (
          <Link to={href} className="block text-sm font-medium text-ink-100 hover:text-blueprint truncate">{it.reference ? `${it.reference} · ` : ''}{it.title}</Link>
        ) : <span className="block text-sm font-medium text-ink-100 truncate">{it.title}</span>}
        <span className="block text-xs text-ink-500 truncate">{RECORD_LABEL[it.source]} · {it.status.replace(/_/g, ' ')}{it.priority ? ` · ${it.priority}` : ''}</span>
      </div>
      <span className={`text-xs tabular-nums shrink-0 ${it.dueState === 'overdue' ? 'text-danger font-medium' : 'text-ink-300'}`}>
        {dueLabel(it.dueDate, it.dueTime, data.today, hour12)}
      </span>
    </li>
  );
}
