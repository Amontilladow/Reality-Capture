// One shared KPI tile for the Projects dashboard (Phase 1D), the Reports
// page's dense per-section stat rows, and the per-project dashboard's
// Issues/BIM tiles (previously three separate hand-copied components with
// slightly different tone vocabularies -- consolidated here). 'lg' matches
// the dashboard's spacious 4-tile row; 'sm' (default) matches Reports'
// dense 5-to-7-tile rows.
//
// danger/warn/ok carry real status meaning (critical count, overdue count,
// resolved count) and always color the number itself. teal/orange are
// decorative accents only (platform visual upgrade) -- available for a
// call site with a genuinely neutral figure worth a premium accent (e.g. a
// "Total" tile), never implying good/bad the way the three status tones
// do. A tile with no tone at all still gets a teal top-border + faint teal
// wash (the default accent, replacing the old plain blueprint hairline) so
// a bare grid of tiles reads as "on brand" without every number being
// colored. Numbers are deliberately heavy (font-black, text-5xl at 'lg')
// -- the reference deck's whole stat-callout language is oversized bold
// figures with a small caption beneath, not a modest labeled count.
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
  const toneClasses: Record<'danger' | 'warn' | 'ok' | 'teal' | 'orange', { border: string; text: string; wash: string }> = {
    danger: { border: 'border-t-danger', text: 'text-danger', wash: '' },
    warn: { border: 'border-t-warn', text: 'text-warn', wash: '' },
    ok: { border: 'border-t-ok', text: 'text-ok', wash: '' },
    teal: { border: 'border-t-teal', text: 'text-teal', wash: 'bg-teal/5' },
    orange: { border: 'border-t-orange', text: 'text-orange', wash: 'bg-orange/5' },
  };
  const resolved = active ? toneClasses[tone] : { border: 'border-t-teal', text: 'text-ink-100', wash: 'bg-teal/[0.04]' };
  return (
    <div className={`panel text-left border-t-[3px] ${resolved.border} ${resolved.wash} ${size === 'lg' ? 'px-5 py-5' : 'p-3.5'}`}>
      <div className={`${size === 'lg' ? 'text-5xl' : 'text-2xl'} font-black tabular-nums tracking-tight ${resolved.text}`}>
        {value}
      </div>
      <div className="text-[11px] uppercase tracking-wide text-ink-500 mt-1 font-semibold">{label}</div>
    </div>
  );
}
