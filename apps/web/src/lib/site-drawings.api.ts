import axios from 'axios';
import { apiGet, apiGetWithMeta, apiPatch, apiPost, apiDelete, apiDownload } from './api';
import type {
  SiteDrawingWithCurrentRevision, SiteDrawingRevision, SiteDrawingWorkflowStatus,
  SiteDrawingOfflinePackage, SiteDrawingOfflinePackageStatus, SiteDrawingSourceHealth,
  SiteDrawingImportBatch, SiteDrawingReviewQueueItem, DocSource, ExtractedDrawingFields,
  SiteDrawingOrgMapping, SiteDrawingOrgMappingRole,
} from '@engineeringos/types';
export type {
  SiteDrawing, SiteDrawingRevision, SiteDrawingWithCurrentRevision, SiteDrawingWorkflowStatus,
  SiteDrawingOfflinePackage, SiteDrawingOfflinePackageStatus, SiteDrawingSourceHealth, SiteDrawingSourceProvider,
  SiteDrawingDocumentClassification, SiteDrawingExtractionStatus, SiteDrawingImportBatch, SiteDrawingImportBatchStatus,
  SiteDrawingReviewQueueItem, ExtractedDrawingFields, DocSource, SiteDrawingOrgMapping, SiteDrawingOrgMappingRole,
} from '@engineeringos/types';
export {
  SITE_DRAWING_WORKFLOW_STATUSES, VALID_FOR_SITE_USE_STATUSES, SITE_DRAWING_DOCUMENT_CLASSIFICATIONS,
  SITE_DRAWING_EXTRACTION_STATUSES, SITE_DRAWING_ORG_MAPPING_ROLES,
} from '@engineeringos/types';

const base = (projectId: string) => `/projects/${projectId}/site-drawings`;

export interface SiteDrawingFilters {
  search?: string;
  discipline?: string;
  buildingOrZone?: string;
  floorOrLevel?: string;
  responsibleSubcontractor?: string;
  workflowStatus?: SiteDrawingWorkflowStatus;
  page?: number;
  perPage?: number;
}

export const getSiteDrawingUploadUrl = (projectId: string, filename: string) =>
  apiPost<{ uploadUrl: string; storageKey: string }>(`${base(projectId)}/upload-url`, { filename });

export interface RegisterSiteDrawingInput {
  drawingNumber: string;
  drawingTitle: string;
  discipline?: string;
  buildingOrZone?: string;
  floorOrLevel?: string;
  originator?: string;
  responsibleSubcontractor?: string;
  revisionNumber: string;
  workflowStatus: SiteDrawingWorkflowStatus;
  issueDate?: string;
  storageKey: string;
}
export const registerSiteDrawing = (projectId: string, input: RegisterSiteDrawingInput) =>
  apiPost<SiteDrawingWithCurrentRevision>(base(projectId), input);

// Just the upload half (presigned URL, then PUT straight to storage) --
// split out from uploadAndRegisterSiteDrawing below so the registration
// modal can upload a dropped file immediately, run extraction against the
// result, and only call registerSiteDrawing() once the uploader has
// reviewed/corrected the pre-filled fields.
export async function uploadSiteDrawingFile(projectId: string, file: File): Promise<{ storageKey: string }> {
  const { uploadUrl, storageKey } = await getSiteDrawingUploadUrl(projectId, file.name);
  await axios.put(uploadUrl, file, { headers: { 'Content-Type': 'application/pdf' } });
  return { storageKey };
}

// The same embedded-text/OCR pipeline the bulk import pipeline already
// uses, run against this one already-uploaded file. Returns null (not an
// error) when nothing could be confidently read -- the caller's form just
// stays blank for manual entry, same as before this existed.
export const extractSiteDrawingFields = (projectId: string, storageKey: string) =>
  apiPost<ExtractedDrawingFields | null>(`${base(projectId)}/extract-fields`, { storageKey });

// The 3-step upload flow every other upload in this app uses (get a
// presigned URL, PUT the file straight to storage, then register the
// metadata); see drawings.api.ts's uploadDrawing() for the pattern this
// mirrors.
export async function uploadAndRegisterSiteDrawing(projectId: string, file: File, meta: Omit<RegisterSiteDrawingInput, 'storageKey'>): Promise<SiteDrawingWithCurrentRevision> {
  const { storageKey } = await uploadSiteDrawingFile(projectId, file);
  return registerSiteDrawing(projectId, { ...meta, storageKey });
}

