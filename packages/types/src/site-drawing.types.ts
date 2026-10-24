import type { DocSource } from './document.types';

// Reuses DocSource ('internal'|'procore'|'aconex'|'sharepoint'|'bim360'|
// 'manual_link') rather than inventing a parallel provider enum -- see
// migration 072's own header comment. 'internal' is the only provider this
// phase actually implements (SiteDrawingLocalAdapter); the others are real,
// reachable values a future adapter can populate, not placeholders.
export type SiteDrawingSourceProvider = DocSource;

// The system's own normalized "valid for site use" determination (brief
// section 5) -- never inferred from a filename, timestamp, revision number,
// or folder location. 'UNKNOWN' is a real, displayable state (not an
// error): it means the source's status could not be confidently mapped, and
// the UI must show an explicit warning rather than imply the drawing is
// current.
export const SITE_DRAWING_WORKFLOW_STATUSES = [
  'UNDER_REVIEW', 'APPROVED', 'APPROVED_FOR_CONSTRUCTION', 'REJECTED', 'SUPERSEDED', 'WITHDRAWN', 'UNKNOWN',
] as const;
export type SiteDrawingWorkflowStatus = typeof SITE_DRAWING_WORKFLOW_STATUSES[number];

// Only these two statuses mean "safe to build from" -- every call site that
// needs a yes/no answer goes through isValidForSiteUse() in
// site-drawing-workflow.ts, never a hand-rolled comparison against this
// list, so the rule lives in exactly one place.
export const VALID_FOR_SITE_USE_STATUSES: readonly SiteDrawingWorkflowStatus[] = ['APPROVED', 'APPROVED_FOR_CONSTRUCTION'];

export const SITE_DRAWING_SYNC_STATUSES = ['SYNCED', 'PENDING', 'STALE', 'ERROR', 'NOT_APPLICABLE'] as const;
export type SiteDrawingSyncStatus = typeof SITE_DRAWING_SYNC_STATUSES[number];

export const SITE_DRAWING_SYNC_LOG_STATUSES = ['SUCCESS', 'PARTIAL', 'FAILED'] as const;
export type SiteDrawingSyncLogStatus = typeof SITE_DRAWING_SYNC_LOG_STATUSES[number];

export const SITE_DRAWING_OFFLINE_PACKAGE_STATUSES = ['DOWNLOADING', 'COMPLETE', 'FAILED', 'STALE', 'REMOVED'] as const;
export type SiteDrawingOfflinePackageStatus = typeof SITE_DRAWING_OFFLINE_PACKAGE_STATUSES[number];

// Deliberately a SEPARATE axis from workflowStatus (migration 075 / the
// brief's own Decision 2): approval, revision currency (isSuperseded), and
// document classification answer three different questions. A FINAL or
// AS_BUILT drawing can be APPROVED and still must never be treated as the
// current construction drawing -- see isConfirmedCurrent() in
// site-drawing-workflow.ts, which checks this alongside workflowStatus.
export const SITE_DRAWING_DOCUMENT_CLASSIFICATIONS = ['CONSTRUCTION', 'FINAL', 'AS_BUILT'] as const;
export type SiteDrawingDocumentClassification = typeof SITE_DRAWING_DOCUMENT_CLASSIFICATIONS[number];

// CONFIRMED: embedded-text extraction matched a known title-block pattern.
// NEEDS_REVIEW: OCR fallback was used, no pattern matched, or confidence
// fell below threshold. CONFLICT: two extraction attempts disagreed, or
// this drawing number collides with an existing one under a materially
// different title (a possible drawing-number mismatch). MANUAL: a human
// typed the values directly (the Local-upload path) -- there was nothing
// to extract, not a lower-confidence state.
export const SITE_DRAWING_EXTRACTION_STATUSES = ['CONFIRMED', 'NEEDS_REVIEW', 'CONFLICT', 'MANUAL'] as const;
export type SiteDrawingExtractionStatus = typeof SITE_DRAWING_EXTRACTION_STATUSES[number];

export const SITE_DRAWING_IMPORT_BATCH_STATUSES = ['PENDING', 'PROCESSING', 'COMPLETED', 'PARTIAL', 'FAILED'] as const;
export type SiteDrawingImportBatchStatus = typeof SITE_DRAWING_IMPORT_BATCH_STATUSES[number];

// What the extraction pipeline actually read from the title block, before
// any human correction -- kept verbatim even after an authorized user
// edits the authoritative drawingNumber/drawingTitle/revisionNumber fields,
// so what the system read is always auditable (brief section 3: "AI may
// assist with extraction, but it must not invent missing values").
export interface ExtractedDrawingFields {
  drawingNumber?: string;
  drawingTitle?: string;
  revisionNumber?: string;
  issueDate?: string;
  discipline?: string;
  source: 'embedded_text' | 'ocr';
  // A rough 0-1 confidence the extractor itself reports -- never treated as
  // a guarantee, only a threshold for CONFIRMED vs. NEEDS_REVIEW.
  confidence: number;
}

