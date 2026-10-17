import { useThemeColors } from '../../lib/useThemeColors';
import type { Risk, RiskHeatmapCell, RiskMatrixLevel } from '../../lib/risk.api';

const HIGH_HEX = '#FB923C';
const VERY_HIGH_HEX = '#F97316';

const MATRIX_LEVEL_LABELS: Record<RiskMatrixLevel, string> = {
  LOW: 'Low', MEDIUM: 'Medium', HIGH: 'High', VERY_HIGH: 'Very High', CRITICAL: 'Critical',
};
const PROBABILITY_LABELS: Record<number, string> = {
  1: 'Rare', 2: 'Unlikely', 3: 'Possible', 4: 'Likely', 5: 'Almost Certain',
};
const IMPACT_LABELS: Record<number, string> = {
  1: 'Negligible', 2: 'Minor', 3: 'Moderate', 4: 'Major', 5: 'Severe',
};

// 5x5 Risk Matrix heatmap (brief sections 4, 20-21). Probability increases
// upward, impact increases rightward -- the standard risk-matrix reading
// convention. A cell's count/color/score come straight from the server
// (RiskService.getRiskHeatmap); `risks` is only used here to resolve a
// cell's riskIds into titles for a single-risk click and the tooltip,
// never to recompute anything already decided server-side.
export function RiskHeatmap({ cells, risks, onSelectRisk, onFilterCell }: {
  cells: RiskHeatmapCell[];
  risks: Risk[];
  onSelectRisk: (riskId: string) => void;
  onFilterCell: (riskIds: string[], label: string) => void;
}) {
  const themeColors = useThemeColors();
  const levelColor: Record<RiskMatrixLevel, string> = {
    LOW: themeColors.ok, MEDIUM: themeColors.warn, HIGH: HIGH_HEX, VERY_HIGH: VERY_HIGH_HEX, CRITICAL: themeColors.danger,
  };
  const byId = new Map(risks.map((r) => [r.id, r]));
  const cellByCoords = new Map(cells.map((c) => [`${c.probability}-${c.impact}`, c]));

  function handleClick(cell: RiskHeatmapCell | undefined, probability: number, impact: number) {
    if (!cell || cell.count === 0) return;
    if (cell.count === 1) onSelectRisk(cell.riskIds[0]);
    else onFilterCell(cell.riskIds, `Probability ${probability} × Impact ${impact}`);
  }

  return (
    <div className="panel p-4 h-full flex flex-col">
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="text-sm font-semibold text-ink-100">Risk Matrix Heatmap</div>
          <p className="text-xs text-ink-500 mt-0.5">Open risks by Probability × Impact</p>
        </div>
        <Legend levelColor={levelColor} />
      </div>

      <div className="flex gap-2 flex-1">
        <div className="flex flex-col items-end justify-between py-1 pr-1 shrink-0">
          {[5, 4, 3, 2, 1].map((p) => (
            <div key={p} className="h-12 flex flex-col items-end justify-center leading-tight">
              <span className="text-xs font-semibold text-ink-300 tabular-nums">{p}</span>
            </div>
          ))}
        </div>
        <div className="flex-1 min-w-0">
          <div className="grid grid-cols-5 gap-1">
            {[5, 4, 3, 2, 1].flatMap((p) => [1, 2, 3, 4, 5].map((i) => {
              const cell = cellByCoords.get(`${p}-${i}`);
              const count = cell?.count ?? 0;
              const names = cell && cell.count > 1 ? cell.riskIds.slice(0, 4).map((id) => byId.get(id)?.title ?? id) : [];
              const tooltip = cell
                ? `Probability ${p} (${PROBABILITY_LABELS[p]}) × Impact ${i} (${IMPACT_LABELS[i]}) = ${cell.score} (${MATRIX_LEVEL_LABELS[cell.level]})${count > 0 ? ` — ${count} risk${count === 1 ? '' : 's'}` : ''}${names.length ? `: ${names.join(', ')}${cell.count > 4 ? '…' : ''}` : ''}`
                : undefined;
              return (
                <button
                  key={`${p}-${i}`}
                  onClick={() => handleClick(cell, p, i)}
                  disabled={count === 0}
                  title={tooltip}
                  className="h-12 w-full rounded flex items-center justify-center text-sm font-semibold tabular-nums transition-opacity hover:opacity-80 disabled:cursor-default"
                  style={{
                    backgroundColor: cell ? `${levelColor[cell.level]}${count > 0 ? '4d' : '14'}` : 'transparent',
                    color: count > 0 ? levelColor[cell!.level] : themeColors['base-600'],
                  }}
                >
                  {count > 0 ? count : ''}
                </button>
              );
            }))}
          </div>
          <div className="flex justify-between text-xs font-semibold text-ink-300 mt-1.5 px-0.5 tabular-nums">
            {[1, 2, 3, 4, 5].map((i) => <span key={i}>{i}</span>)}
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between text-[10px] text-ink-500 mt-2 pl-7">
        <span className="font-mono uppercase tracking-wide">↑ Probability</span>
        <span className="font-mono uppercase tracking-wide">Impact →</span>
      </div>
    </div>
  );
}

function Legend({ levelColor }: { levelColor: Record<RiskMatrixLevel, string> }) {
  const order: RiskMatrixLevel[] = ['LOW', 'MEDIUM', 'HIGH', 'VERY_HIGH', 'CRITICAL'];
  return (
    <div className="hidden sm:flex items-center gap-2.5">
      {order.map((l) => (
        <span key={l} className="flex items-center gap-1 text-[10px] text-ink-500">
          <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: levelColor[l] }} />
          {MATRIX_LEVEL_LABELS[l]}
        </span>
      ))}
    </div>
  );
}
