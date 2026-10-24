// One shared KPI tile for the Projects dashboard (Phase 1D), the Reports
// page's dense per-section stat rows, and the per-project dashboard's
// Issues/BIM tiles (previously three separate hand-copied components with
// slightly different tone vocabularies -- consolidated here). 'lg' matches
// the dashboard's spacious 4-tile row; 'sm' (default) matches Reports'
// dense 5-to-7-tile rows.
export function StatTile({
  label,
  value,
  tone,
  size = 'sm',
}: {
  label: string;
  value: number;
  tone?: 'danger' | 'warn' | 'ok';
  size?: 'sm' | 'lg';
}) {
  const active = tone !== undefined && value > 0;
  const toneClasses: Record<'danger' | 'warn' | 'ok', { border: string; text: string }> = {
    danger: { border: 'border-t-danger', text: 'text-danger' },
    warn: { border: 'border-t-warn', text: 'text-warn' },
    ok: { border: 'border-t-ok', text: 'text-ok' },
  };
  const resolved = active ? toneClasses[tone] : { border: 'border-t-blueprint/40', text: 'text-ink-100' };
  return (
    <div className={`panel text-left border-t-2 ${resolved.border} ${size === 'lg' ? 'px-5 py-4' : 'p-3'}`}>
      <div className={`${size === 'lg' ? 'text-kpi' : 'text-xl'} font-semibold tabular-nums ${resolved.text}`}>
        {value}
      </div>
      <div className="text-[10px] uppercase tracking-wide text-ink-500 mt-0.5">{label}</div>
    </div>
  );
}
