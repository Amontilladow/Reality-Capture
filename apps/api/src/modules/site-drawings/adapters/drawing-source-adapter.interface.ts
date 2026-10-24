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
  // Set only when this entry came from listRevisions() for a provider whose
  // revision history lives on one source file (see SiteDrawingRevision's
  // own comment) -- the provider's own version id, passed back to
  // getAuthorizedFile() to fetch that SPECIFIC version's content rather
  // than the item's current one. Undefined from listDrawings()/
  // getDrawingMetadata(), which only ever describe the current version.
  sourceRevisionId?: string;
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

  // Every method takes companyId explicitly (not just projectId) -- a
  // real provider's connection config (tenant, site/drive mapping,
  // credentials) is stored per-company in doc_integrations, and every
  // other service in this app already resolves tenant-scoped data this
  // same way (DatabaseService.withTenant(companyId, ...)), never by
  // looking a company up FROM a project (RLS requires the tenant context
  // to already be known before any tenant-scoped query, including reading
  // the project itself).

  // Full listing — used by a sync job, not a user-facing search (section 3:
  // listDrawings()).
  listDrawings(companyId: string, projectId: string): Promise<DiscoveredDrawing[]>;

  // A single drawing's current metadata, re-fetched to verify currency
  // (section 3: getDrawingMetadata()).
  getDrawingMetadata(companyId: string, projectId: string, sourceFileId: string): Promise<DiscoveredDrawing | null>;

  // Reachability + last-sync facts, surfaced in the UI (section 3:
  // getSourceHealth()) -- never silently assumed healthy.
  getSourceHealth(companyId: string, projectId: string): Promise<SourceHealthCheck>;

  // Optional: full revision history for a drawing, when the source exposes
  // one (section 3: listRevisions()). Local/manual drawings have their
  // revision history in our own DB already, so this adapter doesn't need
  // it; a real DMS adapter normally would.
  listRevisions?(companyId: string, projectId: string, sourceFileId: string): Promise<DiscoveredDrawing[]>;

  // Optional: a lightweight poll for "has anything changed since X"
  // (section 3: checkForChanges()) -- e.g. SharePoint's delta query. A
  // provider without one is polled via listDrawings() + content-hash
  // comparison instead (slower, still correct).
  checkForChanges?(companyId: string, projectId: string, sinceIso: string): Promise<boolean>;

  // Optional: resolve a short-lived, authorized download URL/stream for the
  // source's own file (section 3: getAuthorizedFile()) -- a provider the
  // user must open the file at the source itself (sourceWebUrl only, no
  // proxied download) legitimately has nothing to implement here.
  // sourceRevisionId, when given, asks for that SPECIFIC historical
  // version's content (see DiscoveredDrawing's own comment) rather than
  // the file's current content.
  getAuthorizedFile?(companyId: string, projectId: string, sourceFileId: string, sourceRevisionId?: string): Promise<{ url: string; expiresInSeconds: number }>;

  mapStatus?: StatusMapper;
}
