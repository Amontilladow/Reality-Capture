import type { QaqcPriority, QaqcStatus, QaqcRecordType } from './qaqc.api';
import { TONE_CLASS, PRIORITY_TONE, type StatusTone } from './status-tone';

export const QAQC_PRIORITIES: QaqcPriority[] = ['critical', 'high', 'medium', 'low'];

export const QAQC_PRIORITY_LABELS: Record<QaqcPriority, string> = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};

export const QAQC_PRIORITY_TONE: Record<QaqcPriority, StatusTone> = PRIORITY_TONE;

export const QAQC_STATUS_LABELS: Record<QaqcStatus, string> = {
  open: 'Open',
  responded: 'Responded',
  closed: 'Closed',
  void: 'Void',
};

export const QAQC_STATUS_TONE: Record<QaqcStatus, StatusTone> = {
  open: 'danger',
  responded: 'progress',
  closed: 'neutral',
  void: 'neutral',
};

export const QAQC_STATUS_BADGE_CLASS: Record<QaqcStatus, string> = Object.fromEntries(
  Object.entries(QAQC_STATUS_TONE).map(([status, tone]) => [status, TONE_CLASS[tone]]),
) as Record<QaqcStatus, string>;

export const QAQC_RECORD_TYPE_LABELS: Record<QaqcRecordType, string> = {
  ncr: 'Non-Conformance Report',
  sor: 'Site Observation Report',
};

export const QAQC_RECORD_TYPE_SHORT_LABELS: Record<QaqcRecordType, string> = {
  ncr: 'NCR',
  sor: 'SOR',
};

export function isQaqcOverdue(dueDate: string | undefined, status: QaqcStatus): boolean {
  if (!dueDate) return false;
  if (status === 'closed' || status === 'void') return false;
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

// Role-list (membership, not weight) constants mirroring the backend's own
// ISSUE_ROLES/CLOSE_ROLES in qaqc.controller.ts -- client-side visual-only
// gating for the create/close actions. The server's @RequireExactRoles is
// the real enforcement; this only decides which buttons are worth showing.
export const QAQC_ISSUE_ROLES = ['qa_qc_manager', 'company_admin', 'super_admin'] as const;
export const QAQC_CLOSE_ROLES = ['construction_manager', 'technical_director', 'qa_qc_manager', 'company_admin', 'super_admin'] as const;
