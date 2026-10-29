import { useId } from 'react';
import { useElementWidth } from '../../lib/useElementWidth';

// Horizontal bar chart following diagram-design's bar spec
// (github.com/cathrynlavery/diagram-design, references/type-bar.md),
// skinned with this app's tokens instead of the spec's default palette:
// paper -> base-800, ink -> ink-100, muted -> ink-500, accent -> teal (or
// danger when the focal bar is itself a severity, e.g. "Critical").
//
// The rules it keeps:
// - Horizontal bars, because category labels here are long ("Waiting for
//   Information", "Architectural"); nothing is ever rotated.
// - Every bar is the same muted tint + hairline stroke. At most one focal
//   bar takes the accent -- editorial emphasis, not a colour per category.
// - The value axis always starts at zero, and every bar prints its value.
// - At most 8 bars: a longer tail folds into one "Other" bar, and the
//   description says what it holds.
// - The SVG is an accessible figure (role="img", <title> + <desc>), with
//   the full data spelled out in the description. One deviation from the
//   spec: <desc> is wired through aria-describedby rather than folded into
//   aria-labelledby, so a screen reader hears a short name, then the data.

export interface BarDatum {
  key: string;
  label: string;
  value: number;
}

const MAX_BARS = 8;
const ROW_PITCH = 30;
const BAR_HEIGHT = 16;
const AXIS_HEIGHT = 22;
const VALUE_GUTTER = 40;
const LABEL_GAP = 10;
const CHAR_WIDTH = 6.6;

const FOCAL_CLASSES = {
  accent: { bar: 'fill-teal/[0.12] stroke-teal', value: 'fill-teal' },
  danger: { bar: 'fill-danger/[0.12] stroke-danger', value: 'fill-danger' },
} as const;

// A 1/2/5 x 10^k step giving 3-5 ticks, so the axis ends on a round number.
function niceScale(max: number): { ceil: number; step: number } {
  if (max <= 0) return { ceil: 1, step: 1 };
  const raw = max / 4;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * magnitude).find((s) => s >= raw) ?? raw;
  const intStep = Math.max(1, Math.round(step));
  return { ceil: Math.ceil(max / intStep) * intStep, step: intStep };
}

function foldTail(rows: BarDatum[]): { rows: BarDatum[]; folded: BarDatum[] } {
  if (rows.length <= MAX_BARS) return { rows, folded: [] };
  const keep = new Set([...rows].sort((a, b) => b.value - a.value).slice(0, MAX_BARS - 1).map((r) => r.key));
  const folded = rows.filter((r) => !keep.has(r.key));
  const other: BarDatum = {
    key: '__other',
    label: `Other (${folded.length})`,
    value: folded.reduce((sum, r) => sum + Number(r.value), 0),
  };
  return { rows: [...rows.filter((r) => keep.has(r.key)), other], folded };
}

function truncate(label: string, maxChars: number) {
  return label.length > maxChars ? `${label.slice(0, Math.max(1, maxChars - 1))}…` : label;
}

