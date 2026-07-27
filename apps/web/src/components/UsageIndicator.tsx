function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 GB';
  const gb = bytes / 1024 ** 3;
  return gb >= 1 ? `${gb.toFixed(1)} GB` : `${(bytes / 1024 ** 2).toFixed(0)} MB`;
}

function Bar({ label, used, max, format }: { label: string; used: number; max?: number; format?: (n: number) => string }) {
  const pct = max ? Math.min(100, (used / max) * 100) : 0;
  const nearLimit = pct >= 85;
  return (
    <div>
      <div className="flex items-baseline justify-between text-xs mb-1">
        <span className="text-ink-500 uppercase tracking-wide font-mono">{label}</span>
        <span className="font-mono text-ink-300">
          {format ? format(used) : used}
          {max ? ` / ${format ? format(max) : max}` : ' / unlimited'}
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-base-700 overflow-hidden">
        <div
          className={`h-full rounded-full ${nearLimit ? 'bg-warn' : 'bg-blueprint'}`}
          style={{ width: max ? `${pct}%` : '8%' }}
        />
      </div>
    </div>
  );
}

export function UsageIndicator({
  usage,
  limits,
}: {
  usage: { activeProjects: number; activeUsers: number; storageBytes: number };
  limits: { maxProjects?: number; maxUsers?: number; maxStorageBytes?: number };
}) {
  return (
    <div className="space-y-3">
      <Bar label="Projects" used={usage.activeProjects} max={limits.maxProjects} />
      <Bar label="Users" used={usage.activeUsers} max={limits.maxUsers} />
      <Bar label="Storage" used={usage.storageBytes} max={limits.maxStorageBytes} format={formatBytes} />
    </div>
  );
}
