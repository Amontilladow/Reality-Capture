import type { Risk, RiskHeatmapCell, RiskMatrixLevel } from '../../lib/risk.api';
import { useThemeColors } from '../../lib/useThemeColors';

const MATRIX_LEVEL_LABELS: Record<RiskMatrixLevel, string> = {
  LOW: 'Low', MEDIUM: 'Medium', HIGH: 'High', VERY_HIGH: 'Very High', CRITICAL: 'Critical',
};
const PROBABILITY_LABELS: Record<number, string> = {
  1: 'Rare', 2: 'Unlikely', 3: 'Possible', 4: 'Likely', 5: 'Almost certain',
};
const IMPACT_LABELS: Record<number, string> = {
  1: 'Negligible', 2: 'Minor', 3: 'Moderate', 4: 'Major', 5: 'Severe',
};
const SEVERE_LEVELS = new Set<RiskMatrixLevel>(['HIGH', 'VERY_HIGH', 'CRITICAL']);

// Ink-ramp opacity bounds from diagram-design's heatmap spec
// (references/type-heatmap.md): the faintest occupied cell stays visible
// against the panel, the darkest stays clear of the focal accent, and cell
// text flips to the panel colour once the fill is dark enough to carry it.
const RAMP_MIN = 0.07;
const RAMP_MAX = 0.65;
const TEXT_FLIP = 0.4;
const FOCAL_OPACITY = 0.85;

// Cell fills are painted as the opaque result of the ramp opacity over the
// panel, rather than as a translucent colour, so the drawn colour (and the
// contrast of the count printed on it) is exact and measurable.
function mix(fgHex: string, bgHex: string, alpha: number): string {
  const ch = (hex: string, i: number) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
  const rgb = [0, 1, 2].map((i) => Math.round(ch(fgHex, i) * alpha + ch(bgHex, i) * (1 - alpha)));
  return `rgb(${rgb.join(', ')})`;
}

