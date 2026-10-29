import type { RiskByGroup } from '../../lib/risk.api';
import { BarChart } from '../charts/BarChart';
import { disciplineLabel } from './riskDisplay';

const UNSPECIFIED = 'UNSPECIFIED';

// Open risks per discipline, highest first. Each row is a button that
// filters the register below to that discipline. No focal bar: the sort
// order already carries the ranking, and the accent stays reserved for a
// bar the reader is meant to look at first.
export function RiskDisciplineChart({ data, onSelectDiscipline }: {
  data: RiskByGroup[];
  onSelectDiscipline: (discipline: string) => void;
}) {
  const rows = [...data]
    .sort((a, b) => b.count - a.count)
    .map((d) => ({ key: d.discipline ?? UNSPECIFIED, label: disciplineLabel(d.discipline), value: d.count }));

  return (
    <div className="panel p-4 h-full flex flex-col">
      <div className="mb-4">
        <div className="text-sm font-semibold text-ink-100">Risk by Discipline</div>
        <p className="text-xs text-ink-500 mt-0.5">Open risks per discipline, highest first. Select one to filter the register.</p>
      </div>
      {rows.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-xs text-ink-500">No discipline data yet.</div>
      ) : (
        <BarChart
          title="Open risks by discipline"
          data={rows}
          unit="open risks"
          onSelect={onSelectDiscipline}
          selectLabel="Filter the register to"
        />
      )}
    </div>
  );
}
