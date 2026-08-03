import type { RfiStatus, RfiPriority } from '@engineeringos/types';

export const RFI_STATUSES: RfiStatus[] = ['open', 'answered', 'closed', 'void'];
export const RFI_PRIORITIES: RfiPriority[] = ['critical', 'high', 'medium', 'low'];

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

export function isRfiOverdue(dueDate: string | undefined, status: RfiStatus): boolean {
  if (!dueDate) return false;
  if (status === 'closed' || status === 'void' || status === 'answered') return false;
  return new Date(dueDate).getTime() < Date.now();
}

export function formatDate(iso?: string): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}