export interface SiteDrawingRevision {
  id: string;
  companyId: string;
  projectId: string;
  drawingId: string;
  revisionNumber: string;
  workflowStatus: SiteDrawingWorkflowStatus;
  sourceStatusRaw?: string;
  issueDate?: string;
  sourceModifiedAt?: string;
  lastVerifiedAt?: string;
  contentHash?: string;
  storageKey?: string;
  // For a provider whose own revision history lives on ONE source file
  // (e.g. a SharePoint driveItem's version history) rather than as separate
  // standalone files -- the provider's own version identifier (SharePoint's
  // "3.0"-style label), used to ask the adapter for that SPECIFIC version's
  // content rather than just the item's current one. Always undefined for
  // 'internal' revisions, which already have their own distinct storageKey.
  sourceRevisionId?: string;
  sourceWebUrl?: string;
  fileSizeBytes?: number;
  supersedesRevisionId?: string;
  isSuperseded: boolean;
  offlineEligibility: boolean;
  synchronizationStatus: SiteDrawingSyncStatus;
  uploadedBy?: string;
  // Separate from workflowStatus -- see SITE_DRAWING_DOCUMENT_CLASSIFICATIONS'
  // own comment. Defaults to 'CONSTRUCTION' for every revision that was
  // never told otherwise (migration 075).
  documentClassification: SiteDrawingDocumentClassification;
  suitabilityCode?: string;
  // 'MANUAL' for a human-entered revision (nothing was extracted);
  // otherwise the extraction pipeline's own confidence bucket for THIS
  // revision's fields.
  extractionStatus: SiteDrawingExtractionStatus;
  extractedFieldsRaw?: ExtractedDrawingFields;
  importBatchId?: string;
  reviewNotes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SiteDrawing {
  id: string;
  companyId: string;
  projectId: string;
  drawingNumber: string;
  drawingTitle: string;
  discipline?: string;
  buildingOrZone?: string;
  floorOrLevel?: string;
  sourceProvider: SiteDrawingSourceProvider;
  // Stable provider identity -- always set, including a generated UUID for
  // 'internal' drawings (see migration 072's own comment on why this is
  // never NULL).
  sourceFileId: string;
  sourceWebUrl?: string;
  currentRevisionId?: string;
  currentWorkflowStatus: SiteDrawingWorkflowStatus;
  currentIsSuperseded: boolean;
  // Undefined for a drawing discovered by the sync job from an external
  // source -- there is no RealityCapture user behind it (see migration
  // 074's own comment). Always set for a locally-registered drawing.
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
}

// The register's actual working shape -- a drawing joined to its current
// revision, since every real screen (search results, the register table,
// the "requires attention" style warning banner) needs both at once.
export interface SiteDrawingWithCurrentRevision extends SiteDrawing {
  currentRevision: SiteDrawingRevision | null;
}

export interface SiteDrawingSyncLogEntry {
  id: string;
  companyId: string;
  projectId: string;
  sourceProvider: SiteDrawingSourceProvider;
  startedAt: string;
  finishedAt?: string;
  status?: SiteDrawingSyncLogStatus;
  drawingsSeen: number;
  drawingsCreated: number;
  revisionsCreated: number;
  errorMessage?: string;
  triggeredBy?: string;
}

export interface SiteDrawingOfflinePackage {
  id: string;
  companyId: string;
  userId: string;
  projectId: string;
  drawingId: string;
  revisionId: string;
  status: SiteDrawingOfflinePackageStatus;
  contentHash?: string;
  fileSizeBytes?: number;
  downloadedAt?: string;
  lastVerifiedAt: string;
  createdAt: string;
  updatedAt: string;
}

// One row per uploaded ZIP/PDF package (brief section 2: "store import
// batch identifiers, timestamps, source information and the uploading
// user"). The original archive/file is preserved untouched at storageKey
// -- never overwritten, even though each extracted PDF also gets its own
// separate storage key once registered as a revision.
export interface SiteDrawingImportBatch {
  id: string;
  companyId: string;
  projectId: string;
  sourceSystem: SiteDrawingSourceProvider;
  originalFilename: string;
  storageKey: string;
  status: SiteDrawingImportBatchStatus;
  fileCount: number;
  createdCount: number;
  revisionCount: number;
  skippedCount: number;
  errorCount: number;
  errorMessage?: string;
  uploadedBy: string;
  startedAt?: string;
  finishedAt?: string;
  createdAt: string;
}

// What a DrawingSourceAdapter reports about itself (brief section 3's
// getSourceHealth()) -- surfaced in the UI so "source unavailable" and
// "synchronization stale" are two distinct, honest states (section 10),
// never collapsed into a single silent "couldn't load".
export interface SiteDrawingSourceHealth {
  provider: SiteDrawingSourceProvider;
  reachable: boolean;
  lastSuccessfulSyncAt?: string;
  lastAttemptedSyncAt?: string;
  detail?: string;
}
