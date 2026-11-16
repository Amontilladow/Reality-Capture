import { useEffect, useState } from 'react';

// Live time for the welcome panel: the device's clock, shown in the user's
// chosen time zone (or the device's own). Intl does the zone and daylight
// saving maths, so a DST change shows up at the next tick with no reload.

export function useNow(intervalMs = 1000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    // Tick on the second boundary, so the clock never lags a full second.
    let timer: ReturnType<typeof setInterval> | undefined;
    const start = setTimeout(() => {
      setNow(new Date());
      timer = setInterval(() => setNow(new Date()), intervalMs);
    }, intervalMs - (Date.now() % intervalMs));
    // A tab woken from sleep catches up at once.
    const onVisible = () => document.visibilityState === 'visible' && setNow(new Date());
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearTimeout(start);
      if (timer) clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [intervalMs]);
  return now;
}

export function greetingFor(hour: number): 'Good morning' | 'Good afternoon' | 'Good evening' {
  if (hour >= 5 && hour < 12) return 'Good morning';
  if (hour >= 12 && hour < 18) return 'Good afternoon';
  return 'Good evening';
}

/** The parts of `now` in a time zone: hour (0-23), YYYY-MM-DD date, and display strings. */
export function zonedParts(now: Date, timeZone: string | undefined, hour12: boolean | undefined) {
  const tz = timeZone || undefined;
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  return {
    hour: Number(parts.hour),
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: now.toLocaleTimeString(undefined, { timeZone: tz, hour: 'numeric', minute: '2-digit', hour12 }),
    seconds: now.toLocaleTimeString(undefined, { timeZone: tz, second: '2-digit' }).padStart(2, '0'),
    weekday: now.toLocaleDateString(undefined, { timeZone: tz, weekday: 'long' }),
    fullDate: now.toLocaleDateString(undefined, { timeZone: tz, day: 'numeric', month: 'long', year: 'numeric' }),
    zoneName: new Intl.DateTimeFormat(undefined, { timeZone: tz, timeZoneName: 'short' }).formatToParts(now).find((p) => p.type === 'timeZoneName')?.value ?? '',
  };
}

export function hour12For(format: '12h' | '24h' | 'auto' | undefined): boolean | undefined {
  return format === '12h' ? true : format === '24h' ? false : undefined;
}

/** First and last date (YYYY-MM-DD) of a month grid that starts on Monday. */
export function monthGrid(year: number, month: number): string[] {
  const first = new Date(Date.UTC(year, month, 1));
  const offset = (first.getUTCDay() + 6) % 7; // Monday = 0
  const start = Date.UTC(year, month, 1 - offset);
  return Array.from({ length: 42 }, (_, i) => new Date(start + i * 86_400_000).toISOString().slice(0, 10));
}

export function addDays(date: string, n: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

export function weekOf(date: string): string[] {
  const d = new Date(`${date}T00:00:00Z`);
  const monday = addDays(date, -((d.getUTCDay() + 6) % 7));
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

export function fmt(date: string, opts: Intl.DateTimeFormatOptions) {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString(undefined, { ...opts, timeZone: 'UTC' });
}

/** The date range a month view needs, padded to whole weeks (at most 42 days). */
export function monthRange(anyDate: string): { from: string; to: string } {
  const [y, m] = anyDate.split('-').map(Number);
  const grid = monthGrid(y, m - 1);
  return { from: grid[0], to: grid[grid.length - 1] };
}
