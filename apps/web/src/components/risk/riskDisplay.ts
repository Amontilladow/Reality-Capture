import type { ProjectMember } from '../../lib/projects.api';
import type { Risk, RiskLevel, RiskStatus } from '../../lib/risk.api';
import type { RiskDiscipline } from '@engineeringos/types';

// Lifted to RiskIntelligenceSection (the single source of truth) so the KPI
// strip, heatmap and discipline chart can all drive the register below them
// by calling one setter, per the brief's "KPI cards / heatmap cells /
// discipline bars filter the register" requirement -- never a second,
// disconnected copy of the risk list.
export interface RegisterFilters {
  levels: RiskLevel[]; // empty = all
  statuses: RiskStatus[]; // empty = all
  discipline: string; // '' = all
  owner: string; // '' = all, 'UNASSIGNED' = no owner, else a userId
  overdueOnly: boolean;
  activeOnly: boolean; // excludes RESOLVED/CLOSED
  // A heatmap cell click filters by the exact risk IDs the server already
  // placed in that cell (RiskService.getRiskHeatmap) -- never recomputed
  // client-side. That server-side placement bands the deterministic
  // probability/impact factor scores (0-100ish) into the 1-5 matrix scale
  // via scoring.toMatrixBand() for risks with no human assessment; matching
  // raw probability/impact numbers client-side would silently compare two
  // different scales (see levelColors()'s own comment on never mixing the
  // automated score and the Risk Matrix systems).
  cellRiskIds: string[] | null;
  cellLabel: string | null; // e.g. "Probability 4 × Impact 5", for the filter bar
  search: string;
}

export const DEFAULT_REGISTER_FILTERS: RegisterFilters = {
  levels: [], statuses: [], discipline: '', owner: '', overdueOnly: false, activeOnly: false,
  cellRiskIds: null, cellLabel: null, search: '',
};

export function hasActiveFilters(f: RegisterFilters): boolean {
  return f.levels.length > 0 || f.statuses.length > 0 || Boolean(f.discipline) || Boolean(f.owner)
    || f.overdueOnly || f.activeOnly || f.cellRiskIds !== null || Boolean(f.search);
}

// Mirrors RiskService.isOpenStatus() server-side exactly (risk.service.ts) --
// never invent a different definition of "open" than the one the summary
// KPIs/overdueCount already use.
export function isOpenRiskStatus(status: RiskStatus): boolean {
  return status !== 'RESOLVED' && status !== 'CLOSED';
}

export function isOverdue(risk: Risk): boolean {
  return isOpenRiskStatus(risk.status) && Boolean(risk.dueDate) && new Date(risk.dueDate!).getTime() < Date.now();
}

export function ownerNameMap(members: ProjectMember[]): Map<string, string> {
  return new Map(
    members.map((m) => [m.userId, [m.firstName, m.lastName].filter(Boolean).join(' ') || m.email || 'Unknown']),
  );
}

export function dueDateTone(risk: Risk): 'overdue' | 'soon' | 'normal' | 'none' {
  if (!risk.dueDate || !isOpenRiskStatus(risk.status)) return 'none';
  const ms = new Date(risk.dueDate).getTime() - Date.now();
  if (ms < 0) return 'overdue';
  if (ms < 3 * 86400000) return 'soon';
  return 'normal';
}

export function formatDueDate(dueDate?: string): string {
  if (!dueDate) return '—';
  return new Date(dueDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

// Short, stable display reference -- purely a truncation of the real `id`
// field for a compact column/label, not an invented identifier; the full
// id is still what every click/link/mutation uses.
export function riskRef(risk: Risk): string {
  return `R-${risk.id.slice(0, 6).toUpperCase()}`;
}

// Discipline values are an UPPER_SNAKE enum (RiskDiscipline, plus the
// server's own 'UNSPECIFIED' literal for a null discipline -- see
// RiskService.getRiskByDiscipline's own comment) -- never shown raw.
export const RISK_DISCIPLINE_LABELS: Record<RiskDiscipline | 'UNSPECIFIED', string> = {
  CIVIL: 'Civil', STRUCTURAL: 'Structural', ARCHITECTURAL: 'Architectural', INTERIOR_DESIGN: 'Interior Design',
  MECHANICAL: 'Mechanical', ELECTRICAL: 'Electrical', PLUMBING: 'Plumbing', HVAC: 'HVAC', MEP: 'MEP',
  INFRA: 'Infrastructure', ELV: 'ELV', AV: 'AV', LANDSCAPE: 'Landscape', GENERAL: 'General', OTHER: 'Other',
  UNSPECIFIED: 'Unspecified',
};

export function disciplineLabel(discipline?: string): string {
  return RISK_DISCIPLINE_LABELS[discipline as keyof typeof RISK_DISCIPLINE_LABELS] ?? discipline ?? 'Unspecified';
}

// Priority ordering for the "Requires Attention" panel (brief section 4C):
// overdue critical/high first, then unassigned critical/high, then any
// other open critical/high, then everything else by score. A pure sort
// comparator over already-fetched register data -- no new query, no
// invented urgency score.
export function applyRegisterFilters(risks: Risk[], f: RegisterFilters): Risk[] {
  return risks.filter((r) => {
    if (f.levels.length > 0 && !f.levels.includes(r.level)) return false;
    if (f.statuses.length > 0 && !f.statuses.includes(r.status)) return false;
    if (f.activeOnly && !isOpenRiskStatus(r.status)) return false;
    if (f.discipline && (r.discipline ?? 'UNSPECIFIED') !== f.discipline) return false;
    if (f.owner === 'UNASSIGNED' && r.ownerId) return false;
    if (f.owner && f.owner !== 'UNASSIGNED' && r.ownerId !== f.owner) return false;
    if (f.overdueOnly && !isOverdue(r)) return false;
    if (f.cellRiskIds !== null && !f.cellRiskIds.includes(r.id)) return false;
    if (f.search) {
      const needle = f.search.toLowerCase();
      const haystack = `${r.title} ${r.category} ${r.locationLabel ?? ''} ${r.recommendedAction ?? ''}`.toLowerCase();
      if (!haystack.includes(needle)) return false;
    }
    return true;
  });
}

export type RegisterSortField = 'score' | 'severity' | 'dueDate' | 'updated';
const LEVEL_RANK: Record<RiskLevel, number> = { CRITICAL: 3, HIGH: 2, MODERATE: 1, LOW: 0 };

export function sortRegister(risks: Risk[], field: RegisterSortField, dir: 'asc' | 'desc'): Risk[] {
  const sign = dir === 'asc' ? 1 : -1;
  return [...risks].sort((a, b) => {
    switch (field) {
      case 'score': return sign * (a.score - b.score);
      case 'severity': return sign * (LEVEL_RANK[a.level] - LEVEL_RANK[b.level]);
      case 'dueDate': {
        const av = a.dueDate ? new Date(a.dueDate).getTime() : Infinity;
        const bv = b.dueDate ? new Date(b.dueDate).getTime() : Infinity;
        return sign * (av - bv);
      }
      case 'updated':
      default:
        return sign * (new Date(a.lastCalculatedAt).getTime() - new Date(b.lastCalculatedAt).getTime());
    }
  });
}

export function attentionRank(r: Risk): number {
  const overdue = isOverdue(r);
  const severe = r.level === 'CRITICAL' || r.level === 'HIGH';
  const unassigned = !r.ownerId;
  if (overdue && severe) return 0;
  if (overdue) return 1;
  if (severe && unassigned) return 2;
  if (severe) return 3;
  if (unassigned) return 4;
  return 5;
}
