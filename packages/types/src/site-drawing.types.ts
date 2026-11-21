import type { DocSource } from './document.types';

// Reuses DocSource ('internal'|'procore'|'aconex'|'sharepoint'|'bim360'|
// 'manual_link') rather than inventing a parallel provider enum; see
// migration 072's own header comment. 'internal' is the only provider this
// phase actually implements (SiteDrawingLocalAdapter); the others are real,
// reachable values a future adapter can populate, not placeholders.
export type SiteDrawingSourceProvider = DocSource;

// The system's own normalized "valid for site use" determination (brief
// section 5): never inferred from a filename, timestamp, revision number,
// or folder location. 'UNKNOWN' is a real, displayable state (not an
// error): it means the source's status could not be confidently mapped, and
// the UI must show an explicit warning rather than imply the drawing is
// current.
export const SITE_DRAWING_WORKFLOW_STATUSES = [
  'UNDER_REVIEW', 'APPROVED', 'APPROVED_FOR_CONSTRUCTION', 'REJECTED', 'SUPERSEDED', 'WITHDRAWN', 'UNKNOWN',
] as const;
export type SiteDrawingWorkflowStatus = typeof SITE_DRAWING_WORKFLOW_STATUSES[number];

// Only these two statuses mean "safe to build from"; every call site that
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
// current construction drawing; see isConfirmedCurrent() in
// site-drawing-workflow.ts, which checks this alongside workflowStatus.
export const SITE_DRAWING_DOCUMENT_CLASSIFICATIONS = ['CONSTRUCTION', 'FINAL', 'AS_BUILT'] as const;
export type SiteDrawingDocumentClassification = typeof SITE_DRAWING_DOCUMENT_CLASSIFICATIONS[number];

// CONFIRMED: embedded-text extraction matched a known title-block pattern.
// NEEDS_REVIEW: OCR fallback was used, no pattern matched, or confidence
// fell below threshold. CONFLICT: two extraction attempts disagreed, or
// this drawing number collides with an existing one under a materially
// different title (a possible drawing-number mismatch). MANUAL: a human
// typed the values directly (the Local-upload path): there was nothing
// to extract, not a lower-confidence state.
export const SITE_DRAWING_EXTRACTION_STATUSES = ['CONFIRMED', 'NEEDS_REVIEW', 'CONFLICT', 'MANUAL'] as const;
export type SiteDrawingExtractionStatus = typeof SITE_DRAWING_EXTRACTION_STATUSES[number];

export const SITE_DRAWING_IMPORT_BATCH_STATUSES = ['PENDING', 'PROCESSING', 'COMPLETED', 'PARTIAL', 'FAILED'] as const;
export type SiteDrawingImportBatchStatus = typeof SITE_DRAWING_IMPORT_BATCH_STATUSES[number];

// The individual fields a title-block extraction can produce -- used as
// the key type for both per-field evidence and per-field verification
// state below, so there is exactly one list of "the fields this system
// extracts," never two that could drift apart.
export type DrawingFieldName = 'drawingNumber' | 'drawingTitle' | 'revisionNumber' | 'issueDate' | 'discipline' | 'projectName';

// Drawing Identification Engine replacement: "store the source location,
// extraction method and supporting evidence for each field." `location`
// is deliberately a free-form, human-readable string ("row 2, col 1",
// "whole_page", "revision_table") rather than a strict row/col object --
// its only job is to let a reviewer or an auditor see WHERE a value
// came from, never to be computed against; different extraction paths
// (a title-block grid cell, a whole-page regex fallback, a revision-
// history table, a filename hint) each describe their own location in
// whatever shape makes sense for that path.
export type FieldExtractionMethod = 'native_text' | 'ocr' | 'revision_table' | 'filename' | 'manual';

export interface FieldEvidence {
  location: string;
  method: FieldExtractionMethod;
  // The raw matched text, before any trimming/normalization -- kept
  // verbatim so a reviewer can see exactly what the extractor matched,
  // even when the stored value itself was cleaned up slightly (e.g.
  // trimmed whitespace).
  rawText?: string;
  // This specific field's OWN match confidence (0-1) -- NOT the
  // extraction's overall `confidence` on ExtractedDrawingFields, which is
  // the weakest-link of every field combined. extraction/verification.ts
  // uses this, together with `location`, to decide VERIFIED vs
  // UNVERIFIED per field: a confident match is still never VERIFIED
  // unless it also came from a specific cell/region, not a whole-page
  // fallback -- see that module's own comment for the exact rule.
  confidence: number;
}

