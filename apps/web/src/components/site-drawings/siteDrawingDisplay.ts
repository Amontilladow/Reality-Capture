import type { SiteDrawingSourceProvider, SiteDrawingWorkflowStatus } from '../../lib/site-drawings.api';
import { VALID_FOR_SITE_USE_STATUSES } from '../../lib/site-drawings.api';
import type { StatusTone } from '../../lib/status-tone';

export const WORKFLOW_STATUS_LABELS: Record<SiteDrawingWorkflowStatus, string> = {
  UNDER_REVIEW: 'Under Review',
  APPROVED: 'Approved',
  APPROVED_FOR_CONSTRUCTION: 'Approved for Construction',
  REJECTED: 'Rejected',
  SUPERSEDED: 'Superseded',
  WITHDRAWN: 'Withdrawn',
  UNKNOWN: 'Status Unknown',
};

// One shared tone vocabulary (status-tone.ts), same as every other module
// in this app -- a drawing's workflow status is a status badge like any
// other, not a bespoke color scheme.
export const WORKFLOW_STATUS_TONE: Record<SiteDrawingWorkflowStatus, StatusTone> = {
  UNDER_REVIEW: 'progress',
  APPROVED: 'success',
  APPROVED_FOR_CONSTRUCTION: 'success',
  REJECTED: 'danger',
  SUPERSEDED: 'neutral',
  WITHDRAWN: 'neutral',
  UNKNOWN: 'warning',
};

export function isValidForSiteUse(status: SiteDrawingWorkflowStatus): boolean {
  return (VALID_FOR_SITE_USE_STATUSES as readonly SiteDrawingWorkflowStatus[]).includes(status);
}

export function isConfirmedCurrent(status: SiteDrawingWorkflowStatus, isSuperseded: boolean): boolean {
  return isValidForSiteUse(status) && !isSuperseded;
}

export function needsApprovalWarning(status: SiteDrawingWorkflowStatus): boolean {
  return status === 'UNKNOWN' || status === 'UNDER_REVIEW';
}

export const SOURCE_PROVIDER_LABELS: Record<SiteDrawingSourceProvider, string> = {
  internal: 'Local',
  manual_link: 'Manual Link',
  sharepoint: 'SharePoint',
  aconex: 'Aconex',
  procore: 'Procore',
  bim360: 'BIM 360',
};

export function sourceProviderLabel(provider: SiteDrawingSourceProvider): string {
  return SOURCE_PROVIDER_LABELS[provider] ?? provider;
}

export function formatVerifiedAt(iso?: string): string {
  if (!iso) return 'Never verified';
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return 'Verified just now';
  if (mins < 60) return `Verified ${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `Verified ${hrs}h ago`;
  return `Verified ${Math.floor(hrs / 24)}d ago`;
}

export function formatDate(iso?: string): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function formatFileSize(bytes?: number): string {
  if (!bytes) return '—';
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
