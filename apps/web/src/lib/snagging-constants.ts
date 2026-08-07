import type { SnagStatus, SnagPriority } from '@engineeringos/types';

export const SNAG_STATUSES: SnagStatus[] = ['open', 'fixed', 'verified', 'void'];
export const SNAG_PRIORITIES: SnagPriority[] = ['critical', 'high', 'medium', 'low'];

export const SNAG_STATUS_LABELS: Record<SnagStatus, string> = {
  open: 'Open',
  fixed: 'Fixed',
  verified: 'Verified',
  void: 'Void',
};

export const SNAG_STATUS_BADGE_CLASS: Record<SnagStatus, string> = {
  open: 'bg-danger/10 text-danger',
  fixed: 'bg-warn/15 text-warn',
  verified: 'bg-ok/15 text-ok',
  void: 'bg-base-600 text-ink-500',
};

export const SNAG_PRIORITY_LABELS: Record<SnagPriority, string> = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};

export const SNAG_PRIORITY_BADGE_CLASS: Record<SnagPriority, string> = {
  critical: 'bg-danger/20 text-danger',
  high: 'bg-danger/10 text-danger',
  medium: 'bg-warn/15 text-warn',
  low: 'bg-base-600 text-ink-500',
};

export function isSnagOverdue(dueDate: string | undefined, status: SnagStatus): boolean {
  if (!dueDate) return false;
  if (!['open', 'fixed'].includes(status)) return false;
  return new Date(dueDate).getTime() < Date.now();
}

export function formatDate(iso?: string): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}
