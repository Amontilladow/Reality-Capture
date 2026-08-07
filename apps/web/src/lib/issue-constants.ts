import type { IssueStatus, IssuePriority, IssueType, IssueDiscipline, IssueCategory, CompanyRole } from '@engineeringos/types';

export const ISSUE_STATUSES: IssueStatus[] = [
  'open', 'assigned', 'in_progress', 'under_review', 'waiting_for_information',
  'resolved', 'closed', 'reopened', 'void',
];
export const ISSUE_PRIORITIES: IssuePriority[] = ['critical', 'high', 'medium', 'low'];
export const ISSUE_TYPES: IssueType[] = [
  'defect', 'punch_item', 'rfi', 'coordination_clash',
  'safety_observation', 'quality_hold', 'inspection_point', 'general',
];

export const STATUS_LABELS: Record<IssueStatus, string> = {
  open: 'Open',
  assigned: 'Assigned',
  in_progress: 'In Progress',
  under_review: 'Under Review',
  waiting_for_information: 'Waiting for Information',
  resolved: 'Resolved',
  closed: 'Closed',
  reopened: 'Reopened',
  void: 'Void',
};

export const STATUS_BADGE_CLASS: Record<IssueStatus, string> = {
  open: 'bg-blueprint/15 text-blueprint',
  assigned: 'bg-warn/15 text-warn',
  in_progress: 'bg-warn/15 text-warn',
  under_review: 'bg-warn/15 text-warn',
  waiting_for_information: 'bg-warn/15 text-warn',
  resolved: 'bg-ok/15 text-ok',
  closed: 'bg-base-600 text-ink-500',
  reopened: 'bg-danger/15 text-danger',
  void: 'bg-base-600 text-ink-500',
};

export const PRIORITY_LABELS: Record<IssuePriority, string> = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};

export const PRIORITY_BADGE_CLASS: Record<IssuePriority, string> = {
  critical: 'bg-danger/20 text-danger',
  high: 'bg-danger/10 text-danger',
  medium: 'bg-warn/15 text-warn',
  low: 'bg-base-600 text-ink-500',
};

export const ISSUE_TYPE_LABELS: Record<IssueType, string> = {
  defect: 'Defect',
  punch_item: 'Punch Item',
  rfi: 'RFI',
  coordination_clash: 'Coordination Clash',
  safety_observation: 'Safety Observation',
  quality_hold: 'Quality Hold',
  inspection_point: 'Inspection Point',
  general: 'General',
};

// ── Discipline (issue_discipline_enum, migration 021) ──────────────────────
export const ISSUE_DISCIPLINES: IssueDiscipline[] = ['MEP', 'ARC', 'STR', 'CIV', 'ELE', 'INFRA', 'LANDSCAPE', 'OTHER'];

export const DISCIPLINE_LABELS: Record<IssueDiscipline, string> = {
  MEP: 'MEP',
  ARC: 'Architectural',
  STR: 'Structural',
  CIV: 'Civil',
  ELE: 'Electrical',
  INFRA: 'Infrastructure',
  LANDSCAPE: 'Landscape',
  OTHER: 'Other',
};

// ── Category (issue_category_enum, migration 021) — distinct axis from
// IssueType above; both fields coexist on an issue. ───────────────────────
export const ISSUE_CATEGORIES: IssueCategory[] = [
  'design_issue', 'bim_modeling_issue', 'coordination_issue', 'clash_detection',
  'constructability_issue', 'shop_drawing_issue', 'site_issue', 'rfi',
  'client_comment', 'consultant_comment', 'other',
];

export const CATEGORY_LABELS: Record<IssueCategory, string> = {
  design_issue: 'Design Issue',
  bim_modeling_issue: 'BIM Modeling Issue',
  coordination_issue: 'Coordination Issue',
  clash_detection: 'Clash Detection',
  constructability_issue: 'Constructability Issue',
  shop_drawing_issue: 'Shop Drawing Issue',
  site_issue: 'Site Issue',
  rfi: 'RFI',
  client_comment: 'Client Comment',
  consultant_comment: 'Consultant Comment',
  other: 'Other',
};

// Statuses a user can hand-pick from a "move to next stage" perspective —
// void is an admin/system state, not something surfaced as a normal action.
// Mirrors the reference tracker's linear progression; 'reopened' is
// deliberately excluded (it's a distinct terminal-ish state shown as its
// own badge, not a stepper stage — see IssueDetail.tsx).
export const ISSUE_STATUS_FLOW: IssueStatus[] = [
  'open', 'under_review', 'assigned', 'in_progress', 'waiting_for_information', 'resolved', 'closed',
];

// Roles allowed to use the manager-only issue-tracker actions (dashboard,
// reminders, force-status) — mirrors the backend's
// @Roles('company_admin', 'engineering_manager') gate on those same
// endpoints (issues.controller.ts).
export const ISSUE_MANAGER_ROLES: CompanyRole[] = ['company_admin', 'engineering_manager'];

export function isIssueManager(role: CompanyRole | undefined): boolean {
  return Boolean(role && ISSUE_MANAGER_ROLES.includes(role));
}

export function isOverdue(deadline: string | undefined, status: IssueStatus): boolean {
  if (!deadline) return false;
  if (status === 'closed' || status === 'void') return false;
  return new Date(deadline).getTime() < Date.now();
}

export function formatDeadline(deadline?: string): string {
  if (!deadline) return '—';
  return new Date(deadline).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function formatDateTime(iso?: string): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

// ── Deadline "timer" state ──────────────────────────────────────────────
// Reference tracker's states: ok (>2 days left), warn (<=2 days left or
// same-day), overdue (past deadline), closed (issue no longer active).
// Pure function of (deadline, status) so it's trivially unit-testable and
// reusable between the list row and the detail-view badge.
export type DeadlineTimerState = 'ok' | 'warn' | 'overdue' | 'closed';

export interface DeadlineTimer {
  state: DeadlineTimerState;
  label: string;
}

export const TIMER_BADGE_CLASS: Record<DeadlineTimerState, string> = {
  ok: 'bg-ok/15 text-ok',
  warn: 'bg-warn/15 text-warn',
  overdue: 'bg-danger/20 text-danger',
  closed: 'bg-base-600 text-ink-500',
};

export function getDeadlineTimer(deadline: string | undefined, status: IssueStatus): DeadlineTimer {
  if (status === 'closed' || status === 'void') {
    return { state: 'closed', label: 'Closed' };
  }
  if (!deadline) {
    return { state: 'ok', label: 'No deadline' };
  }

  const diffMs = new Date(deadline).getTime() - Date.now();
  const diffHoursAbs = Math.abs(diffMs) / (1000 * 60 * 60);
  const days = Math.floor(diffHoursAbs / 24);
  const hours = Math.floor(diffHoursAbs % 24);

  if (diffMs < 0) {
    const label = days > 0 ? `Overdue ${days}d` : `Overdue ${Math.max(hours, 1)}h`;
    return { state: 'overdue', label };
  }

  // warn: <=2 days (48h) left, including same-day
  if (diffHoursAbs <= 48) {
    const label = days > 0 ? `${days}d ${hours}h` : `${Math.max(hours, 1)}h left`;
    return { state: 'warn', label };
  }

  return { state: 'ok', label: `${days}d ${hours}h` };
}
