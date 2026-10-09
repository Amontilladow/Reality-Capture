// One shared KPI tile for both the Projects dashboard (Phase 1D) and the
// Reports page's dense per-section stat rows -- these were two near-
// identical hand-copied components (different padding/font-size) before
// this consolidation. 'lg' matches the dashboard's spacious 4-tile row;
// 'sm' (default) matches Reports' dense 5-to-7-tile rows.
export function StatTile({
  label,
  value,
  tone,
  size = 'sm',
}: {
  label: string;
  value: number;
  tone?: 'danger';
  size?: 'sm' | 'lg';
}) {
  const danger = tone === 'danger' && value > 0;
  return (
    <div className={`panel text-left ${size === 'lg' ? 'px-5 py-4' : 'p-3'}`}>
      <div className={`${size === 'lg' ? 'text-kpi' : 'text-xl'} font-semibold tabular-nums ${danger ? 'text-danger' : 'text-ink-100'}`}>
        {value}
      </div>
      <div className="text-[10px] uppercase tracking-wide text-ink-500 mt-0.5">{label}</div>
    </div>
  );
}