// Engineering Hybrid Drawing Intelligence Engine, verification stage:
// three distinct states, never collapsed into a single confidence
// number. VERIFIED requires real corroborating evidence (a title-block
// match, found inside the detected title-block region, passing its
// field's own plausibility check) -- successfully matching a regex
// alone is never enough on its own to earn this; see
// extraction/verification.ts's own comment for the exact rule per field.
// UNVERIFIED means something was extracted but the evidence for it is
// weaker (a whole-page fallback match, a lower-confidence OCR region, a
// supplementary source like a revision table or filename). MISSING means
// no value was found at all -- never a fabricated placeholder.
export const FIELD_VERIFICATION_STATES = ['VERIFIED', 'UNVERIFIED', 'MISSING'] as const;
export type FieldVerificationState = typeof FIELD_VERIFICATION_STATES[number];

// What the extraction pipeline actually read from the title block, before
// any human correction; kept verbatim even after an authorized user
// edits the authoritative drawingNumber/drawingTitle/revisionNumber fields,
// so what the system read is always auditable (brief section 3: "AI may
// assist with extraction, but it must not invent missing values").
export interface ExtractedDrawingFields {
  drawingNumber?: string;
  drawingTitle?: string;
  revisionNumber?: string;
  issueDate?: string;
  discipline?: string;
  // Best-effort, INFORMATIONAL ONLY: whatever project name/number the
  // title block itself prints (a "Project:" label), if any. This never
  // drives which project a drawing belongs to -- that's already decided
  // by upload context (the project the user uploaded into) and governed
  // by RBAC/project-scoping this change does not touch. Its only use is
  // as evidence a reviewer can compare against the drawing's actual
  // project, e.g. to catch a drawing uploaded into the wrong project.
  projectName?: string;
  // Resolved from the project's own site_drawing_org_mappings (a
  // drawing-number-prefix lookup an authorized user maintains), matched
  // against this drawingNumber -- never guessed from title-block text
  // directly; see migration 080's own comment on why the mapping stays a
  // literal prefix match rather than an inference engine.
  originator?: string;
  responsibleSubcontractor?: string;
  source: 'embedded_text' | 'ocr';
  // A rough 0-1 confidence the extractor itself reports; never treated as
  // a guarantee, only a threshold for CONFIRMED vs. NEEDS_REVIEW.
  confidence: number;
  // Per-field source location/method/supporting evidence, additive to
  // the flat fields above (never required -- a field with no entry here
  // simply has no recorded evidence, the same as before this existed).
  fieldEvidence?: Partial<Record<DrawingFieldName, FieldEvidence>>;
  // Per-field Verified/Unverified/Missing state (extraction/
  // verification.ts); additive, and deliberately SEPARATE from the flat
  // `confidence` number above -- a drawing's overall confidence can stay
  // for backward compatibility with every existing caller/display that
  // reads it, while this gives the Review Queue and any future UI the
  // finer-grained picture the brief asks for.
  fieldStates?: Partial<Record<DrawingFieldName, FieldVerificationState>>;
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
  // standalone files; the provider's own version identifier (SharePoint's
  // "3.0"-style label), used to ask the adapter for that SPECIFIC version's
  // content rather than just the item's current one. Always undefined for
  // 'internal' revisions, which already have their own distinct storageKey.
  sourceRevisionId?: string;
  sourceWebUrl?: string;
  // Which external source (if any) actually produced THIS revision --
  // distinct from site_drawings.sourceProvider/sourceFileId, which only
  // ever recorded the drawing's ORIGINAL registering source and implicitly
  // assumed a drawing has exactly one source forever. Set only for a
  // sync-created revision (migration 087); undefined for a manually
  // registered or RAR/ZIP-imported one, which has no external source file
  // to track. Lets the sync job recognize a source file it has already
  // reconciled onto ANY drawing, and lets a reviewer see which provider a
  // CONFLICT-flagged cross-source match actually came from.
  sourceProvider?: SiteDrawingSourceProvider;
  sourceFileId?: string;
  fileSizeBytes?: number;
  supersedesRevisionId?: string;
  isSuperseded: boolean;
  offlineEligibility: boolean;
  synchronizationStatus: SiteDrawingSyncStatus;
  uploadedBy?: string;
  // Separate from workflowStatus; see SITE_DRAWING_DOCUMENT_CLASSIFICATIONS'
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
  // The consultant/originator who issued the drawing, and the
  // subcontractor responsible for the work it describes -- two distinct
  // roles (master spec section 4: "do not confuse the drawing originator
  // with the subcontractor responsible for executing the work"). Either
  // may come from extraction (an org-mapping match) or be set/corrected
  // by a human; neither is ever inferred from a filename alone.
  originator?: string;
  responsibleSubcontractor?: string;
  sourceProvider: SiteDrawingSourceProvider;
  // Stable provider identity: always set, including a generated UUID for
  // 'internal' drawings (see migration 072's own comment on why this is
  // never NULL).
  sourceFileId: string;
  sourceWebUrl?: string;
  currentRevisionId?: string;
  currentWorkflowStatus: SiteDrawingWorkflowStatus;
  currentIsSuperseded: boolean;
  // Undefined for a drawing discovered by the sync job from an external
  // source; there is no RealityCapture user behind it (see migration
  // 074's own comment). Always set for a locally-registered drawing.
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
}

