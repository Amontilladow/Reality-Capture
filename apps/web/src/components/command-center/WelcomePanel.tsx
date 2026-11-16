import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuthStore } from '../../store/auth.store';
import { useNow, zonedParts, greetingFor, monthRange, fmt } from './time';
import { usePreferences, useAgenda, dayMarks } from './hooks';
import { MiniCalendar } from './MiniCalendar';
import { AgendaList } from './AgendaList';

// The top of the Command Center: who you are, what time it is where you
// are, and what's on which day. Greeting and clock follow the user's
// chosen time zone (else the device's), recomputed every second, so the
// greeting turns from morning to afternoon on its own.
export function WelcomePanel({ projectId, subtitle, onAddTask }: { projectId?: string; subtitle: string; onAddTask: () => void }) {
  const user = useAuthStore((s) => s.user);
  const { timeZone, hour12, prefs, update } = usePreferences();
  const now = useNow();
  const t = zonedParts(now, timeZone, hour12);
  const today = t.date;
  const [selected, setSelected] = useState<string | null>(null);
  const [month, setMonth] = useState<string | null>(null);
  const shownMonth = month ?? today;
  const day = selected ?? today;
  const range = monthRange(shownMonth);
  const agenda = useAgenda(range.from, range.to, projectId);
  const items = useMemo(() => agenda.data?.items ?? [], [agenda.data]);
  const marks = useMemo(() => dayMarks(items, today), [items, today]);
  const dayItems = items.filter((i) => i.date === day);
  const firstName = user?.firstName?.trim();

  return (
    <section className="panel overflow-hidden grid grid-cols-1 lg:grid-cols-5">
      <div className="lg:col-span-3 p-6 flex flex-col gap-6 border-b lg:border-b-0 lg:border-r border-ink-100/10"
        style={{ background: 'linear-gradient(135deg, rgb(var(--rc-signal) / 0.10), transparent 55%)' }}>
        <div>
          <h2 className="text-2xl font-semibold text-ink-100">
            {greetingFor(t.hour)}{firstName ? `, ${firstName}` : ''}.
          </h2>
          <p className="text-sm text-ink-300">{subtitle}</p>
        </div>
        <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
          <div>
            <div className="flex items-baseline gap-2" aria-live="off">
              <time dateTime={now.toISOString()} className="text-5xl font-semibold tabular-nums tracking-tight text-ink-100">{t.time}</time>
              <span className="text-sm text-ink-500 tabular-nums" aria-hidden="true">{t.seconds}s</span>
            </div>
            <div className="text-sm text-ink-300">{t.weekday}, {t.fullDate}</div>
          </div>
          <div className="flex items-center gap-2 text-xs text-ink-500">
            <span>{timeZone ?? 'Device time'} · {t.zoneName}</span>
            <button
              type="button"
              onClick={() => update({ clockFormat: hour12 === false ? '12h' : '24h' })}
              className="h-8 px-2 rounded-lg border border-ink-100/10 hover:text-ink-100"
              aria-label={`Switch to ${hour12 === false ? '12-hour' : '24-hour'} clock`}
            >
              {hour12 === false ? '24h' : '12h'}
            </button>
            {!prefs?.timezone && timeZone && (
              <button type="button" onClick={() => update({ timezone: timeZone })} className="h-8 px-2 rounded-lg border border-ink-100/10 hover:text-ink-100">
                Save zone
              </button>
            )}
          </div>
        </div>
        <div>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-ink-100">
              {day === today ? 'Today' : fmt(day, { weekday: 'long', day: 'numeric', month: 'long' })}
              <span className="ml-2 text-xs font-normal text-ink-500">{dayItems.length} {dayItems.length === 1 ? 'item' : 'items'}</span>
            </h3>
            <div className="flex items-center gap-4">
              <button type="button" onClick={onAddTask} className="text-xs font-medium text-blueprint hover:text-blueprint-hover">+ Add task</button>
              <Link to={projectId ? `/projects/${projectId}/my-calendar` : '/projects/my-calendar'} className="text-xs font-medium text-blueprint hover:text-blueprint-hover">Open calendar</Link>
            </div>
          </div>
          {agenda.isError ? (
            <p className="text-sm text-danger">Couldn't load your calendar.</p>
          ) : (
            <AgendaList items={dayItems.slice(0, 5)} today={today} hour12={hour12} empty={agenda.isLoading ? 'Loading…' : 'Nothing scheduled for this day.'} />
          )}
          {dayItems.length > 5 && (
            <Link to={projectId ? `/projects/${projectId}/my-calendar?date=${day}` : `/projects/my-calendar?date=${day}`} className="mt-2 inline-block text-xs font-medium text-blueprint">
              {dayItems.length - 5} more on this day
            </Link>
          )}
        </div>
      </div>
      <div className="lg:col-span-2 p-6">
        <div className="hidden sm:block">
          <MiniCalendar today={today} selected={day} month={shownMonth} marks={marks} onSelect={setSelected} onMonthChange={setMonth} />
        </div>
        {/* Phones: a week strip, swiped with the arrows, instead of a month grid. */}
        <div className="sm:hidden">
          <MiniCalendar view="week" today={today} selected={day} month={month ?? day} marks={marks} onSelect={setSelected}
            onMonthChange={(d) => { setMonth(d); setSelected(d); }} />
        </div>
        <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-xs text-ink-500">
          <span className="flex items-center gap-2"><span className="w-2 h-2 rounded-full ring-2 ring-signal" />Today</span>
          <span className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-ink-300" />Due</span>
          <span className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-danger" />Overdue</span>
          <span className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-ok" />All done</span>
        </div>
      </div>
    </section>
  );
}
