import type { SiteDrawingWorkflowStatus, SiteDrawingDocumentClassification } from '@engineeringos/types';
import { VALID_FOR_SITE_USE_STATUSES } from '@engineeringos/types';

// The one place "is this drawing safe to build from" is decided (brief
// section 5). Every caller — the register's badge, the PDF viewer's
// warning banner, the offline-download eligibility check — goes through
// this function rather than comparing against the status list itself, so
// the rule can never drift between call sites.
export function isValidForSiteUse(status: SiteDrawingWorkflowStatus): boolean {
  return (VALID_FOR_SITE_USE_STATUSES as readonly SiteDrawingWorkflowStatus[]).includes(status);
}

// A revision is safe to represent as "confirmed current for construction"
// only when it is valid-for-site-use, not itself superseded by a later
// revision, AND not a FINAL/AS_BUILT document (the brief's own Decision 2:
// "a final document can be approved but should not automatically be
// treated as the current drawing authorized for construction" -- document
// classification is a separate axis from approval status, see
// SiteDrawingDocumentClassification's own comment in site-drawing.types.ts).
// documentClassification defaults to 'CONSTRUCTION' so every existing call
// site written before migration 075 keeps its exact prior behavior.
export function isConfirmedCurrent(
  status: SiteDrawingWorkflowStatus,
  isSuperseded: boolean,
  documentClassification: SiteDrawingDocumentClassification = 'CONSTRUCTION',
): boolean {
  return isValidForSiteUse(status) && !isSuperseded && documentClassification === 'CONSTRUCTION';
}

// The explicit warning condition (section 5: "If the approval status is
// missing, conflicting, stale, or cannot be verified, show an explicit
// warning"). 'UNKNOWN' means the source's status could not be mapped;
// 'UNDER_REVIEW' is a real, common, non-error state but still not safe to
// build from, so it also warrants the same visible warning treatment.
export function needsApprovalWarning(status: SiteDrawingWorkflowStatus): boolean {
  return status === 'UNKNOWN' || status === 'UNDER_REVIEW';
}

const WORKFLOW_STATUS_LABELS: Record<SiteDrawingWorkflowStatus, string> = {
  UNDER_REVIEW: 'Under Review',
  APPROVED: 'Approved',
  APPROVED_FOR_CONSTRUCTION: 'Approved for Construction',
  REJECTED: 'Rejected',
  SUPERSEDED: 'Superseded',
  WITHDRAWN: 'Withdrawn',
  UNKNOWN: 'Status Unknown',
};

export function workflowStatusLabel(status: SiteDrawingWorkflowStatus): string {
  return WORKFLOW_STATUS_LABELS[status];
}

const DOCUMENT_CLASSIFICATION_LABELS: Record<SiteDrawingDocumentClassification, string> = {
  CONSTRUCTION: 'Construction',
  FINAL: 'Final',
  AS_BUILT: 'As-Built',
};

export function documentClassificationLabel(classification: SiteDrawingDocumentClassification): string {
  return DOCUMENT_CLASSIFICATION_LABELS[classification];
}

// A conservative best-effort mapping from a free-text source status to the
// system's own canonical set, used only as a fallback when a provider
// adapter doesn't supply its own explicit mapping. Deliberately narrow:
// anything it doesn't recognize maps to 'UNKNOWN' rather than guessing,
// per section 5's "do not infer approval status" rule — an unrecognized
// string is exactly the case that must surface a warning, not a guess.
const FALLBACK_STATUS_PATTERNS: [RegExp, SiteDrawingWorkflowStatus][] = [
  [/approved.*construction|issued.*construction|\bifc\b/i, 'APPROVED_FOR_CONSTRUCTION'],
  [/^approved$|approved.*no.*comment/i, 'APPROVED'],
  [/under review|pending|in review|awaiting/i, 'UNDER_REVIEW'],
  [/reject|not approved|returned/i, 'REJECTED'],
  [/supersede/i, 'SUPERSEDED'],
  [/withdraw|void|cancel/i, 'WITHDRAWN'],
];

export function fallbackMapSourceStatus(rawStatus: string | null | undefined): SiteDrawingWorkflowStatus {
  if (!rawStatus) return 'UNKNOWN';
  for (const [pattern, status] of FALLBACK_STATUS_PATTERNS) {
    if (pattern.test(rawStatus)) return status;
  }
  return 'UNKNOWN';
}
