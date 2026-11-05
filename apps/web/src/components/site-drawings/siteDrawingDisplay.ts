import type {
  SiteDrawingSourceProvider, SiteDrawingWorkflowStatus, SiteDrawingDocumentClassification, SiteDrawingExtractionStatus,
  SiteDrawingImportBatchStatus,
} from '../../lib/site-drawings.api';
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
// in this app; a drawing's workflow status is a status badge like any
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

// documentClassification defaults to 'CONSTRUCTION'; same backward-
// compatible default the API's own isConfirmedCurrent() uses, so a caller
// that hasn't been updated to pass it yet keeps its exact prior behavior.
export function isConfirmedCurrent(status: SiteDrawingWorkflowStatus, isSuperseded: boolean, documentClassification: SiteDrawingDocumentClassification = 'CONSTRUCTION'): boolean {
  return isValidForSiteUse(status) && !isSuperseded && documentClassification === 'CONSTRUCTION';
}

export const DOCUMENT_CLASSIFICATION_LABELS: Record<SiteDrawingDocumentClassification, string> = {
  CONSTRUCTION: 'Construction',
  FINAL: 'Final',
  AS_BUILT: 'As-Built',
};

export const EXTRACTION_STATUS_LABELS: Record<SiteDrawingExtractionStatus, string> = {
  CONFIRMED: 'Confirmed',
  NEEDS_REVIEW: 'Needs Review',
  CONFLICT: 'Conflict',
  MANUAL: 'Manual Entry',
};

export const EXTRACTION_STATUS_TONE: Record<SiteDrawingExtractionStatus, StatusTone> = {
  CONFIRMED: 'success',
  NEEDS_REVIEW: 'warning',
  CONFLICT: 'danger',
  MANUAL: 'neutral',
};

export const IMPORT_BATCH_STATUS_LABELS: Record<SiteDrawingImportBatchStatus, string> = {
  PENDING: 'Pending',
  PROCESSING: 'Processing',
  COMPLETED: 'Completed',
  PARTIAL: 'Completed with errors',
  FAILED: 'Failed',
};

export const IMPORT_BATCH_STATUS_TONE: Record<SiteDrawingImportBatchStatus, StatusTone> = {
  PENDING: 'neutral',
  PROCESSING: 'progress',
  COMPLETED: 'success',
  PARTIAL: 'warning',
  FAILED: 'danger',
};

export function isImportBatchInProgress(status: SiteDrawingImportBatchStatus): boolean {
  return status === 'PENDING' || status === 'PROCESSING';
}

export function needsApprovalWarning(status: SiteDrawingWorkflowStatus): boolean {
  return status === 'UNKNOWN' || status === 'UNDER_REVIEW';
}

export interface SiteDrawingOverlay {
  label: string;
  color: string; // a real hex/rgb value, not a Tailwind class -- drawn directly on a canvas 2D context, which can't read CSS classes
}

// A visual stamp composited on top of the rendered PDF page -- never
// written back to the uploaded file (SiteDrawingPdfViewer draws it fresh
// on every render; the original bytes in storage are never touched).
// Checked in order of severity/certainty, most definitive first: currency
// (superseded) and withdrawal/rejection outrank everything else, document
// classification (FINAL/AS_BUILT) is informational but still overrides a
// plain approval label, and only what's left maps to the brief's own
// GOOD FOR CONSTRUCTION / APPROVED — NOT FOR CONSTRUCTION / UNDER REVIEW /
// STATUS UNVERIFIED vocabulary.
export function siteDrawingOverlay(revision: {
  workflowStatus: SiteDrawingWorkflowStatus; isSuperseded: boolean; documentClassification: SiteDrawingDocumentClassification;
}): SiteDrawingOverlay {
  const { workflowStatus, isSuperseded, documentClassification } = revision;

  if (isSuperseded) return { label: 'SUPERSEDED — DO NOT USE FOR CONSTRUCTION', color: '#dc2626' };
  if (workflowStatus === 'WITHDRAWN') return { label: 'WITHDRAWN — DO NOT USE', color: '#dc2626' };
  if (workflowStatus === 'REJECTED') return { label: 'REJECTED — DO NOT USE', color: '#dc2626' };
  if (documentClassification === 'AS_BUILT') return { label: 'AS-BUILT', color: '#2563eb' };
  if (documentClassification === 'FINAL') return { label: 'FINAL', color: '#2563eb' };
  if (workflowStatus === 'APPROVED_FOR_CONSTRUCTION') return { label: 'GOOD FOR CONSTRUCTION', color: '#16a34a' };
  if (workflowStatus === 'APPROVED') return { label: 'APPROVED — NOT FOR CONSTRUCTION', color: '#d97706' };
  if (workflowStatus === 'UNDER_REVIEW') return { label: 'UNDER REVIEW', color: '#d97706' };
  return { label: 'STATUS UNVERIFIED', color: '#d97706' }; // UNKNOWN
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
