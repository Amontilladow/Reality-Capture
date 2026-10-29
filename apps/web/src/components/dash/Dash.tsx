import { useId } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

// Building blocks for the dashboard canvas used by the Risk and Reports
// pages: a soft gradient page, oversized rounded cards, thin oversized
// numerals, and one warm accent ("sun") against an off-black card
// ("noir"). Colours come only from tokens (index.css), so dark mode works
// without per-component branches.
//
// Chart rules carried over from the diagram-design specs used elsewhere:
// one focal mark per chart, zero-based bars, every value readable, and
// each chart exposes its data as text to assistive tech.

/* ── Layout ─────────────────────────────────────────────────────────── */

export function DashCanvas({ children }: { children: ReactNode }) {
  // The gradient itself is on <body> now (the theme is platform-wide); this
  // only sets the roomier padding the dashboard pages use.
  return <div className="px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</div>;
}

export function DashHero({ eyebrow, title, aside, children }: {
  eyebrow?: ReactNode;
  title: string;
  aside?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-end">
      <div className="min-w-0">
        {eyebrow && <div className="text-sm text-ink-300 mb-1">{eyebrow}</div>}
        <h2 className="text-4xl sm:text-5xl font-light tracking-tight text-ink-100">{title}</h2>
        {children && <div className="mt-6">{children}</div>}
      </div>
      {aside && <div className="flex flex-wrap gap-x-10 gap-y-4 xl:justify-end">{aside}</div>}
    </header>
  );
}

/* ── Hero numbers ───────────────────────────────────────────────────── */

export function BigStat({ value, label, icon, onClick, actionLabel }: {
  value: number | string;
  label: string;
  icon?: ReactNode;
  onClick?: () => void;
  actionLabel?: string;
}) {
  const body = (
    <>
      <span className="flex items-end gap-2">
        {icon && (
          <span aria-hidden="true" className="mb-2 w-7 h-7 rounded-lg border border-base-600 bg-base-800/70 flex items-center justify-center text-ink-300">
            {icon}
          </span>
        )}
        <span className="text-6xl font-light tracking-tight tabular-nums text-ink-100 leading-none">{value}</span>
      </span>
      <span className="block text-sm text-ink-300 mt-1.5 text-left">{label}</span>
    </>
  );
  if (!onClick) return <div>{body}</div>;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={actionLabel ? `${label}: ${value}. ${actionLabel}` : undefined}
      className="text-left rounded-2xl -m-2 p-2 hover:bg-base-800/50 transition-colors"
    >
      {body}
    </button>
  );
}

/* ── Segmented pill bar ─────────────────────────────────────────────── */

export type SegmentStyle = 'noir' | 'sun' | 'stripes' | 'outline';

const SEGMENT_CLASS: Record<SegmentStyle, string> = {
  // ink-100 is near-black in light and near-white in dark, so the solid pill
  // stays the strongest mark against either canvas (noir would vanish in dark).
  noir: 'bg-ink-100 text-base-800',
  sun: 'bg-sun text-noir',
  stripes: 'dash-stripes border border-base-600 text-ink-100',
  outline: 'border border-ink-500/50 text-ink-100',
};

