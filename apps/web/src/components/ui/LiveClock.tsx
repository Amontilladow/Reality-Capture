import { useEffect, useState } from 'react';

// Abu Dhabi/Dubai operate on a single, DST-free offset (UTC+4) that never
// changes, but the IANA zone id is used anyway (rather than a hardcoded
// '+04:00') so this stays correct automatically if that ever changes, and
// so Intl handles the DST-transition math for us instead of us reinventing
// it. All formatting goes through the browser's native Intl.DateTimeFormat
// -- no external time API, no network call, no added dependency.
const TIME_ZONE = 'Asia/Dubai';

const timeFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});
const dateFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: TIME_ZONE,
  weekday: 'short',
  day: '2-digit',
  month: 'short',
});

function formatNow() {
  const now = new Date();
  return { time: timeFormatter.format(now), date: dateFormatter.format(now) };
}

// Single ticking clock, Asia/Dubai, for the sidebar footer (visible on
// every authenticated screen via AppShell, without competing with the
// account row above it for attention).
//
// One setInterval per mount, cleared on unmount -- the empty dependency
// array plus the cleanup return is what keeps a remount (e.g. React
// StrictMode's double-invoke in dev) from ever leaving two timers running.
// Recomputing from `new Date()` on every tick (rather than incrementing a
// counter) means a throttled/backgrounded tab's drift self-corrects on the
// very next tick instead of accumulating, and the 'visibilitychange'
// listener forces one extra recompute the moment the tab becomes visible
// again so the display never sits stale between that tick and the next.
//
// This is a plain client-rendered SPA (Vite, no SSR) so there is no
// server/client markup to mismatch -- the only real hydration-shaped risk
// is a first paint that doesn't match the DOM Intl later produces, which
// useState's lazy initializer avoids by computing the real value up front
// rather than starting from a placeholder.
export function LiveClock({ className = '' }: { className?: string }) {
  const [{ time, date }, setNow] = useState(formatNow);

  useEffect(() => {
    const tick = () => setNow(formatNow());
    const id = window.setInterval(tick, 1000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') tick();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  return (
    <div className={`leading-tight select-none ${className}`} title="Abu Dhabi / Dubai time (UTC+4)">
      <div className="text-xs font-semibold tabular-nums text-ink-100">{time}</div>
      <div className="text-[10px] text-ink-500">{date} &middot; Asia/Dubai</div>
    </div>
  );
}
