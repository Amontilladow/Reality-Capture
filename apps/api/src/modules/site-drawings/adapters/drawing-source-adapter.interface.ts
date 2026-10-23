import type { SiteDrawingSourceHealth, SiteDrawingSourceProvider, SiteDrawingWorkflowStatus } from '@engineeringos/types';

// What an adapter found for one drawing in the source system, before it's
// persisted as a SiteDrawing + SiteDrawingRevision pair. Deliberately flat
// and source-shaped (not our own DB row shape) -- SiteDrawingsService owns
// turning this into register rows, deciding what's new vs. changed, and
// detecting supersession; an adapter never writes to the database itself.
export interface DiscoveredDrawing {
  sourceFileId: string;
  sourceWebUrl?: string;
  drawingNumber: string;
  drawingTitle: string;
  discipline?: string;
  buildingOrZone?: string;
  floorOrLevel?: string;
  revisionNumber: string;
  sourceStatusRaw?: string;
  issueDate?: string;
  sourceModifiedAt?: string;
  contentHash?: string;
  fileSizeBytes?: number;
}

export interface SourceHealthCheck extends Omit<SiteDrawingSourceHealth, 'provider'> {}

// A provider's own authoritative status-mapping, when it has one more
// specific than site-drawing-workflow.ts's generic fallback (e.g. a real
// SharePoint adapter reading a project's configured document-control
// column values). Optional — an adapter that doesn't implement this falls
// back to fallbackMapSourceStatus().
export type StatusMapper = (sourceStatusRaw: string | null | undefined) => SiteDrawingWorkflowStatus;

// The common contract every provider implements (brief section 3).
// Deliberately NOT every method is required: a provider that genuinely
// can't support an operation (e.g. a read-only connector with no
// change-detection API) omits it rather than faking a no-op implementation
// — "Adapt these operations to each provider's real capabilities. Do not
// pretend unsupported operations are available." Callers must branch on
// `'methodName' in adapter` before calling an optional method.
export interface DrawingSourceAdapter {
  readonly provider: SiteDrawingSourceProvider;

  // Full listing — used by a sync job, not a user-facing search (section 3:
  // listDrawings()).
  listDrawings(projectId: string): Promise<DiscoveredDrawing[]>;

  // A single drawing's current metadata, re-fetched to verify currency
  // (section 3: getDrawingMetadata()).
  getDrawingMetadata(projectId: string, sourceFileId: string): Promise<DiscoveredDrawing | null>;

  // Reachability + last-sync facts, surfaced in the UI (section 3:
  // getSourceHealth()) -- never silently assumed healthy.
  getSourceHealth(projectId: string): Promise<SourceHealthCheck>;

  // Optional: full revision history for a drawing, when the source exposes
  // one (section 3: listRevisions()). Local/manual drawings have their
  // revision history in our own DB already, so this adapter doesn't need
  // it; a real DMS adapter normally would.
  listRevisions?(projectId: string, sourceFileId: string): Promise<DiscoveredDrawing[]>;

  // Optional: a lightweight poll for "has anything changed since X"
  // (section 3: checkForChanges()) -- e.g. SharePoint's delta query. A
  // provider without one is polled via listDrawings() + content-hash
  // comparison instead (slower, still correct).
  checkForChanges?(projectId: string, sinceIso: string): Promise<boolean>;

  // Optional: resolve a short-lived, authorized download URL/stream for the
  // source's own file (section 3: getAuthorizedFile()) -- a provider the
  // user must open the file at the source itself (sourceWebUrl only, no
  // proxied download) legitimately has nothing to implement here.
  getAuthorizedFile?(projectId: string, sourceFileId: string): Promise<{ url: string; expiresInSeconds: number }>;

  mapStatus?: StatusMapper;
}
