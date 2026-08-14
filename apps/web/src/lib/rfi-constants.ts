import type { RfiStatus, RfiPriority, RfiWorkflowStatus } from '@engineeringos/types';

export const RFI_STATUSES: RfiStatus[] = ['open', 'answered', 'closed', 'void'];
export const RFI_PRIORITIES: RfiPriority[] = ['critical', 'high', 'medium', 'low'];

// Legacy-only label/badge maps -- kept exactly as they were (RfisPage's status
// filter dropdown and any other legacy-only consumer still key off these).
export const RFI_STATUS_LABELS: Record<RfiStatus, string> = {
  open: 'Open',
  answered: 'Answered',
  closed: 'Closed',
  void: 'Void',
};

export const RFI_STATUS_BADGE_CLASS: Record<RfiStatus, string> = {
  open: 'bg-blueprint/15 text-blueprint',
  answered: 'bg-ok/15 text-ok',
  closed: 'bg-base-600 text-ink-500',
  void: 'bg-base-600 text-ink-500',
};

// Full workflow vocabulary (Phase 3, additive) -- superset of the legacy maps
// above, used by RfiDetailPage, which renders both legacy RFIs (status
// 'open'/'answered') and RFIs that have moved through the new state machine
// ('draft'/'submitted'/'under_review'/'awaiting_clarification'/'responded'/
// 'rejected'/'cancelled') with one consistent badge lookup.
export const RFI_WORKFLOW_STATUS_LABELS: Record<RfiWorkflowStatus, string> = {
  draft: 'Draft',
  open: 'Open',
  submitted: 'Submitted',
  under_review: 'Under Review',
  awaiting_clarification: 'Awaiting Clarification',
  responded: 'Responded',
  answered: 'Answered',
  closed: 'Closed',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
  void: 'Void',
};

export const RFI_WORKFLOW_STATUS_BADGE_CLASS: Record<RfiWorkflowStatus, string> = {
  draft: 'bg-base-600 text-ink-300',
  open: 'bg-blueprint/15 text-blueprint',
  submitted: 'bg-blueprint/15 text-blueprint',
  under_review: 'bg-warn/15 text-warn',
  awaiting_clarification: 'bg-warn/15 text-warn',
  responded: 'bg-ok/15 text-ok',
  answered: 'bg-ok/15 text-ok',
  closed: 'bg-base-600 text-ink-500',
  rejected: 'bg-danger/15 text-danger',
  cancelled: 'bg-base-600 text-ink-500',
  void: 'bg-base-600 text-ink-500',
};

export const RFI_PRIORITY_LABELS: Record<RfiPriority, string> = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};

export const RFI_PRIORITY_BADGE_CLASS: Record<RfiPriority, string> = {
  critical: 'bg-danger/20 text-danger',
  high: 'bg-danger/10 text-danger',
  medium: 'bg-warn/15 text-warn',
  low: 'bg-base-600 text-ink-500',
};

// Widened to RfiWorkflowStatus -- Rfi.status carries the full workflow
// vocabulary now (see rfi.types.ts), and every terminal/answered-equivalent
// value (legacy or new) should stop counting as overdue the same way.
export function isRfiOverdue(dueDate: string | undefined, status: RfiWorkflowStatus): boolean {
  if (!dueDate) return false;
  const nonOverdueStatuses: RfiWorkflowStatus[] = ['closed', 'void', 'answered', 'responded', 'rejected', 'cancelled'];
  if (nonOverdueStatuses.includes(status)) return false;
  return new Date(dueDate).getTime() < Date.now();
}

export function formatDate(iso?: string): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}
