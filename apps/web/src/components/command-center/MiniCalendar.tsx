import { monthGrid, addDays, weekOf, fmt } from './time';

// An interactive month (or, on phones, week) calendar: today is ringed in
// red, the selected day is filled, and days with work show dots (red when
// something on that day is overdue and still open). Selecting a day is
// the caller's to handle, usually by listing that day's items.

export interface DayMarks { open: number; done: number; overdue: boolean }

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function MiniCalendar({
  today,
  selected,
  month,
  marks,
  onSelect,
  onMonthChange,
  view = 'month',
}: {
  today: string;
  selected: string;
  /** Any date inside the month (or week) on show. */
  month: string;
  marks: Map<string, DayMarks>;
  onSelect: (date: string) => void;
  onMonthChange: (anyDateInNewRange: string) => void;
  view?: 'month' | 'week';
}) {
  const [y, m] = month.split('-').map(Number);
  const days = view === 'month' ? monthGrid(y, m - 1) : weekOf(month);
  const title = view === 'month'
    ? new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' })
    : `${fmt(days[0], { day: 'numeric', month: 'short' })} – ${fmt(days[6], { day: 'numeric', month: 'short', year: 'numeric' })}`;
  const step = (dir: -1 | 1) => {
    if (view === 'week') return onMonthChange(addDays(month, dir * 7));
    const d = new Date(Date.UTC(y, m - 1 + dir, 1));
    onMonthChange(d.toISOString().slice(0, 10));
  };

  return (
    <div className="select-none">
      <div className="flex items-center gap-2 mb-2">
        <div className="flex-1 text-sm font-semibold text-ink-100" aria-live="polite">{title}</div>
        <button type="button" onClick={() => step(-1)} className="nav-tile hover:text-ink-100" aria-label={view === 'month' ? 'Previous month' : 'Previous week'}>
          <Chevron dir="left" />
        </button>
        <button type="button" onClick={() => { onMonthChange(today); onSelect(today); }} className="h-8 px-2 rounded-lg text-xs font-medium text-blueprint hover:bg-ink-100/5">
          Today
        </button>
        <button type="button" onClick={() => step(1)} className="nav-tile hover:text-ink-100" aria-label={view === 'month' ? 'Next month' : 'Next week'}>
          <Chevron dir="right" />
        </button>
      </div>
      <div role="grid" aria-label={title} className="grid grid-cols-7 gap-0 text-center">
        {WEEKDAYS.map((d) => (
          <div key={d} role="columnheader" className="pb-2 text-eyebrow font-medium uppercase text-ink-500">{d.slice(0, view === 'month' ? 2 : 3)}</div>
        ))}
        {days.map((date) => {
          const inMonth = view === 'week' || Number(date.slice(5, 7)) === m;
          const isToday = date === today;
          const isSelected = date === selected;
          const mark = marks.get(date);
          return (
            <button
              key={date}
              type="button"
              role="gridcell"
              aria-selected={isSelected}
              aria-current={isToday ? 'date' : undefined}
              aria-label={`${fmt(date, { weekday: 'long', day: 'numeric', month: 'long' })}${mark ? `, ${mark.open} open${mark.overdue ? ', overdue items' : ''}` : ''}`}
              onClick={() => onSelect(date)}
              className="group h-10 flex flex-col items-center justify-center gap-0 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blueprint/60"
            >
              <span
                className={`w-8 h-8 grid place-items-center rounded-full text-sm tabular-nums transition-colors ${
                  isSelected
                    ? 'bg-signal text-on-signal font-semibold'
                    : isToday
                      ? 'ring-2 ring-signal text-ink-100 font-semibold'
                      : inMonth
                        ? 'text-ink-100 group-hover:bg-ink-100/10'
                        : 'text-ink-500/60 group-hover:bg-ink-100/5'
                }`}
              >
                {Number(date.slice(8))}
              </span>
              <span aria-hidden="true" className={`w-1.5 h-1.5 rounded-full ${
                !mark ? 'bg-transparent' : mark.open > 0 ? (mark.overdue ? 'bg-danger' : 'bg-ink-300') : mark.done > 0 ? 'bg-ok' : 'bg-transparent'
              }`} />
            </button>
          );
        })}
      </div>
    </div>
  );
}



function Chevron({ dir }: { dir: 'left' | 'right' }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2">
      <path d={dir === 'left' ? 'M15 6l-6 6 6 6' : 'M9 6l6 6-6 6'} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
