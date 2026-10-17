import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell, LabelList } from 'recharts';
import { useThemeColors } from '../../lib/useThemeColors';
import type { RiskByGroup } from '../../lib/risk.api';
import { disciplineLabel } from './riskDisplay';

type DisciplineRow = RiskByGroup & { label: string };

// Recharts' Tooltip/Bar callbacks aren't generic over a chart's actual data
// shape -- they type their `payload`/event-data param as `unknown` (or a
// near-unusable union), so every consumer needs its own narrow-and-read
// step. A small type guard here instead of a blanket `any` cast.
function rowFromPayload(payload: unknown): DisciplineRow | undefined {
  if (payload && typeof payload === 'object' && 'label' in payload && 'count' in payload) {
    return payload as DisciplineRow;
  }
  return undefined;
}

// Horizontal bars (recharts layout="vertical") -- the natural fit for long
// category names ("Architectural", "Unspecified", ...) without rotated or
// clipped axis labels on any screen width, mobile included.
export function RiskDisciplineChart({ data, onSelectDiscipline }: {
  data: RiskByGroup[];
  onSelectDiscipline: (discipline: string) => void;
}) {
  const themeColors = useThemeColors();
  const rows = [...data]
    .sort((a, b) => b.count - a.count)
    .map((d) => ({ ...d, label: disciplineLabel(d.discipline) }));

  // Fixed row height keeps the chart compact with few disciplines instead
  // of stretching to fill a tall fixed box (brief: "avoid exaggerated empty
  // space when there are only a few categories").
  const height = Math.max(rows.length * 34 + 16, 90);
  const longestLabel = rows.reduce((max, r) => Math.max(max, r.label.length), 0);
  const axisWidth = Math.min(Math.max(longestLabel * 6 + 12, 70), 120);

  return (
    <div className="panel p-4 h-full flex flex-col">
      <div className="mb-3">
        <div className="text-sm font-semibold text-ink-100">Risk by Discipline</div>
        <p className="text-xs text-ink-500 mt-0.5">Open risks grouped by discipline, highest first</p>
      </div>
      {rows.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-xs text-ink-500">No discipline data yet.</div>
      ) : (
        <div style={{ width: '100%', height }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows} layout="vertical" margin={{ top: 0, right: 24, bottom: 0, left: 0 }} barCategoryGap={10}>
              <CartesianGrid strokeDasharray="3 3" stroke={themeColors['base-700']} horizontal={false} />
              <XAxis type="number" allowDecimals={false} tick={{ fill: themeColors['ink-500'], fontSize: 10 }} />
              <YAxis
                type="category" dataKey="label" width={axisWidth}
                tick={{ fill: themeColors['ink-300'], fontSize: 11 }}
                axisLine={false} tickLine={false}
              />
              <Tooltip
                contentStyle={{ background: themeColors['base-800'], border: `1px solid ${themeColors['base-700']}`, borderRadius: 4, fontSize: 12, color: themeColors['ink-100'] }}
                cursor={{ fill: `${themeColors.blueprint}14` }}
                content={({ active, payload }) => {
                  if (!active || !payload?.[0]) return null;
                  const row = rowFromPayload(payload[0].payload);
                  if (!row) return null;
                  return (
                    <div style={{ background: themeColors['base-800'], border: `1px solid ${themeColors['base-700']}`, borderRadius: 4, fontSize: 12, color: themeColors['ink-100'], padding: '6px 10px' }}>
                      <div style={{ fontWeight: 600 }}>{row.label}</div>
                      <div>{row.count} risk{row.count === 1 ? '' : 's'} · avg score {row.averageScore}</div>
                    </div>
                  );
                }}
              />
              <Bar
                dataKey="count" radius={[0, 3, 3, 0]} maxBarSize={18}
                onClick={(d) => {
                  const row = rowFromPayload((d as { payload?: unknown })?.payload);
                  onSelectDiscipline(row?.discipline ?? 'UNSPECIFIED');
                }}
                cursor="pointer"
              >
                {rows.map((d) => <Cell key={d.discipline ?? 'none'} fill={themeColors.blueprint} />)}
                <LabelList dataKey="count" position="right" style={{ fill: themeColors['ink-100'], fontSize: 11, fontWeight: 600 }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
