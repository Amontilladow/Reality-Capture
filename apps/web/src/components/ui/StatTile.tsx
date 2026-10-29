// One shared KPI tile for the Projects dashboard, the Reports page's dense
// per-section stat rows, and the per-project dashboard's Issues/BIM tiles.
// 'lg' is the dashboard's spacious row; 'sm' (default) Reports' dense rows.
//
// danger/warn/ok carry real status meaning and color the number plus a
// small dot beside the label (status is never color alone: the label names
// it). teal/orange are accents for a neutral figure. A tile with no tone,
// or a zero value, stays ink -- a grid of tiles should be quiet until a
// number needs attention. No top bar or wash: the figure is the hierarchy.
export function StatTile({
  label,
  value,
  tone,
  size = 'sm',
}: {
  label: string;
  value: number;
  tone?: 'danger' | 'warn' | 'ok' | 'teal' | 'orange';
  size?: 'sm' | 'lg';
}) {
  const active = tone !== undefined && value > 0;
  const toneClasses: Record<'danger' | 'warn' | 'ok' | 'teal' | 'orange', { text: string; dot: string }> = {
    danger: { text: 'text-danger', dot: 'bg-danger' },
    warn: { text: 'text-warn', dot: 'bg-warn' },
    ok: { text: 'text-ok', dot: 'bg-ok' },
    teal: { text: 'text-teal', dot: 'bg-teal' },
    orange: { text: 'text-orange', dot: 'bg-orange' },
  };
  const resolved = active ? toneClasses[tone] : { text: 'text-ink-100', dot: '' };
  return (
    <div className={`panel text-left ${size === 'lg' ? 'px-5 py-4' : 'px-3.5 py-3'}`}>
      <div className="flex items-center gap-1.5 text-xs font-medium text-ink-500">
        {resolved.dot && <span aria-hidden="true" className={`w-1.5 h-1.5 rounded-full ${resolved.dot}`} />}
        <span className="truncate">{label}</span>
      </div>
      <div className={`${size === 'lg' ? 'text-3xl mt-2' : 'text-xl mt-1'} font-semibold tabular-nums tracking-tight ${resolved.text}`}>
        {value.toLocaleString()}
      </div>
    </div>
  );
}