// 5x5 Risk Matrix (brief sections 4, 20-21). Probability increases upward,
// impact rightward -- the standard risk-matrix reading convention.
//
// Drawn to the heatmap spec rather than as a traffic-light grid:
// - Fill encodes one thing, how many open risks sit in the cell, on a
//   single ink ramp. The old five-hue fill coloured empty cells too, so the
//   eye read severity bands instead of where the risks actually are.
// - Exactly one focal cell takes the accent: the highest-scoring cell that
//   holds any open risk, which is the cell the matrix exists to point at.
//   It sits outside the ramp's scale so an outlier can't wash out the rest.
// - Severity still shows, as a dashed outline on every High-or-worse cell,
//   so position-based severity and count-based fill never share a channel.
//
// A cell's count/score/level come straight from the server
// (RiskService.getRiskHeatmap); `risks` only resolves a cell's riskIds into
// titles for a single-risk click and the label.
export function RiskHeatmap({ cells, risks, onSelectRisk, onFilterCell }: {
  cells: RiskHeatmapCell[];
  risks: Risk[];
  onSelectRisk: (riskId: string) => void;
  onFilterCell: (riskIds: string[], label: string) => void;
}) {
  const colors = useThemeColors();
  const byId = new Map(risks.map((r) => [r.id, r]));
  const cellByCoords = new Map(cells.map((c) => [`${c.probability}-${c.impact}`, c]));

  const occupied = cells.filter((c) => c.count > 0);
  const focal = occupied.reduce<RiskHeatmapCell | undefined>(
    (best, c) => (!best || c.score > best.score || (c.score === best.score && c.count > best.count) ? c : best),
    undefined,
  );
  const maxNonFocal = Math.max(1, ...occupied.filter((c) => c !== focal).map((c) => c.count));
  const opacityFor = (count: number) => Math.max(RAMP_MIN, (count / maxNonFocal) * RAMP_MAX);

  function handleClick(cell: RiskHeatmapCell | undefined, probability: number, impact: number) {
    if (!cell || cell.count === 0) return;
    if (cell.count === 1) onSelectRisk(cell.riskIds[0]);
    else onFilterCell(cell.riskIds, `Probability ${probability} × Impact ${impact}`);
  }

  function describe(cell: RiskHeatmapCell | undefined, p: number, i: number) {
    const count = cell?.count ?? 0;
    const base = `Probability ${p} (${PROBABILITY_LABELS[p]}) × Impact ${i} (${IMPACT_LABELS[i]})`;
    if (!cell) return base;
    const names = count > 1 ? cell.riskIds.slice(0, 4).map((id) => byId.get(id)?.title ?? id) : [];
    return `${base} = ${cell.score} (${MATRIX_LEVEL_LABELS[cell.level]})`
      + (count > 0 ? `, ${count} open risk${count === 1 ? '' : 's'}` : ', no open risks')
      + (names.length ? `: ${names.join(', ')}${count > 4 ? '…' : ''}` : '');
  }

  return (
    <figure className="panel p-4 h-full flex flex-col" aria-labelledby="risk-matrix-title">
      <div className="mb-4">
        <div id="risk-matrix-title" className="text-sm font-semibold text-ink-100">Risk Matrix</div>
        <p className="text-xs text-ink-500 mt-0.5">Where open risks sit by probability and impact</p>
      </div>

      <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2">
        {/* Row labels, probability 5 at the top */}
        <div className="grid grid-rows-5 gap-1">
          {[5, 4, 3, 2, 1].map((p) => (
            <div key={p} className="h-12 flex items-center justify-end gap-1.5 text-xs text-ink-300">
              <span className="hidden sm:inline">{PROBABILITY_LABELS[p]}</span>
              <span className="font-semibold tabular-nums text-ink-100 w-3 text-right">{p}</span>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-5 gap-1">
          {[5, 4, 3, 2, 1].flatMap((p) => [1, 2, 3, 4, 5].map((i) => {
            const cell = cellByCoords.get(`${p}-${i}`);
            const count = cell?.count ?? 0;
            const isFocal = cell !== undefined && cell === focal;
            const severe = cell ? SEVERE_LEVELS.has(cell.level) : false;
            const opacity = count > 0 && !isFocal ? opacityFor(count) : 0;
            const label = describe(cell, p, i);
            const style = isFocal
              ? { backgroundColor: mix(colors.danger, colors['base-800'], FOCAL_OPACITY), color: colors['base-800'] }
              : count > 0
                ? { backgroundColor: mix(colors['ink-100'], colors['base-800'], opacity), color: opacity >= TEXT_FLIP ? colors['base-800'] : colors['ink-100'] }
                : undefined;
            return (
              <button
                key={`${p}-${i}`}
                type="button"
                onClick={() => handleClick(cell, p, i)}
                disabled={count === 0}
                title={label}
                aria-label={label}
                style={style}
                className={`h-12 w-full rounded-sm flex items-center justify-center text-sm font-semibold tabular-nums transition-[filter] enabled:hover:brightness-95 disabled:cursor-default ${
                  count === 0 ? 'bg-base-900' : ''
                } ${isFocal ? 'border border-danger' : severe ? 'border border-dashed border-ink-500/70' : 'border border-transparent'}`}
              >
                {count > 0 ? count : ''}
              </button>
            );
          }))}
        </div>

        {/* Column labels, impact 1 on the left */}
        <div />
        <div className="grid grid-cols-5 gap-1 mt-1.5">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="text-center text-xs text-ink-300 leading-tight">
              <span className="font-semibold tabular-nums text-ink-100">{i}</span>
              <span className="hidden sm:block text-axis text-ink-500">{IMPACT_LABELS[i]}</span>
            </div>
          ))}
        </div>
        <div />
        <div className="flex justify-between text-axis text-ink-500 mt-1">
          <span>Probability ↑ rows</span>
          <span>Impact → columns</span>
        </div>
      </div>

      {/* Legend strip along the bottom, one key per treatment in use */}
      <div className="mt-auto pt-4 border-t border-base-600 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-ink-500">
        <span className="flex items-center gap-1.5">
          <span className="flex" aria-hidden="true">
            {[0.12, 0.35, 0.6].map((o) => (
              <span key={o} className="w-3.5 h-3.5 first:rounded-l-sm last:rounded-r-sm" style={{ backgroundColor: `rgb(var(--rc-ink-100) / ${o})` }} />
            ))}
          </span>
          Fewer to more open risks
        </span>
        {focal && (
          <span className="flex items-center gap-1.5">
            <span aria-hidden="true" className="w-3.5 h-3.5 rounded-sm border border-danger" style={{ backgroundColor: mix(colors.danger, colors['base-800'], FOCAL_OPACITY) }} />
            Highest-scoring cell with open risks (score {focal.score}, {focal.count} risk{focal.count === 1 ? '' : 's'})
          </span>
        )}
        <span className="flex items-center gap-1.5">
          <span aria-hidden="true" className="w-3.5 h-3.5 rounded-sm border border-dashed border-ink-500/70" />
          High severity or worse
        </span>
      </div>
    </figure>
  );
}
