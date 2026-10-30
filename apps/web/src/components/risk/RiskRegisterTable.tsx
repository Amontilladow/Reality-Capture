import { useEffect, useMemo, useState } from 'react';
import { useThemeColors } from '../../lib/useThemeColors';
import type { ProjectMember } from '../../lib/projects.api';
import type { Risk, RiskLevel, RiskStatus } from '../../lib/risk.api';
import {
  applyRegisterFilters, DEFAULT_REGISTER_FILTERS, disciplineLabel, dueDateTone, formatDueDate,
  hasActiveFilters, riskRef, sortRegister, RISK_DISCIPLINE_LABELS,
  type RegisterFilters, type RegisterSortField,
} from './riskDisplay';
import { Listbox } from '../ui/Listbox';

const LEVEL_LABELS: Record<RiskLevel, string> = { LOW: 'Low', MODERATE: 'Moderate', HIGH: 'High', CRITICAL: 'Critical' };
const STATUS_LABELS: Record<RiskStatus, string> = {
  DETECTED: 'Detected', ACTIVE: 'Active', MITIGATION_IN_PROGRESS: 'Mitigation in progress',
  MONITORING: 'Monitoring', ACCEPTED: 'Accepted', ESCALATED: 'Escalated', RESOLVED: 'Resolved', CLOSED: 'Closed',
};
const PAGE_SIZE = 25;

