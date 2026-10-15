import type { QaqcPriority, QaqcStatus, QaqcRecordType } from './qaqc.api';
import { TONE_CLASS, PRIORITY_TONE, type StatusTone } from './status-tone';

export const QAQC_RECORD_TYPES: QaqcRecordType[] = ['ncr', 'sor', 'wir', 'mir'];

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
  pending_confirmation: 'Pending Confirmation',
  closed: 'Closed',
  reopened: 'Reopened',
};

export const QAQC_STATUS_TONE: Record<QaqcStatus, StatusTone> = {
  open: 'danger',
  pending_confirmation: 'progress',
  closed: 'neutral',
  reopened: 'warning',
};

export const QAQC_STATUS_BADGE_CLASS: Record<QaqcStatus, string> = Object.fromEntries(
  Object.entries(QAQC_STATUS_TONE).map(([status, tone]) => [status, TONE_CLASS[tone]]),
) as Record<QaqcStatus, string>;

export const QAQC_RECORD_TYPE_LABELS: Record<QaqcRecordType, string> = {
  ncr: 'Non-Conformance Report',
  sor: 'Site Observation Report',
  wir: 'Work Inspection Request',
  mir: 'Material Inspection Request',
};

export const QAQC_RECORD_TYPE_SHORT_LABELS: Record<QaqcRecordType, string> = {
  ncr: 'NCR',
  sor: 'SOR',
  wir: 'WIR',
  mir: 'MIR',
};

export function isQaqcOverdue(dueDate: string | undefined, status: QaqcStatus): boolean {
  if (!dueDate) return false;
  if (status === 'closed') return false;
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
// ISSUE_ROLES_BY_TYPE/RESPOND_ROLES_BY_TYPE/CONFIRM_ROLES in qaqc.service.ts/
// qaqc.controller.ts -- client-side visual-only gating for the create/
// respond/confirm actions. The server is the real enforcement; this only
// decides which buttons are worth showing.
//
// NCR/SOR and WIR/MIR swap issuer/responder roles -- a WIR/MIR *is* the
// construction team's own request for QAQC to inspect, so for those two
// types QAQC responds (performs the inspection) instead of issuing, and
// the construction team issues instead of responding. Confirm never
// swaps: QAQC-in-charge confirms every record type.
const QAQC_ROLE_SET = ['qa_qc_manager'] as const;
const CONSTRUCTION_ROLE_SET = ['construction_manager', 'project_manager', 'technical_director', 'engineering_manager'] as const;
const ADMIN_ROLE_SET = ['company_admin', 'super_admin'] as const;

export const QAQC_ISSUE_ROLES_BY_TYPE: Record<QaqcRecordType, readonly string[]> = {
  ncr: [...QAQC_ROLE_SET, ...ADMIN_ROLE_SET],
  sor: [...QAQC_ROLE_SET, ...ADMIN_ROLE_SET],
  wir: [...CONSTRUCTION_ROLE_SET, ...ADMIN_ROLE_SET],
  mir: [...CONSTRUCTION_ROLE_SET, ...ADMIN_ROLE_SET],
};
export const QAQC_RESPOND_ROLES_BY_TYPE: Record<QaqcRecordType, readonly string[]> = {
  ncr: [...CONSTRUCTION_ROLE_SET, ...ADMIN_ROLE_SET],
  sor: [...CONSTRUCTION_ROLE_SET, ...ADMIN_ROLE_SET],
  wir: [...QAQC_ROLE_SET, ...ADMIN_ROLE_SET],
  mir: [...QAQC_ROLE_SET, ...ADMIN_ROLE_SET],
};
// Never varies by type -- QAQC-in-charge confirms NCR/SOR and WIR/MIR alike.
export const QAQC_CONFIRM_ROLES = [...QAQC_ROLE_SET, ...ADMIN_ROLE_SET] as const;
