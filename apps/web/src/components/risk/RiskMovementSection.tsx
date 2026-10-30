import { useState } from 'react';
import type { Risk, RiskMovement, RiskMovementItem } from '../../lib/risk.api';
import { riskRef, disciplineLabel } from './riskDisplay';
import { SectionHeader } from '../ui/SectionHeader';

const ROW_LIMIT = 5;
const DAY_OPTIONS: (7 | 14 | 30)[] = [7, 14, 30];

function MovementRow({ risk, detail, detailClass, onSelect }: {
  risk: Risk; detail: string; detailClass?: string; onSelect: (id: string) => void;
}) {
  return (
    <li>
      <button onClick={() => onSelect(risk.id)} className="w-full flex items-center justify-between gap-4 px-4 py-2 text-left hover:bg-base-700 transition-colors">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono text-ink-500 shrink-0">{riskRef(risk)}</span>
            <span className="text-sm text-ink-100 truncate">{risk.title}</span>
          </div>
          <div className="text-xs text-ink-500 mt-0 truncate">
            {disciplineLabel(risk.discipline)}{risk.locationLabel ? ` · ${risk.locationLabel}` : ''}
          </div>
        </div>
        <span className={`text-xs shrink-0 tabular-nums ${detailClass ?? 'text-ink-300'}`}>{detail}</span>
      </button>
    </li>
  );
}

function MovementGroup({ title, description, tone, count, rows }: {
  title: string; description: string; tone: 'danger' | 'ok' | 'neutral'; count: number; rows: React.ReactNode;
}) {
  const toneClass = tone === 'danger' ? 'text-danger' : tone === 'ok' ? 'text-ok' : 'text-ink-500';
  return (
    <div className="panel tick-frame">
      <div className="px-4 py-2 border-b border-base-600 flex items-center justify-between">
        <div>
          <div className={`text-sm font-semibold ${count > 0 ? 'text-ink-100' : 'text-ink-500'}`}>{title} <span className={`tabular-nums ${toneClass}`}>({count})</span></div>
          <p className="text-xs text-ink-500 mt-0">{description}</p>
        </div>
      </div>
      {count === 0 ? (
        <div className="px-4 py-4 text-center text-xs text-ink-500">None this period.</div>
      ) : (
        <ul className="divide-y divide-base-700/60">{rows}</ul>
      )}
    </div>
  );
}

// Risk Movement (brief Phase 3): emerged/worsened/improved/unresolved during
// the selected window, each a real bucket from RiskService.getRiskMovement()
// (risk_snapshots history + firstDetectedAt/resolvedAt/closedAt) -- nothing
// computed here, this only renders what the backend already classified.
// Placed after the conclusion/KPI/attention panels and before the heatmap/
// register, per the brief's own prescribed order: conclusion -> critical
// risks -> risk movement -> everything else, full register behind drill-down.
export function RiskMovementSection({ movement, isLoading, days, onDaysChange, onSelectRisk }: {
  movement: RiskMovement | undefined;
  isLoading: boolean;
  days: 7 | 14 | 30;
  onDaysChange: (days: 7 | 14 | 30) => void;
  onSelectRisk: (riskId: string) => void;
}) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  if (isLoading) {
    return <div className="panel tick-frame p-6 h-32 animate-pulse bg-base-700/40" />;
  }
  if (!movement) return null;

  const totalMoved = movement.emerged.length + movement.worsened.length + movement.improved.length
    + movement.resolvedDuringPeriod.length + movement.unresolved.length;

  function visible<T>(key: string, items: T[]): T[] {
    return expanded[key] ? items : items.slice(0, ROW_LIMIT);
  }
  function toggle(key: string) {
    setExpanded((e) => ({ ...e, [key]: !e[key] }));
  }
  function showAllLink(key: string, items: { length: number }) {
    if (items.length <= ROW_LIMIT) return null;
    return (
      <li className="px-4 py-2 text-center">
        <button onClick={() => toggle(key)} className="text-xs text-blueprint hover:text-blueprint-hover">
          {expanded[key] ? 'Show fewer' : `Show all ${items.length}`}
        </button>
      </li>
    );
  }

  type ImprovedRow = { kind: 'scored'; item: RiskMovementItem } | { kind: 'resolved'; risk: Risk };
  const allImproved: ImprovedRow[] = [
    ...movement.improved.map((item): ImprovedRow => ({ kind: 'scored', item })),
    ...movement.resolvedDuringPeriod.map((risk): ImprovedRow => ({ kind: 'resolved', risk })),
  ];

  return (
    <div className="space-y-4">
      <SectionHeader
        title={`Risk Movement — last ${days} days`}
        size="sm"
        actions={
          <div className="flex items-center gap-2">
            {DAY_OPTIONS.map((d) => (
              <button
                key={d}
                onClick={() => onDaysChange(d)}
                aria-pressed={days === d}
                className={`btn-secondary !px-2 !py-2 text-xs ${days === d ? '!bg-blueprint-muted !text-blueprint !border-blueprint/40' : ''}`}
              >
                {d}d
              </button>
            ))}
          </div>
        }
      />

      {totalMoved === 0 ? (
        <div className="panel tick-frame p-6 text-center text-sm text-ink-500">
          No risk emerged, materially changed, or was resolved in the last {days} days.
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <MovementGroup
            title="Emerged" tone="danger" count={movement.emerged.length}
            description="New risks detected during this period."
            rows={<>
              {visible('emerged', movement.emerged).map((r) => (
                <MovementRow key={r.id} risk={r} detail={`${r.score}/100`} onSelect={onSelectRisk} />
              ))}
              {showAllLink('emerged', movement.emerged)}
            </>}
          />

          <MovementGroup
            title="Worsened" tone="danger" count={movement.worsened.length}
            description={`Score rose materially since ${days} days ago.`}
            rows={<>
              {visible('worsened', movement.worsened).map(({ risk, deltaScore }) => (
                <MovementRow key={risk.id} risk={risk} detail={`+${deltaScore} → ${risk.score}`} detailClass="text-danger" onSelect={onSelectRisk} />
              ))}
              {showAllLink('worsened', movement.worsened)}
            </>}
          />

          <MovementGroup
            title="Improved" tone="ok" count={allImproved.length}
            description="Score fell materially, or the risk was resolved/closed, during this period."
            rows={<>
              {visible('improved', allImproved).map((row) => row.kind === 'scored' ? (
                <MovementRow key={row.item.risk.id} risk={row.item.risk} detail={`${row.item.deltaScore} → ${row.item.risk.score}`} detailClass="text-ok" onSelect={onSelectRisk} />
              ) : (
                <MovementRow key={row.risk.id} risk={row.risk} detail="Resolved" detailClass="text-ok" onSelect={onSelectRisk} />
              ))}
              {showAllLink('improved', allImproved)}
            </>}
          />

          <MovementGroup
            title="Unresolved" tone="neutral" count={movement.unresolved.length}
            description="Still open with no material change this period."
            rows={<>
              {visible('unresolved', movement.unresolved).map((r) => (
                <MovementRow key={r.id} risk={r} detail={`${r.score}/100`} onSelect={onSelectRisk} />
              ))}
              {showAllLink('unresolved', movement.unresolved)}
            </>}
          />
        </div>
      )}
    </div>
  );
}