// The primary working area of the dashboard (brief section 4E): a
// CRM-style register over the full register fetched once by
// RiskIntelligenceSection -- filtering/sorting/paging all happen here,
// client-side, same as the register this replaces, just with more filter
// dimensions and real pagination instead of one long table.
export function RiskRegisterTable({ risks, members, ownerNames, filters, onFiltersChange, onSelectRisk }: {
  risks: Risk[];
  members: ProjectMember[];
  ownerNames: Map<string, string>;
  filters: RegisterFilters;
  onFiltersChange: (f: RegisterFilters) => void;
  onSelectRisk: (riskId: string) => void;
}) {
  const themeColors = useThemeColors();
  const levelColor: Record<RiskLevel, string> = { LOW: themeColors.ok, MODERATE: themeColors.warn, HIGH: themeColors.high, CRITICAL: themeColors.danger };
  const [sortField, setSortField] = useState<RegisterSortField>('score');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);

  const disciplinesPresent = useMemo(() => {
    const set = new Set(risks.map((r) => r.discipline ?? 'UNSPECIFIED'));
    return Array.from(set).sort((a, b) => RISK_DISCIPLINE_LABELS[a as keyof typeof RISK_DISCIPLINE_LABELS].localeCompare(RISK_DISCIPLINE_LABELS[b as keyof typeof RISK_DISCIPLINE_LABELS]));
  }, [risks]);

  const filtered = useMemo(() => sortRegister(applyRegisterFilters(risks, filters), sortField, sortDir), [risks, filters, sortField, sortDir]);

  useEffect(() => { setPage(1); }, [filters, sortField, sortDir]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageSafe = Math.min(page, totalPages);
  const pageRows = filtered.slice((pageSafe - 1) * PAGE_SIZE, pageSafe * PAGE_SIZE);

  function toggleSort(field: RegisterSortField) {
    if (field === sortField) setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'));
    else { setSortField(field); setSortDir('desc'); }
  }

  function set<K extends keyof RegisterFilters>(key: K, value: RegisterFilters[K]) {
    onFiltersChange({ ...filters, [key]: value });
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-baseline gap-2">
          <div className="field-label !mb-0">Risk Register</div>
          <span className="text-xs text-ink-500">{filtered.length} risk{filtered.length === 1 ? '' : 's'}</span>
        </div>
      </div>

      {filters.cellLabel && (
        <div className="flex items-center gap-2 text-xs">
          <span className="text-ink-500">Filtered from heatmap:</span>
          <span className="inline-flex items-center gap-2 px-2 py-0 rounded-full bg-blueprint/10 text-blueprint">
            {filters.cellLabel}
            <button onClick={() => onFiltersChange({ ...filters, cellRiskIds: null, cellLabel: null })} className="hover:text-ink-100" aria-label="Clear heatmap filter">×</button>
          </span>
        </div>
      )}

      <div className="panel p-4 flex items-center gap-2 flex-wrap">
        <input
          type="text" placeholder="Search title, category, location, action…" value={filters.search}
          onChange={(e) => set('search', e.target.value)}
          className="field-input w-56 text-xs !py-2"
        />
        <Listbox
          aria-label="Filter by severity"
          value={filters.levels[0] ?? ''}
          onChange={(e) => set('levels', e.target.value ? [e.target.value as RiskLevel] : [])}
          className="field-input w-auto text-xs !py-2"
        >
          <option value="">All severities</option>
          {(['CRITICAL', 'HIGH', 'MODERATE', 'LOW'] as RiskLevel[]).map((l) => <option key={l} value={l}>{LEVEL_LABELS[l]}</option>)}
        </Listbox>
        <Listbox
          aria-label="Filter by discipline"
          value={filters.discipline}
          onChange={(e) => set('discipline', e.target.value)}
          className="field-input w-auto text-xs !py-2"
        >
          <option value="">All disciplines</option>
          {disciplinesPresent.map((d) => <option key={d} value={d}>{disciplineLabel(d)}</option>)}
        </Listbox>
        <Listbox
          aria-label="Filter by status"
          value={filters.statuses[0] ?? ''}
          onChange={(e) => set('statuses', e.target.value ? [e.target.value as RiskStatus] : [])}
          className="field-input w-auto text-xs !py-2"
        >
          <option value="">All statuses</option>
          {(Object.keys(STATUS_LABELS) as RiskStatus[]).map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
        </Listbox>
        <Listbox
          aria-label="Filter by owner"
          value={filters.owner}
          onChange={(e) => set('owner', e.target.value)}
          className="field-input w-auto text-xs !py-2"
        >
          <option value="">All owners</option>
          <option value="UNASSIGNED">Unassigned</option>
          {members.map((m) => <option key={m.userId} value={m.userId}>{[m.firstName, m.lastName].filter(Boolean).join(' ') || m.email}</option>)}
        </Listbox>
        <label className="flex items-center gap-2 text-xs text-ink-300 cursor-pointer select-none">
          <input type="checkbox" checked={filters.overdueOnly} onChange={(e) => set('overdueOnly', e.target.checked)} />
          Overdue only
        </label>
        {hasActiveFilters(filters) && (
          <button onClick={() => onFiltersChange(DEFAULT_REGISTER_FILTERS)} className="btn-ghost !px-2 !py-2 text-xs ml-auto">
            Reset filters
          </button>
        )}
      </div>

      {/* Desktop/tablet: table */}
      <div className="panel tick-frame overflow-hidden hidden md:block">
        <div className="overflow-x-auto" tabIndex={0}>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-ink-500 border-b border-base-600">
                <th className="px-4 py-2 font-medium">ID</th>
                <th className="px-4 py-2 font-medium">Risk</th>
                <th className="px-4 py-2 font-medium">Discipline</th>
                <th className="px-4 py-2 font-medium text-right">Prob.</th>
                <th className="px-4 py-2 font-medium text-right">Impact</th>
                <SortableHeader label="Score" field="score" active={sortField} dir={sortDir} onClick={toggleSort} align="right" />
                <SortableHeader label="Severity" field="severity" active={sortField} dir={sortDir} onClick={toggleSort} />
                <th className="px-4 py-2 font-medium">Owner</th>
                <th className="px-4 py-2 font-medium">Next Action</th>
                <SortableHeader label="Due" field="dueDate" active={sortField} dir={sortDir} onClick={toggleSort} />
                <th className="px-4 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((r) => {
                const tone = dueDateTone(r);
                return (
                  <tr key={r.id} onClick={() => onSelectRisk(r.id)} className="border-b border-base-700/60 last:border-0 cursor-pointer hover:bg-base-700">
                    <td className="px-4 py-2 text-xs font-mono text-ink-500 whitespace-nowrap">{riskRef(r)}</td>
                    <td className="px-4 py-2 max-w-xs">
                      <div className="text-ink-100 truncate">{r.title}</div>
                      {r.locationLabel && <div className="text-xs text-ink-500 truncate">{r.locationLabel}</div>}
                    </td>
                    <td className="px-4 py-2 text-ink-300 whitespace-nowrap">{disciplineLabel(r.discipline)}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-ink-300">{r.probability}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-ink-300">{r.impact}</td>
                    <td className="px-4 py-2 text-right tabular-nums font-semibold text-ink-100">{r.score}</td>
                    <td className="px-4 py-2">
                      <span
                        className="inline-flex items-center gap-2 px-2 py-0 rounded text-xs font-semibold uppercase tracking-wide"
                        style={{ color: levelColor[r.level], backgroundColor: `${levelColor[r.level]}22` }}
                      >
                        {LEVEL_LABELS[r.level]}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-ink-300 whitespace-nowrap max-w-[9rem] truncate">{r.ownerId ? ownerNames.get(r.ownerId) ?? 'Unknown' : <span className="text-ink-500">Unassigned</span>}</td>
                    <td className="px-4 py-2 text-ink-500 max-w-[14rem] truncate">{r.recommendedAction ?? '—'}</td>
                    <td className={`px-4 py-2 whitespace-nowrap ${tone === 'overdue' ? 'text-danger font-medium' : tone === 'soon' ? 'text-warn' : 'text-ink-500'}`}>
                      {formatDueDate(r.dueDate)}
                    </td>
                    <td className="px-4 py-2 text-ink-500 whitespace-nowrap">{STATUS_LABELS[r.status]}</td>
                  </tr>
                );
              })}
              {pageRows.length === 0 && (
                <tr><td colSpan={11} className="px-4 py-10 text-center text-ink-500">No risks match the current filters.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Mobile: compact record cards, no horizontal squeeze */}
      <div className="md:hidden space-y-2">
        {pageRows.length === 0 && (
          <div className="panel tick-frame p-8 text-center text-sm text-ink-500">No risks match the current filters.</div>
        )}
        {pageRows.map((r) => {
          const tone = dueDateTone(r);
          return (
            <button key={r.id} onClick={() => onSelectRisk(r.id)} className="panel tick-frame w-full text-left p-4 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span
                  className="inline-flex items-center gap-2 px-2 py-0 rounded text-xs font-semibold uppercase tracking-wide shrink-0"
                  style={{ color: levelColor[r.level], backgroundColor: `${levelColor[r.level]}22` }}
                >
                  {LEVEL_LABELS[r.level]}
                </span>
                <span className="text-sm font-semibold tabular-nums text-ink-100 shrink-0">{r.score}</span>
              </div>
              <div className="text-sm text-ink-100 font-medium max-w-measure">{r.title}</div>
              <div className="text-xs text-ink-500">{disciplineLabel(r.discipline)}{r.locationLabel ? ` · ${r.locationLabel}` : ''}</div>
              <div className="flex items-center justify-between text-xs pt-2">
                <span className="text-ink-300 truncate">{r.ownerId ? ownerNames.get(r.ownerId) ?? 'Unknown' : 'Unassigned'}</span>
                <span className={tone === 'overdue' ? 'text-danger font-medium shrink-0' : tone === 'soon' ? 'text-warn shrink-0' : 'text-ink-500 shrink-0'}>
                  {formatDueDate(r.dueDate)}
                </span>
              </div>
            </button>
          );
        })}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-xs text-ink-500 px-2">
          <span>Page {pageSafe} of {totalPages}</span>
          <div className="flex items-center gap-2">
            <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={pageSafe === 1} className="btn-ghost !px-2 !py-2 text-xs disabled:opacity-40">
              Previous
            </button>
            <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={pageSafe === totalPages} className="btn-ghost !px-2 !py-2 text-xs disabled:opacity-40">
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function SortableHeader({ label, field, active, dir, onClick, align }: {
  label: string; field: RegisterSortField; active: RegisterSortField; dir: 'asc' | 'desc'; onClick: (f: RegisterSortField) => void; align?: 'right';
}) {
  const isActive = active === field;
  return (
    <th className={`px-4 py-2 font-medium ${align === 'right' ? 'text-right' : ''}`}>
      <button onClick={() => onClick(field)} className={`inline-flex items-center gap-2 hover:text-ink-100 transition-colors ${isActive ? 'text-ink-100' : ''}`}>
        {label}
        {isActive && <span className="text-xs">{dir === 'desc' ? '↓' : '↑'}</span>}
      </button>
    </th>
  );
}
