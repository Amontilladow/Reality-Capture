import { useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { PageHeader } from '../components/layout/PageHeader';
import { TaskFormModal } from '../components/workspace/TaskFormModal';
import { StatusBadge } from '../components/ui/Badge';
import { listMyTasks, updateMyTask, getWorkspace, type UserTask, type RankedItem } from '../lib/workspace.api';
import { recordHref, RECORD_LABEL, dueLabel } from '../lib/record-links';
import { usePreferences, useToday, useInvalidateWorkspace } from '../components/command-center/hooks';

type View = 'assigned' | 'personal' | 'reminders' | 'done';
const PRIORITY_TONE = { critical: 'critical', high: 'danger', medium: 'warning', low: 'neutral' } as const;

// My tasks: two clearly separate kinds of work. "Assigned to me" is
// project work other people gave you (it opens in its own module, where
// that module's permissions apply); "Personal" and "Reminders" are your
// own, private list, which you can edit and tick off here.
export default function MyTasksPage() {
  const { projectId } = useParams<{ projectId?: string }>();
  const [params] = useSearchParams();
  const [view, setView] = useState<View>(params.get('task') ? 'personal' : 'assigned');
  const [editing, setEditing] = useState<UserTask | null>(null);
  const [creating, setCreating] = useState<null | 'task' | 'reminder'>(null);
  const [scope, setScope] = useState<'project' | 'all'>(projectId ? 'project' : 'all');
  const scopedProject = scope === 'project' ? projectId : undefined;
  const { hour12 } = usePreferences();
  const today = useToday();
  const invalidate = useInvalidateWorkspace();

  const tasks = useQuery({ queryKey: ['me', 'tasks'], queryFn: () => listMyTasks() });
  const work = useQuery({ queryKey: ['me', 'workspace', scopedProject ?? null], queryFn: () => getWorkspace(scopedProject) });
  const toggle = useMutation({
    mutationFn: (t: UserTask) => updateMyTask(t.id, { status: t.status === 'done' ? 'todo' : 'done' }),
    onSuccess: invalidate,
  });

  const highlighted = params.get('task');
  const own = useMemo(() => (tasks.data ?? []).filter((t) => !scopedProject || t.projectId === scopedProject || !t.projectId), [tasks.data, scopedProject]);
  const personal = own.filter((t) => t.kind === 'task' && t.status !== 'done');
  const reminders = own.filter((t) => t.kind === 'reminder' && t.status !== 'done');
  const done = own.filter((t) => t.status === 'done');
  const assigned = useMemo(() => {
    const d = work.data;
    if (!d) return [] as RankedItem[];
    const seen = new Set<string>();
    return [...d.overdue, ...d.dueToday, ...d.awaitingResponse, ...d.awaitingReview, ...d.assigned]
      .filter((i) => i.relation !== 'own')
      .filter((i) => (seen.has(`${i.source}:${i.id}`) ? false : (seen.add(`${i.source}:${i.id}`), true)));
  }, [work.data]);

  const tabs: { key: View; label: string; n?: number }[] = [
    { key: 'assigned', label: 'Assigned to me', n: work.data ? assigned.length : undefined },
    { key: 'personal', label: 'Personal', n: tasks.data ? personal.length : undefined },
    { key: 'reminders', label: 'Reminders', n: tasks.data ? reminders.length : undefined },
    { key: 'done', label: 'Completed', n: tasks.data ? done.length : undefined },
  ];

  return (
    <>
      <PageHeader
        breadcrumbs={projectId ? [{ label: 'Projects', to: '/projects' }, { label: 'Overview', to: `/projects/${projectId}` }, { label: 'My tasks' }] : undefined}
        title="My tasks"
        subtitle="Work assigned to you, plus your own private tasks and reminders"
        actions={
          <>
            <button type="button" onClick={() => setCreating('reminder')} className="btn-secondary">Add reminder</button>
            <button type="button" onClick={() => setCreating('task')} className="btn-primary">New task</button>
          </>
        }
      />
      <div className="p-4 sm:p-6 space-y-4 max-w-5xl">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div role="tablist" aria-label="Task lists" className="flex gap-2 overflow-x-auto">
            {tabs.map((t) => (
              <button key={t.key} role="tab" aria-selected={view === t.key} type="button" onClick={() => setView(t.key)}
                className={`shrink-0 h-10 px-4 rounded-full text-sm font-medium border ${view === t.key ? 'bg-signal text-on-signal border-transparent' : 'border-ink-100/15 text-ink-300 hover:text-ink-100'}`}>
                {t.label}{t.n !== undefined ? ` · ${t.n}` : ''}
              </button>
            ))}
          </div>
          {projectId && (
            <label className="flex items-center gap-2 text-sm text-ink-300">
              <input type="checkbox" checked={scope === 'all'} onChange={(e) => setScope(e.target.checked ? 'all' : 'project')} className="w-4 h-4 accent-[rgb(var(--rc-signal))]" />
              All projects
            </label>
          )}
        </div>

        <section className="panel overflow-hidden">
          {view === 'assigned' && (
            <>
              <p className="px-6 py-4 text-xs text-ink-500 border-b border-ink-100/10">
                Project records assigned to you or waiting on you. Open one to update it in its own module.
              </p>
              {work.isLoading && <p className="px-6 py-6 text-sm text-ink-500">Loading…</p>}
              {work.isError && <p className="px-6 py-6 text-sm text-danger">Couldn't load your assigned work.</p>}
              {work.data && assigned.length === 0 && <p className="px-6 py-6 text-sm text-ink-500">Nothing is assigned to you right now.</p>}
              <ul>
                {assigned.map((it) => {
                  const href = recordHref(it.source, it.projectId, it.id, it.recordType);
                  return (
                    <li key={`${it.source}:${it.id}`} className="flex items-center gap-4 px-6 py-4 border-b border-ink-100/10 last:border-b-0">
                      <div className="min-w-0 flex-1">
                        {href ? <Link to={href} className="block text-sm font-semibold text-ink-100 hover:text-blueprint truncate">{it.reference ? `${it.reference} · ` : ''}{it.title}</Link>
                          : <span className="block text-sm font-semibold text-ink-100 truncate">{it.title}</span>}
                        <span className="block text-xs text-ink-500 truncate">
                          {RECORD_LABEL[it.source]} · {it.relation === 'awaiting_response' ? 'waiting on your answer' : it.relation === 'awaiting_review' ? 'waiting on your review' : 'assigned to you'}
                          {it.projectName && ` · ${it.projectName}`}
                        </span>
                      </div>
                      {it.priority && <StatusBadge tone={PRIORITY_TONE[it.priority]} label={cap(it.priority)} />}
                      <span className={`w-36 text-right text-xs tabular-nums ${it.dueState === 'overdue' ? 'text-danger font-medium' : 'text-ink-300'}`}>{dueLabel(it.dueDate, it.dueTime, today, hour12)}</span>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
          {view !== 'assigned' && (
            <>
              <p className="px-6 py-4 text-xs text-ink-500 border-b border-ink-100/10">Private to you. Nobody else can see these.</p>
              {tasks.isLoading && <p className="px-6 py-6 text-sm text-ink-500">Loading…</p>}
              {tasks.isError && <p className="px-6 py-6 text-sm text-danger">Couldn't load your tasks.</p>}
              <ul>
                {(view === 'personal' ? personal : view === 'reminders' ? reminders : done).map((t) => (
                  <li key={t.id} className={`flex items-center gap-4 px-6 py-4 border-b border-ink-100/10 last:border-b-0 ${highlighted === t.id ? 'bg-signal/10' : ''}`}>
                    <input type="checkbox" checked={t.status === 'done'} onChange={() => toggle.mutate(t)} aria-label={`Mark "${t.title}" ${t.status === 'done' ? 'not done' : 'done'}`}
                      className="w-5 h-5 shrink-0 accent-[rgb(var(--rc-signal))]" />
                    <button type="button" onClick={() => setEditing(t)} className="min-w-0 flex-1 text-left">
                      <span className={`block text-sm font-semibold truncate ${t.status === 'done' ? 'line-through text-ink-500' : 'text-ink-100'}`}>{t.title}</span>
                      <span className="block text-xs text-ink-500 truncate">
                        {t.kind === 'reminder' ? 'Reminder' : t.status === 'in_progress' ? 'In progress' : t.status === 'done' ? 'Completed' : 'To do'}
                        {t.projectName && ` · ${t.projectName}`}
                        {t.notes && ' · has notes'}
                      </span>
                    </button>
                    <StatusBadge tone={PRIORITY_TONE[t.priority]} label={cap(t.priority)} />
                    <span className={`w-36 text-right text-xs tabular-nums ${t.status !== 'done' && t.dueDate && t.dueDate < today ? 'text-danger font-medium' : 'text-ink-300'}`}>
                      {t.status === 'done' ? 'Done' : dueLabel(t.dueDate, t.dueTime, today, hour12)}
                    </span>
                  </li>
                ))}
              </ul>
              {tasks.data && (view === 'personal' ? personal : view === 'reminders' ? reminders : done).length === 0 && (
                <div className="px-6 py-6 text-sm text-ink-500">
                  {view === 'done' ? 'Nothing completed yet.' : (
                    <>Nothing here yet. <button type="button" onClick={() => setCreating(view === 'reminders' ? 'reminder' : 'task')} className="font-medium text-blueprint">Add one</button></>
                  )}
                </div>
              )}
            </>
          )}
        </section>
      </div>
      <TaskFormModal open={Boolean(editing)} onClose={() => setEditing(null)} task={editing} />
      <TaskFormModal open={Boolean(creating)} onClose={() => setCreating(null)} defaults={{ kind: creating ?? 'task', projectId: projectId ?? '' }} />
    </>
  );
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
