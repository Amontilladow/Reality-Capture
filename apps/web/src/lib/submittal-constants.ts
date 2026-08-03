import type { SubmittalStatus, SubmittalPriority } from '@engineeringos/types';

export const SUBMITTAL_STATUSES: SubmittalStatus[] = [
  'submitted', 'under_review', 'approved', 'approved_as_noted', 'revise_and_resubmit', 'rejected', 'void',
];
export const SUBMITTAL_PRIORITIES: SubmittalPriority[] = ['critical', 'high', 'medium', 'low'];

export const SUBMITTAL_STATUS_LABELS: Record<SubmittalStatus, string> = {
  submitted: 'Submitted',
  under_review: 'Under Review',
  approved: 'Approved',
  approved_as_noted: 'Approved as Noted',
  revise_and_resubmit: 'Revise & Resubmit',
  rejected: 'Rejected',
  void: 'Void',
};

export const SUBMITTAL_STATUS_BADGE_CLASS: Record<SubmittalStatus, string> = {
  submitted: 'bg-blueprint/15 text-blueprint',
  under_review: 'bg-warn/15 text-warn',
  approved: 'bg-ok/15 text-ok',
  approved_as_noted: 'bg-ok/15 text-ok',
  revise_and_resubmit: 'bg-danger/10 text-danger',
  rejected: 'bg-danger/20 text-danger',
  void: 'bg-base-600 text-ink-500',
};

export const SUBMITTAL_PRIORITY_LABELS: Record<SubmittalPriority, string> = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};

export const SUBMITTAL_PRIORITY_BADGE_CLASS: Record<SubmittalPriority, string> = {
  critical: 'bg-danger/20 text-danger',
  high: 'bg-danger/10 text-danger',
  medium: 'bg-warn/15 text-warn',
  low: 'bg-base-600 text-ink-500',
};

// Review outcomes a reviewer can pick from the detail view. Not every
// status (e.g. 'submitted', 'void') is a hand-picked review action.
export const REVIEW_OUTCOMES: SubmittalStatus[] = ['approved', 'approved_as_noted', 'revise_and_resubmit', 'rejected'];

export function isSubmittalOverdue(dueDate: string | undefined, status: SubmittalStatus): boolean {
  if (!dueDate) return false;
  if (!['submitted', 'under_review'].includes(status)) return false;
  return new Date(dueDate).getTime() < Date.now();
}

export function formatDate(iso?: string): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}
