import { useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { PageHeader } from '../components/layout/PageHeader';
import { MiniCalendar } from '../components/command-center/MiniCalendar';
import { AgendaList } from '../components/command-center/AgendaList';
import { TaskFormModal } from '../components/workspace/TaskFormModal';
import { usePreferences, useToday, useAgenda, dayMarks } from '../components/command-center/hooks';
import { addDays, monthRange, weekOf, fmt } from '../components/command-center/time';
import { CALENDAR_PROVIDER_LABEL, type AgendaCategory, type AgendaItem } from '../lib/workspace.api';
import { ConnectCalendar } from '../components/workspace/ConnectCalendar';
import { useCalendarReturnToast } from '../components/workspace/useCalendarReturnToast';

type View = 'month' | 'week' | 'day';
const FILTERS: { key: AgendaCategory; label: string; dot: string }[] = [
  { key: 'my_tasks', label: 'My tasks', dot: 'bg-signal' },
  { key: 'project_deadlines', label: 'Project deadlines', dot: 'bg-ink-300' },
  { key: 'inspections', label: 'Inspections', dot: 'bg-warn' },
  { key: 'reminders', label: 'Personal reminders', dot: 'bg-ink-100' },
  { key: 'meetings', label: 'Meetings', dot: 'bg-high' },
];

// The calendar reads dates straight from the records themselves (issue
// deadlines, RFI and snag due dates, QA/QC and submittal due dates,
// inspection dates) plus the user's own tasks and reminders. Nothing is
// copied into a separate calendar, so nothing can be shown twice or go
// stale. Project-wide deadlines are shown for the project in view.
export default function MyCalendarPage() {
  const { projectId } = useParams<{ projectId?: string }>();
  const [params] = useSearchParams();
  const today = useToday();
  const { hour12, timeZone } = usePreferences();
  const [view, setView] = useState<View>('month');
  const [selected, setSelected] = useState<string>(params.get('date') ?? today);
  const [cursor, setCursor] = useState<string>(params.get('date') ?? today);
  const [hidden, setHidden] = useState<Set<AgendaCategory>>(new Set());
  const [creating, setCreating] = useState(false);
  useCalendarReturnToast();

  const range = view === 'month' ? monthRange(cursor) : view === 'week' ? { from: weekOf(cursor)[0], to: weekOf(cursor)[6] } : { from: cursor, to: cursor };
  const agenda = useAgenda(range.from, range.to, projectId);
  const items = useMemo(() => (agenda.data?.items ?? []).filter((i) => !hidden.has(i.category)), [agenda.data, hidden]);
  const marks = useMemo(() => dayMarks(items, today), [items, today]);
  const byDay = useMemo(() => {
    const m = new Map<string, AgendaItem[]>();
    for (const i of items) m.set(i.date, [...(m.get(i.date) ?? []), i]);
    return m;
  }, [items]);
  const upcoming = items.filter((i) => !i.done && i.date >= today).slice(0, 8);

  const step = (dir: -1 | 1) => {
    if (view === 'day') { const d = addDays(cursor, dir); setCursor(d); setSelected(d); }
    else if (view === 'week') setCursor(addDays(cursor, dir * 7));
  };
  const toggleFilter = (k: AgendaCategory) => setHidden((h) => { const n = new Set(h); if (n.has(k)) n.delete(k); else n.add(k); return n; });

  return (
    <>
      <PageHeader
        breadcrumbs={projectId ? [{ label: 'Projects', to: '/projects' }, { label: 'Overview', to: `/projects/${projectId}` }, { label: 'My calendar' }] : undefined}
        title="My calendar"
        subtitle={`Your deadlines, inspections and reminders${projectId ? ', plus this project\'s deadlines' : ''} · ${timeZone ?? 'device time'}`}
        actions={
          <>
            <ConnectCalendar />
            <button type="button" onClick={() => setCreating(true)} className="btn-primary">Add reminder</button>
          </>
        }
      />
      <div className="p-4 sm:p-6 grid grid-cols-1 xl:grid-cols-3 gap-6 items-start">
        <section className="xl:col-span-2 panel p-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div role="radiogroup" aria-label="Calendar view" className="inline-flex p-0 rounded-full border border-ink-100/15">
              {(['month', 'week', 'day'] as View[]).map((v) => (
                <button key={v} type="button" role="radio" aria-checked={view === v} onClick={() => { setView(v); setCursor(selected); }}
                  className={`h-8 px-4 rounded-full text-xs font-medium capitalize ${view === v ? 'bg-ink-100 text-base-950' : 'text-ink-300 hover:text-ink-100'}`}>{v}</button>
              ))}
            </div>
            <div className="flex flex-wrap gap-2" aria-label="Show">
              {FILTERS.filter((f) => f.key !== 'meetings' || agenda.data?.meetingsAvailable).map((f) => (
                <button key={f.key} type="button" aria-pressed={!hidden.has(f.key)} onClick={() => toggleFilter(f.key)}
                  className={`h-8 px-4 rounded-full text-xs font-medium border flex items-center gap-2 ${hidden.has(f.key) ? 'border-ink-100/10 text-ink-500 line-through' : 'border-ink-100/20 text-ink-100'}`}>
                  <span className={`w-2 h-2 rounded-full ${f.dot}`} />{f.label}
                </button>
              ))}
              {agenda.data && !agenda.data.meetingsAvailable && (
                <span className="h-8 px-4 rounded-full text-xs border border-dashed border-ink-100/15 text-ink-500 flex items-center">
                  Meetings: connect a calendar to see them
                </span>
              )}
            </div>
          </div>

          {agenda.data?.calendars?.some((c) => !c.ok) && (
            <p role="status" className="text-xs text-warn">
              Couldn't reach {agenda.data.calendars.filter((c) => !c.ok).map((c) => CALENDAR_PROVIDER_LABEL[c.provider]).join(' and ')} just now; showing everything else.
            </p>
          )}
          {view === 'month' && (
            <MiniCalendar today={today} selected={selected} month={cursor} marks={marks} onSelect={setSelected} onMonthChange={setCursor} />
          )}
          {view !== 'month' && (
            <div className="flex items-center gap-2">
              <div className="flex-1 text-sm font-semibold text-ink-100">
                {view === 'day' ? fmt(cursor, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
                  : `${fmt(range.from, { day: 'numeric', month: 'short' })} – ${fmt(range.to, { day: 'numeric', month: 'short', year: 'numeric' })}`}
              </div>
              <button type="button" onClick={() => step(-1)} className="btn-secondary" aria-label="Previous">‹</button>
              <button type="button" onClick={() => { setCursor(today); setSelected(today); }} className="btn-secondary">Today</button>
              <button type="button" onClick={() => step(1)} className="btn-secondary" aria-label="Next">›</button>
            </div>
          )}
          {view === 'week' && (
            <div className="grid grid-cols-1 md:grid-cols-7 gap-2">
              {weekOf(cursor).map((d) => {
                const list = byDay.get(d) ?? [];
                return (
                  <button key={d} type="button" onClick={() => setSelected(d)}
                    className={`text-left rounded-xl border p-2 min-h-32 ${d === selected ? 'border-signal' : 'border-ink-100/10'} ${d === today ? 'bg-signal/10' : ''}`}>
                    <div className={`text-xs font-semibold ${d === today ? 'text-signal' : 'text-ink-300'}`}>{fmt(d, { weekday: 'short', day: 'numeric' })}</div>
                    <ul className="mt-2 space-y-2">
                      {list.slice(0, 4).map((i) => (
                        <li key={i.key} className={`text-xs truncate ${i.done ? 'line-through text-ink-500' : i.date < today ? 'text-danger' : 'text-ink-100'}`}>{i.reference ?? i.title}</li>
                      ))}
                      {list.length > 4 && <li className="text-xs text-ink-500">+{list.length - 4} more</li>}
                    </ul>
                  </button>
                );
              })}
            </div>
          )}

          <div className="pt-4 border-t border-ink-100/10">
            <h2 className="text-base font-semibold text-ink-100 mb-2">
              {selected === today ? 'Today' : fmt(selected, { weekday: 'long', day: 'numeric', month: 'long' })}
            </h2>
            {agenda.isError ? <p className="text-sm text-danger">Couldn't load the calendar.</p> : (
              <AgendaList items={byDay.get(selected) ?? []} today={today} hour12={hour12} empty={agenda.isLoading ? 'Loading…' : 'Nothing on this day.'} />
            )}
          </div>
        </section>

        <aside className="panel p-6 space-y-4">
          <h2 className="text-base font-semibold text-ink-100">Upcoming deadlines</h2>
          <AgendaList items={upcoming} today={today} hour12={hour12} showDate empty="Nothing coming up in this range." />
        </aside>
      </div>
      <TaskFormModal open={creating} onClose={() => setCreating(false)} defaults={{ kind: 'reminder', dueDate: selected, projectId: projectId ?? '' }} />
    </>
  );
}