export async function uploadAndAddSiteDrawingRevision(projectId: string, drawingId: string, file: File, meta: Omit<AddRevisionInput, 'storageKey'>): Promise<SiteDrawingWithCurrentRevision> {
  const { uploadUrl, storageKey } = await getSiteDrawingUploadUrl(projectId, file.name);
  await axios.put(uploadUrl, file, { headers: { 'Content-Type': 'application/pdf' } });
  return addSiteDrawingRevision(projectId, drawingId, { ...meta, storageKey });
}

export const listSiteDrawings = (projectId: string, filters: SiteDrawingFilters) =>
  apiGetWithMeta<SiteDrawingWithCurrentRevision[]>(base(projectId), { params: filters });

// Same filters as listSiteDrawings, no pagination -- the server exports
// every matching drawing, not just whatever page is currently loaded.
export const exportSiteDrawingRegister = (
  projectId: string, filters: Omit<SiteDrawingFilters, 'page' | 'perPage'>, filename: string,
) => apiDownload(`${base(projectId)}/export?${new URLSearchParams(
  Object.entries(filters).filter(([, v]) => v !== undefined && v !== '') as [string, string][],
).toString()}`, filename);

export interface SiteDrawingFilterOptions {
  disciplines: string[];
  buildingsOrZones: string[];
  floorsOrLevels: string[];
  subcontractors: string[];
}
export const getSiteDrawingFilterOptions = (projectId: string) =>
  apiGet<SiteDrawingFilterOptions>(`${base(projectId)}/filter-options`);

export interface SiteDrawingDashboardStats {
  total: number;
  currentAuthorized: number;
  superseded: number;
  underReview: number;
  newlyReceived: number;
  requiringAttention: number;
  recentRevisionActivity: number;
}
export const getSiteDrawingDashboardStats = (projectId: string) =>
  apiGet<SiteDrawingDashboardStats>(`${base(projectId)}/dashboard-stats`);

// ── Organization mapping (master spec section 4) ────────────────────────
export const listSiteDrawingOrgMappings = (projectId: string) =>
  apiGet<SiteDrawingOrgMapping[]>(`${base(projectId)}/org-mappings`);

export const createSiteDrawingOrgMapping = (projectId: string, pattern: string, organizationName: string, role: SiteDrawingOrgMappingRole) =>
  apiPost<SiteDrawingOrgMapping>(`${base(projectId)}/org-mappings`, { pattern, organizationName, role });

export const deleteSiteDrawingOrgMapping = (projectId: string, mappingId: string) =>
  apiDelete<{ removed: boolean }>(`${base(projectId)}/org-mappings/${mappingId}`);

export const getSiteDrawingSourceHealth = (projectId: string) =>
  apiGet<SiteDrawingSourceHealth>(`${base(projectId)}/source-health`);

export interface SiteDrawingSyncOutcome {
  status: 'SUCCESS' | 'FAILED';
  drawingsSeen: number;
  drawingsCreated: number;
  revisionsCreated: number;
}
// Triggers an immediate sync rather than waiting for the sync job's own
// 15-minute schedule (SiteDrawingSyncService): 'sharepoint' is the
// default since it's the only provider with a real adapter today.
export const triggerSiteDrawingSync = (projectId: string, provider: 'sharepoint' | 'aconex' | 'procore' = 'sharepoint') =>
  apiPost<SiteDrawingSyncOutcome>(`${base(projectId)}/sync`, { provider });

export const getSiteDrawing = (projectId: string, drawingId: string) =>
  apiGet<SiteDrawingWithCurrentRevision>(`${base(projectId)}/${drawingId}`);

export const listSiteDrawingRevisions = (projectId: string, drawingId: string) =>
  apiGet<SiteDrawingRevision[]>(`${base(projectId)}/${drawingId}/revisions`);

export interface AddRevisionInput {
  revisionNumber: string;
  workflowStatus: SiteDrawingWorkflowStatus;
  issueDate?: string;
  storageKey: string;
  offlineEligibility?: boolean;
}
export const addSiteDrawingRevision = (projectId: string, drawingId: string, input: AddRevisionInput) =>
  apiPost<SiteDrawingWithCurrentRevision>(`${base(projectId)}/${drawingId}/revisions`, input);

export const setSiteDrawingWorkflowStatus = (projectId: string, drawingId: string, revisionId: string, workflowStatus: SiteDrawingWorkflowStatus, reason?: string) =>
  apiPatch<SiteDrawingRevision>(`${base(projectId)}/${drawingId}/revisions/${revisionId}/workflow-status`, { workflowStatus, reason });

