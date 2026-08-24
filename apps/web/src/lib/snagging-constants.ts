import type { SnagStatus, SnagPriority, CompanyRole } from '@engineeringos/types';

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

export function formatDateTime(iso?: string): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

// Roles allowed to use the manager-only snagging actions (force-status) —
// mirrors issue-constants.ts's ISSUE_MANAGER_ROLES/isIssueManager, same two
// roles gated server-side on the equivalent endpoint.
export const SNAG_MANAGER_ROLES: CompanyRole[] = ['company_admin', 'engineering_manager'];

export function isSnagManager(role: CompanyRole | undefined): boolean {
  return Boolean(role && SNAG_MANAGER_ROLES.includes(role));
}

// ── Deadline "timer" state ──────────────────────────────────────────────
// Duplicated (rather than imported from issue-constants.ts) to match this
// file's existing convention of keeping snag-item enums/labels self-
// contained rather than cross-importing from the issues feature.
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

// "Closed" state for snags = verified (true done) or void (discarded) — the
// two terminal statuses. open/fixed are still active, matching
// isSnagOverdue()'s existing ['open','fixed'] logic above.
export function getSnagDeadlineTimer(dueDate: string | undefined, status: SnagStatus): DeadlineTimer {
  if (status === 'verified' || status === 'void') {
    return { state: 'closed', label: 'Closed' };
  }
  if (!dueDate) {
    return { state: 'ok', label: 'No due date' };
  }

  const diffMs = new Date(dueDate).getTime() - Date.now();
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
