import type { TransmittalStatus, TransmittalPurpose } from '@engineeringos/types';

export const TRANSMITTAL_STATUSES: TransmittalStatus[] = ['draft', 'sent', 'acknowledged', 'void'];
export const TRANSMITTAL_PURPOSES: TransmittalPurpose[] = ['for_review', 'for_approval', 'for_record', 'for_construction', 'as_requested'];

export const TRANSMITTAL_STATUS_LABELS: Record<TransmittalStatus, string> = {
  draft: 'Draft',
  sent: 'Sent',
  acknowledged: 'Acknowledged',
  void: 'Void',
};

export const TRANSMITTAL_STATUS_BADGE_CLASS: Record<TransmittalStatus, string> = {
  draft: 'bg-base-600 text-ink-500',
  sent: 'bg-blueprint/15 text-blueprint',
  acknowledged: 'bg-ok/15 text-ok',
  void: 'bg-base-600 text-ink-500',
};

export const TRANSMITTAL_PURPOSE_LABELS: Record<TransmittalPurpose, string> = {
  for_review: 'For Review',
  for_approval: 'For Approval',
  for_record: 'For Record',
  for_construction: 'For Construction',
  as_requested: 'As Requested',
};

export function formatDate(iso?: string): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}