// A fresh short-lived (15 min) presigned URL; never cached/reused past
// that window (brief section 9). Callers should fetch this right before
// opening the viewer or starting an offline download, not store it.
//
// purpose: 'view' (default) backs the in-browser PDF viewer and always
// works, including on a superseded revision -- viewing it with its
// watermark is required, not blocked. 'download' backs an explicit
// save-the-file action and is rejected server-side once the revision is
// superseded (master spec section 8: enforced on the backend, not by
// hiding the button).
export const getSiteDrawingDownloadUrl = (projectId: string, revisionId: string, purpose: 'view' | 'download' = 'view') =>
  apiGet<{ url: string; expiresInSeconds: number; workflowStatus: SiteDrawingWorkflowStatus; isSuperseded: boolean }>(`${base(projectId)}/revisions/${revisionId}/download`, { params: { purpose } });

export const listOfflinePackages = (projectId: string) =>
  apiGet<SiteDrawingOfflinePackage[]>(`${base(projectId)}/offline-packages`);

export const startOfflinePackage = (projectId: string, revisionId: string) =>
  apiPost<SiteDrawingOfflinePackage>(`${base(projectId)}/offline-packages`, { revisionId });

export const completeOfflinePackage = (projectId: string, packageId: string, status: SiteDrawingOfflinePackageStatus, contentHash?: string, fileSizeBytes?: number) =>
  apiPatch<SiteDrawingOfflinePackage>(`${base(projectId)}/offline-packages/${packageId}/complete`, { status, contentHash, fileSizeBytes });

export const revalidateOfflinePackage = (projectId: string, packageId: string) =>
  apiPost<{ package: SiteDrawingOfflinePackage; revision: SiteDrawingRevision; isStale: boolean }>(`${base(projectId)}/offline-packages/${packageId}/revalidate`);

export const removeOfflinePackage = (projectId: string, packageId: string) =>
  apiPatch<{ removed: boolean }>(`${base(projectId)}/offline-packages/${packageId}/remove`, {});

// ── Bulk import (ZIP/PDF packages) + review queue ──────────────────────────
// The backend side of this (SiteDrawingImportController/Service) already
// existed with no frontend client at all -- these functions, the upload
// flow below, and the Hub's Import/Review Queue UI are what actually make
// it reachable.

const importBase = (projectId: string) => `${base(projectId)}/import-batches`;

export const getImportBatchUploadUrl = (projectId: string, filename: string) =>
  apiPost<{ uploadUrl: string; storageKey: string }>(`${importBase(projectId)}/upload-url`, { filename });

export interface CreateImportBatchInput {
  storageKey: string;
  originalFilename: string;
  sourceSystem: DocSource;
}
export const createImportBatch = (projectId: string, input: CreateImportBatchInput) =>
  apiPost<SiteDrawingImportBatch>(importBase(projectId), input);

// Same 3-step upload flow as uploadAndRegisterSiteDrawing -- the content
// type has to match exactly what getUploadUrl() signed server-side
// (SiteDrawingImportService.getUploadUrl: .zip -> application/zip, else
// application/pdf), or the presigned PUT's signature won't match.
export async function uploadImportBatch(projectId: string, file: File, sourceSystem: DocSource): Promise<SiteDrawingImportBatch> {
  const { uploadUrl, storageKey } = await getImportBatchUploadUrl(projectId, file.name);
  const contentType = file.name.toLowerCase().endsWith('.zip') ? 'application/zip' : 'application/pdf';
  await axios.put(uploadUrl, file, { headers: { 'Content-Type': contentType } });
  return createImportBatch(projectId, { storageKey, originalFilename: file.name, sourceSystem });
}

export const listImportBatches = (projectId: string) =>
  apiGet<SiteDrawingImportBatch[]>(importBase(projectId));

export const getImportBatch = (projectId: string, batchId: string) =>
  apiGet<SiteDrawingImportBatch>(`${importBase(projectId)}/${batchId}`);

export const listReviewQueue = (projectId: string) =>
  apiGet<SiteDrawingReviewQueueItem[]>(`${importBase(projectId)}/review-queue`);

export interface ResolveReviewInput {
  drawingNumber?: string;
  drawingTitle?: string;
  revisionNumber?: string;
  reviewNotes: string;
}
export const resolveReview = (projectId: string, revisionId: string, input: ResolveReviewInput) =>
  apiPatch<SiteDrawingRevision>(`${importBase(projectId)}/review-queue/${revisionId}`, { ...input, extractionStatus: 'CONFIRMED' });
