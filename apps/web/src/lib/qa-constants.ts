import type { QaInspectionStatus } from '@engineeringos/types';

export const QA_STATUSES: QaInspectionStatus[] = [
  'scheduled', 'in_progress', 'passed', 'passed_with_exceptions', 'failed', 'void',
];

export const QA_STATUS_LABELS: Record<QaInspectionStatus, string> = {
  scheduled: 'Scheduled',
  in_progress: 'In Progress',
  passed: 'Passed',
  passed_with_exceptions: 'Passed with Exceptions',
  failed: 'Failed',
  void: 'Void',
};

export const QA_STATUS_BADGE_CLASS: Record<QaInspectionStatus, string> = {
  scheduled: 'bg-base-600 text-ink-500',
  in_progress: 'bg-blueprint/15 text-blueprint',
  passed: 'bg-ok/15 text-ok',
  passed_with_exceptions: 'bg-warn/15 text-warn',
  failed: 'bg-danger/20 text-danger',
  void: 'bg-base-600 text-ink-500',
};

// Outcomes an inspector can record to close out an inspection. Not every
// status (e.g. 'scheduled', 'void') is a hand-picked outcome.
export const QA_OUTCOMES: QaInspectionStatus[] = ['passed', 'passed_with_exceptions', 'failed'];

export function formatDate(iso?: string): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}