// The register's actual working shape: a drawing joined to its current
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
  // A cross-source match (same drawing_number, different provider) left
  // un-promoted pending a human decision in the Review Queue -- migration
  // 087's own conflicts_created column.
  conflictsCreated: number;
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

export const SITE_DRAWING_ORG_MAPPING_ROLES = ['originator', 'subcontractor'] as const;
export type SiteDrawingOrgMappingRole = typeof SITE_DRAWING_ORG_MAPPING_ROLES[number];

// A project-specific "drawing numbers starting with X belong to
// organization Y" rule an authorized user maintains (master spec section
// 4); extraction consults these before falling back to any generic
// heuristic, and reuses a confirmed mapping on every later upload instead
// of asking again.
export interface SiteDrawingOrgMapping {
  id: string;
  companyId: string;
  projectId: string;
  pattern: string;
  organizationName: string;
  role: SiteDrawingOrgMappingRole;
  createdBy: string;
  createdAt: string;
}

// listReviewQueue()'s own return shape -- a bare SiteDrawingRevision has no
// way to show a reviewer WHICH drawing a flagged revision belongs to, and
// that's exactly what the review queue exists to show. Joined in at the
// query (SiteDrawingImportService.listReviewQueue()), not added as a
// generic field on every revision everywhere else.
export interface SiteDrawingReviewQueueItem extends SiteDrawingRevision {
  drawingNumber: string;
  drawingTitle: string;
  // True when this revision exists but was deliberately NOT promoted to
  // its drawing's current_revision_id (identity or chronology couldn't be
  // confirmed automatically -- see SiteDrawingImportProcessor.reconcile()).
  // The Review Queue needs this to offer the right actions: a pending item
  // can be confirmed as a new revision OR split into its own drawing;
  // an already-current one (flagged only for a lower-confidence VALUE,
  // e.g. NEEDS_REVIEW from OCR) only ever needed its fields corrected.
  isPendingPromotion: boolean;
}

// One row per uploaded ZIP/PDF package (brief section 2: "store import
// batch identifiers, timestamps, source information and the uploading
// user"). The original archive/file is preserved untouched at storageKey;
// never overwritten, even though each extracted PDF also gets its own
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
  // A revision WAS created and is linked to its matched drawing, but was
  // deliberately not promoted to current because identity or revision
  // chronology couldn't be confirmed automatically (migration 086) --
  // distinct from revisionCount (auto-promoted) and errorCount (nothing
  // was created at all). Needs a human decision in the Review Queue.
  conflictCount: number;
  skippedCount: number;
  errorCount: number;
  // Non-PDF entries and oversized/unsafe entries the archive contained,
  // never counted anywhere in the batch record before migration 086.
  unsupportedCount: number;
  errorMessage?: string;
  uploadedBy: string;
  startedAt?: string;
  finishedAt?: string;
  createdAt: string;
}

// What a DrawingSourceAdapter reports about itself (brief section 3's
// getSourceHealth()): surfaced in the UI so "source unavailable" and
// "synchronization stale" are two distinct, honest states (section 10),
// never collapsed into a single silent "couldn't load".
export interface SiteDrawingSourceHealth {
  provider: SiteDrawingSourceProvider;
  reachable: boolean;
  lastSuccessfulSyncAt?: string;
  lastAttemptedSyncAt?: string;
  detail?: string;
}
