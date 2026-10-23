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
