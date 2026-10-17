import { useThemeColors } from '../../lib/useThemeColors';
import type { Risk, RiskLevel } from '../../lib/risk.api';
import { attentionRank, disciplineLabel, dueDateTone, formatDueDate, isOverdue, riskRef } from './riskDisplay';

const HIGH_HEX = '#FB923C';

// Compact, prioritized list of the risks that most need a decision right
// now (brief section 4C) -- a strict ordering over the already-loaded open
// register, not a new query or a fabricated "urgency score". See
// attentionRank() for the exact ordering rule.
export function RiskAttentionPanel({ risks, ownerNames, onSelectRisk, limit = 6 }: {
  risks: Risk[];
  ownerNames: Map<string, string>;
  onSelectRisk: (riskId: string) => void;
  limit?: number;
}) {
  const themeColors = useThemeColors();
  const levelColor: Record<RiskLevel, string> = { LOW: themeColors.ok, MODERATE: themeColors.warn, HIGH: HIGH_HEX, CRITICAL: themeColors.danger };

  const actionable = risks
    .filter((r) => r.status !== 'RESOLVED' && r.status !== 'CLOSED' && r.status !== 'ACCEPTED')
    .map((r) => ({ r, rank: attentionRank(r) }))
    .filter((x) => x.rank <= 4) // skip the catch-all "everything else" bucket here
    .sort((a, b) => a.rank - b.rank || b.r.score - a.r.score)
    .slice(0, limit)
    .map((x) => x.r);

  return (
    <div className="panel tick-frame">
      <div className="px-4 py-3 border-b border-base-600 flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold text-ink-100">Requires Attention</div>
          <p className="text-xs text-ink-500 mt-0.5">Overdue critical/high risks, unassigned severe risks, and other open items needing a decision.</p>
        </div>
      </div>

      {actionable.length === 0 ? (
        <div className="px-4 py-8 text-center text-sm text-ink-500">Nothing needs attention right now.</div>
      ) : (
        <ul className="divide-y divide-base-700/60">
          {actionable.map((r) => {
            const overdue = isOverdue(r);
            const tone = dueDateTone(r);
            return (
              <li key={r.id}>
                <button
                  onClick={() => onSelectRisk(r.id)}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-base-800/60 transition-colors"
                >
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ backgroundColor: levelColor[r.level] }}
                    title={r.level}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono text-ink-500 shrink-0">{riskRef(r)}</span>
                      <span className="text-sm text-ink-100 truncate">{r.title}</span>
                    </div>
                    <div className="text-xs text-ink-500 mt-0.5 truncate">
                      {disciplineLabel(r.discipline)}
                      {r.locationLabel ? ` · ${r.locationLabel}` : ''}
                      {r.recommendedAction ? ` · ${r.recommendedAction}` : ''}
                    </div>
                  </div>
                  <div className="shrink-0 flex items-center gap-3 text-xs">
                    <span className="text-ink-300 hidden sm:inline">{r.ownerId ? ownerNames.get(r.ownerId) ?? 'Unknown' : 'Unassigned'}</span>
                    <span className={tone === 'overdue' ? 'text-danger font-medium' : tone === 'soon' ? 'text-warn' : 'text-ink-500'}>
                      {overdue ? 'Overdue' : formatDueDate(r.dueDate)}
                    </span>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