export function BarChart({
  title,
  data,
  focalKey,
  focalTone = 'accent',
  unit = 'items',
  onSelect,
  selectLabel = 'Show these',
}: {
  title: string;
  data: BarDatum[];
  focalKey?: string;
  focalTone?: keyof typeof FOCAL_CLASSES;
  /** Plural noun for the counted thing, used in the description and row buttons. */
  unit?: string;
  /** Makes each row a button (drill-down). */
  onSelect?: (key: string) => void;
  selectLabel?: string;
}) {
  const id = useId();
  const [ref, width] = useElementWidth<HTMLDivElement>(480);
  const { rows, folded } = foldTail(data);

  if (rows.length === 0 || rows.every((r) => r.value === 0)) {
    return (
      <div ref={ref} className="h-24 flex items-center justify-center text-xs text-ink-500">
        No data yet.
      </div>
    );
  }

  const { ceil, step } = niceScale(Math.max(...rows.map((r) => r.value)));
  const longest = rows.reduce((m, r) => Math.max(m, r.label.length), 0);
  const labelWidth = Math.round(Math.min(Math.max(longest * CHAR_WIDTH, 64), Math.min(170, width * 0.4)));
  // +1 absorbs the rounding above, so a label that set the width never truncates itself.
  const maxChars = Math.floor((labelWidth + 1) / CHAR_WIDTH);
  const plotX0 = labelWidth + LABEL_GAP;
  const plotX1 = Math.max(plotX0 + 40, width - VALUE_GUTTER);
  const plotWidth = plotX1 - plotX0;
  const height = rows.length * ROW_PITCH + AXIS_HEIGHT;
  const axisY = rows.length * ROW_PITCH;
  const x = (v: number) => plotX0 + (v / ceil) * plotWidth;
  const ticks = Array.from({ length: Math.floor(ceil / step) + 1 }, (_, i) => i * step);

  const desc = `${rows.map((r) => `${r.label}: ${r.value}`).join(', ')}.`
    + (folded.length ? ` Other combines ${folded.map((r) => `${r.label} (${r.value})`).join(', ')}.` : '');

  return (
    <div ref={ref} className="relative w-full">
      <svg
        width={width}
        height={height}
        role="img"
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-desc`}
        className="block overflow-visible"
      >
        <title id={`${id}-title`}>{`${title} (${unit})`}</title>
        <desc id={`${id}-desc`}>{desc}</desc>

        {ticks.map((t) => (
          <g key={t}>
            <line
              x1={x(t)} x2={x(t)} y1={0} y2={axisY}
              className={t === 0 ? 'stroke-ink-100/25' : 'stroke-ink-100/[0.08]'}
              strokeWidth={t === 0 ? 1 : 0.8}
            />
            <text x={x(t)} y={axisY + 15} textAnchor="middle" className="fill-ink-500 text-axis tabular-nums">
              {t}
            </text>
          </g>
        ))}

        {rows.map((r, i) => {
          const focal = r.key === focalKey && r.value > 0;
          const tone = FOCAL_CLASSES[focalTone];
          const cy = i * ROW_PITCH + ROW_PITCH / 2;
          const barWidth = r.value > 0 ? Math.max(2, x(r.value) - plotX0) : 0;
          return (
            <g key={r.key}>
              <text
                x={labelWidth} y={cy} textAnchor="end" dominantBaseline="central"
                className={`text-xs font-medium ${focal ? 'fill-ink-100' : 'fill-ink-300'}`}
              >
                {truncate(r.label, maxChars)}
                {r.label.length > maxChars && <title>{r.label}</title>}
              </text>
              {barWidth > 0 && (
                <rect
                  x={plotX0} y={cy - BAR_HEIGHT / 2} width={barWidth} height={BAR_HEIGHT} rx={2}
                  strokeWidth={1}
                  className={focal ? tone.bar : 'fill-ink-500/[0.15] stroke-ink-500'}
                />
              )}
              <text
                x={plotX0 + barWidth + 6} y={cy} dominantBaseline="central"
                className={`text-caption font-semibold tabular-nums ${focal ? tone.value : 'fill-ink-300'}`}
              >
                {r.value}
              </text>
            </g>
          );
        })}
      </svg>

      {onSelect && rows.map((r, i) => (r.key === '__other' ? null : (
        <button
          key={r.key}
          type="button"
          onClick={() => onSelect(r.key)}
          aria-label={`${selectLabel}: ${r.label}, ${r.value} ${unit}`}
          style={{ top: i * ROW_PITCH, height: ROW_PITCH }}
          className="absolute inset-x-0 rounded text-ink-100 hover:bg-base-700/50 focus-visible:bg-base-700/50 transition-colors"
        />
      )))}
    </div>
  );
}