// A share-of-whole bar: one pill per category, width proportional to its
// count, percentage printed inside and the category named above. Zero
// categories are left out of the bar but still listed in the summary.
export function SegmentBar({ label, segments }: {
  label: string;
  segments: { key: string; label: string; value: number; style: SegmentStyle }[];
}) {
  // Number(): report counts arrive from the API as strings (Postgres bigint).
  const parts = segments.map((s) => ({ ...s, value: Number(s.value) || 0 }));
  const total = parts.reduce((sum, s) => sum + s.value, 0);
  if (total === 0) return <p className="text-sm text-ink-500">{label}: nothing open.</p>;
  const shown = parts.filter((s) => s.value > 0);
  const pct = (v: number) => Math.round((v / total) * 100);
  return (
    <div>
      <ul aria-label={`${label}, ${total} total`} className="flex gap-1.5 w-full max-w-3xl">
        {shown.map((s) => (
          // A floor on each share keeps a small category's label legible.
          <li key={s.key} className="min-w-0" style={{ flexGrow: Math.max(s.value / total, 0.2), flexBasis: 0 }}>
            <span className="block text-sm text-ink-300 mb-2 truncate">{s.label}</span>
            <span className={`flex items-center h-11 px-4 rounded-full text-xs font-medium tabular-nums ${SEGMENT_CLASS[s.style]}`}>
              {pct(s.value)}%<span className="sr-only"> ({s.value})</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ── Cards ──────────────────────────────────────────────────────────── */

function ArrowIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M5 11l6-6M6 5h5v5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function DashCard({ title, aside, to, onOpen, openLabel, tone = 'light', className = '', children }: {
  title: string;
  aside?: ReactNode;
  /** Route for the top-right arrow button. */
  to?: string;
  /** Action for the top-right arrow button, when it isn't a route. */
  onOpen?: () => void;
  openLabel?: string;
  tone?: 'light' | 'noir';
  className?: string;
  children: ReactNode;
}) {
  const arrowClass = tone === 'noir'
    ? 'w-11 h-11 shrink-0 rounded-full flex items-center justify-center bg-noir-hover text-on-noir hover:brightness-125 transition'
    : 'w-11 h-11 shrink-0 rounded-full flex items-center justify-center bg-base-800 border border-base-600 text-ink-100 hover:bg-base-700 transition-colors';
  const label = openLabel ?? `Open ${title}`;
  return (
    <section className={`${tone === 'noir' ? 'dash-card-noir' : 'panel'} p-6 flex flex-col ${className}`}>
      <div className="flex items-start justify-between gap-3 mb-4">
        <h3 className={`text-xl font-normal tracking-tight ${tone === 'noir' ? 'text-on-noir' : 'text-ink-100'}`}>{title}</h3>
        <div className="flex items-center gap-3">
          {aside}
          {to && <Link to={to} aria-label={label} className={arrowClass}><ArrowIcon /></Link>}
          {!to && onOpen && <button type="button" onClick={onOpen} aria-label={label} className={arrowClass}><ArrowIcon /></button>}
        </div>
      </div>
      {children}
    </section>
  );
}

/* ── Radial gauge ───────────────────────────────────────────────────── */

const GAUGE_SIZE = 200;
const GAUGE_R = 78;
const GAUGE_STROKE = 18;
const TICK_STEP_DEG = 6;

function polar(deg: number, r: number) {
  const rad = ((deg - 90) * Math.PI) / 180;
  return { x: GAUGE_SIZE / 2 + r * Math.cos(rad), y: GAUGE_SIZE / 2 + r * Math.sin(rad) };
}

// A 0..max dial: the filled sun arc runs clockwise from the top to the
// value, and the unfilled remainder is drawn as fine ticks rather than a
// second colour, so the arc is the only accent.
export function RadialGauge({ value, max = 100, label, caption }: {
  value: number;
  max?: number;
  label: string;
  caption?: string;
}) {
  const id = useId();
  const share = Math.max(0, Math.min(1, value / max));
  const endDeg = share * 360;
  const start = polar(0, GAUGE_R);
  const end = polar(Math.max(endDeg, 0.01), GAUGE_R);
  const largeArc = endDeg > 180 ? 1 : 0;
  const ticks: number[] = [];
  for (let d = Math.ceil((endDeg + 10) / TICK_STEP_DEG) * TICK_STEP_DEG; d < 350; d += TICK_STEP_DEG) ticks.push(d);

  return (
    <svg viewBox={`0 0 ${GAUGE_SIZE} ${GAUGE_SIZE}`} role="img" aria-labelledby={`${id}-t`} className="w-full max-w-[13rem] mx-auto block">
      <title id={`${id}-t`}>{`${label}: ${value} of ${max}${caption ? `, ${caption}` : ''}`}</title>
      {ticks.map((d) => {
        const a = polar(d, GAUGE_R - 6);
        const b = polar(d, GAUGE_R + 6);
        return <line key={d} x1={a.x} y1={a.y} x2={b.x} y2={b.y} strokeWidth={1.2} strokeLinecap="round" className="stroke-ink-500/60" />;
      })}
      {share >= 1 ? (
        <circle cx={GAUGE_SIZE / 2} cy={GAUGE_SIZE / 2} r={GAUGE_R} fill="none" strokeWidth={GAUGE_STROKE} className="stroke-sun" />
      ) : share > 0 && (
        <path
          d={`M ${start.x} ${start.y} A ${GAUGE_R} ${GAUGE_R} 0 ${largeArc} 1 ${end.x} ${end.y}`}
          fill="none" strokeWidth={GAUGE_STROKE} strokeLinecap="round" className="stroke-sun"
        />
      )}
      <text x="50%" y="48%" textAnchor="middle" dominantBaseline="central" className="fill-ink-100 text-5xl font-light tabular-nums">{value}</text>
      <text x="50%" y="66%" textAnchor="middle" className="fill-ink-300 text-sm">{caption ?? `of ${max}`}</text>
    </svg>
  );
}

/* ── Column bars ────────────────────────────────────────────────────── */

// Thin vertical bars, one per category, on a zero baseline. Every column
// prints its count; the focal column is drawn in sun with its count in a
// pill. Columns can drill down when onSelect is given.
export function ColumnBars({ title, unit, data, focalKey, onSelect, selectLabel = 'Show' }: {
  title: string;
  unit: string;
  data: { key: string; label: string; short?: string; value: number }[];
  focalKey?: string;
  onSelect?: (key: string) => void;
  selectLabel?: string;
}) {
  const id = useId();
  const rows = data.map((d) => ({ ...d, value: Number(d.value) || 0 }));
  const max = Math.max(1, ...rows.map((d) => d.value));
  if (rows.length === 0) return <p className="text-sm text-ink-500 py-10 text-center">No data yet.</p>;
  return (
    <figure aria-labelledby={`${id}-cap`} className="flex-1 flex flex-col">
      <figcaption id={`${id}-cap`} className="sr-only">
        {`${title} (${unit}): ${rows.map((d) => `${d.label} ${d.value}`).join(', ')}.`}
      </figcaption>
      <div className="flex-1 min-h-40 flex items-end justify-between gap-2 border-b border-dashed border-ink-500/40 pb-2" aria-hidden="true">
        {rows.map((d) => {
          const focal = d.key === focalKey && d.value > 0;
          return (
            <div key={d.key} className="flex-1 flex flex-col items-center justify-end h-full gap-1.5 min-w-0">
              {focal ? (
                <span className="px-2.5 py-1 rounded-full bg-sun text-noir text-caption font-medium tabular-nums">{d.value}</span>
              ) : (
                <span className="text-caption text-ink-300 tabular-nums">{d.value}</span>
              )}
              <span
                className={`w-2 rounded-full ${focal ? 'bg-sun' : 'bg-ink-100'} ${d.value === 0 ? 'opacity-30' : ''}`}
                style={{ height: `${d.value === 0 ? 8 : Math.max(10, (d.value / max) * 100)}%` }}
              />
            </div>
          );
        })}
      </div>
      <div className="flex justify-between gap-2 mt-2">
        {rows.map((d) => {
          const text = d.short ?? d.label;
          return onSelect ? (
            <button
              key={d.key}
              type="button"
              onClick={() => onSelect(d.key)}
              aria-label={`${selectLabel}: ${d.label}, ${d.value} ${unit}`}
              title={d.label}
              className="flex-1 min-w-0 truncate text-xs text-ink-300 rounded-full py-1 hover:bg-base-700/60 hover:text-ink-100 transition-colors"
            >
              {text}
            </button>
          ) : (
            <span key={d.key} title={d.label} className="flex-1 min-w-0 truncate text-center text-xs text-ink-300">{text}</span>
          );
        })}
      </div>
    </figure>
  );
}

/* ── Noir task list ─────────────────────────────────────────────────── */

export interface NoirItem {
  key: string;
  title: string;
  meta: string;
  icon: ReactNode;
  /** flag = needs action now (sun dot), idle = open (dim dot), done = completed (sun check). */
  state: 'flag' | 'idle' | 'done';
  onClick?: () => void;
}

export function NoirList({ items, empty }: { items: NoirItem[]; empty: string }) {
  if (items.length === 0) return <p className="text-sm text-on-noir/70 py-6">{empty}</p>;
  return (
    <ul className="space-y-1.5 -mx-2">
      {items.map((it) => {
        const body = (
          <>
            <span aria-hidden="true" className="w-11 h-11 shrink-0 rounded-full bg-on-noir/10 flex items-center justify-center text-on-noir">
              {it.icon}
            </span>
            <span className="min-w-0 flex-1 text-left">
              <span className={`text-sm leading-snug line-clamp-2 ${it.state === 'done' ? 'line-through text-on-noir/70' : 'text-on-noir'}`}>{it.title}</span>
              <span className="block text-xs text-on-noir/70 truncate mt-0.5">{it.meta}</span>
            </span>
            {it.state === 'done' ? (
              <span aria-label="Done" className="w-5 h-5 shrink-0 rounded-full bg-sun text-noir flex items-center justify-center">
                <svg viewBox="0 0 16 16" aria-hidden="true" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M3.5 8.5l3 3 6-7" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </span>
            ) : (
              <span aria-label={it.state === 'flag' ? 'Needs action' : 'Open'} className={`w-3.5 h-3.5 shrink-0 rounded-full ${it.state === 'flag' ? 'bg-sun' : 'bg-on-noir/25'}`} />
            )}
          </>
        );
        return (
          <li key={it.key}>
            {it.onClick ? (
              <button type="button" onClick={it.onClick} className="w-full flex items-center gap-3 p-2 rounded-2xl text-on-noir hover:bg-noir-hover focus-visible:bg-noir-hover transition-colors">
                {body}
              </button>
            ) : (
              <div className="flex items-center gap-3 p-2">{body}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/* ── Small glyphs used by the pages ─────────────────────────────────── */

export function Glyph({ name }: { name: 'stack' | 'alert' | 'clock' | 'user' | 'flag' | 'doc' | 'check' | 'shield' }) {
  const paths: Record<string, ReactNode> = {
    stack: <><path d="M12 3l9 5-9 5-9-5 9-5z" /><path d="M3 13l9 5 9-5" /></>,
    alert: <><path d="M12 4l9 16H3z" strokeLinejoin="round" /><path d="M12 10v4" /><circle cx="12" cy="17" r="0.6" /></>,
    clock: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>,
    user: <><circle cx="12" cy="8.5" r="3.5" /><path d="M5 20c1-3.5 4-5 7-5s6 1.5 7 5" /></>,
    flag: <><path d="M6 3v18" /><path d="M6 4h12l-3 4 3 4H6" strokeLinejoin="round" /></>,
    doc: <><path d="M7 3h7l4 4v14H7z" strokeLinejoin="round" /><path d="M14 3v4h4" /></>,
    check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
    shield: <path d="M12 3l7 3v6c0 4.5-3 8-7 9-4-1-7-4.5-7-9V6z" strokeLinejoin="round" />,
  };
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
      {paths[name]}
    </svg>
  );
}
