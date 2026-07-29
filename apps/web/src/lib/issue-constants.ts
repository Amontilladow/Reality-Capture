import type { IssueStatus, IssuePriority, IssueType } from '@engineeringos/types';

export const ISSUE_STATUSES: IssueStatus[] = ['open', 'assigned', 'in_progress', 'under_review', 'resolved', 'closed', 'void'];
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
  resolved: 'Resolved',
  closed: 'Closed',
  void: 'Void',
};

export const STATUS_BADGE_CLASS: Record<IssueStatus, string> = {
  open: 'bg-blueprint/15 text-blueprint',
  assigned: 'bg-warn/15 text-warn',
  in_progress: 'bg-warn/15 text-warn',
  under_review: 'bg-warn/15 text-warn',
  resolved: 'bg-ok/15 text-ok',
  closed: 'bg-base-600 text-ink-500',
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

// Statuses a user can hand-pick from a "move to next stage" perspective —
// void is an admin/system state, not something surfaced as a normal action.
export const ISSUE_STATUS_FLOW: IssueStatus[] = ['open', 'under_review', 'assigned', 'in_progress', 'resolved', 'closed'];

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
