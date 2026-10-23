import axios from 'axios';
import { apiGet, apiGetWithMeta, apiPatch, apiPost } from './api';
import type {
  SiteDrawingWithCurrentRevision, SiteDrawingRevision, SiteDrawingWorkflowStatus,
  SiteDrawingOfflinePackage, SiteDrawingOfflinePackageStatus, SiteDrawingSourceHealth,
} from '@engineeringos/types';
export type {
  SiteDrawing, SiteDrawingRevision, SiteDrawingWithCurrentRevision, SiteDrawingWorkflowStatus,
  SiteDrawingOfflinePackage, SiteDrawingOfflinePackageStatus, SiteDrawingSourceHealth, SiteDrawingSourceProvider,
  SiteDrawingDocumentClassification, SiteDrawingExtractionStatus, SiteDrawingImportBatch, SiteDrawingImportBatchStatus,
  ExtractedDrawingFields,
} from '@engineeringos/types';
export {
  SITE_DRAWING_WORKFLOW_STATUSES, VALID_FOR_SITE_USE_STATUSES, SITE_DRAWING_DOCUMENT_CLASSIFICATIONS,
  SITE_DRAWING_EXTRACTION_STATUSES,
} from '@engineeringos/types';

const base = (projectId: string) => `/projects/${projectId}/site-drawings`;

export interface SiteDrawingFilters {
  search?: string;
  discipline?: string;
  buildingOrZone?: string;
  floorOrLevel?: string;
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
  revisionNumber: string;
  workflowStatus: SiteDrawingWorkflowStatus;
  issueDate?: string;
  storageKey: string;
}
export const registerSiteDrawing = (projectId: string, input: RegisterSiteDrawingInput) =>
  apiPost<SiteDrawingWithCurrentRevision>(base(projectId), input);

// The 3-step upload flow every other upload in this app uses (get a
// presigned URL, PUT the file straight to storage, then register the
// metadata) -- see drawings.api.ts's uploadDrawing() for the pattern this
// mirrors.
export async function uploadAndRegisterSiteDrawing(projectId: string, file: File, meta: Omit<RegisterSiteDrawingInput, 'storageKey'>): Promise<SiteDrawingWithCurrentRevision> {
  const { uploadUrl, storageKey } = await getSiteDrawingUploadUrl(projectId, file.name);
  await axios.put(uploadUrl, file, { headers: { 'Content-Type': 'application/pdf' } });
  return registerSiteDrawing(projectId, { ...meta, storageKey });
}

export async function uploadAndAddSiteDrawingRevision(projectId: string, drawingId: string, file: File, meta: Omit<AddRevisionInput, 'storageKey'>): Promise<SiteDrawingWithCurrentRevision> {
  const { uploadUrl, storageKey } = await getSiteDrawingUploadUrl(projectId, file.name);
  await axios.put(uploadUrl, file, { headers: { 'Content-Type': 'application/pdf' } });
  return addSiteDrawingRevision(projectId, drawingId, { ...meta, storageKey });
}

export const listSiteDrawings = (projectId: string, filters: SiteDrawingFilters) =>
  apiGetWithMeta<SiteDrawingWithCurrentRevision[]>(base(projectId), { params: filters });

export interface SiteDrawingFilterOptions {
  disciplines: string[];
  buildingsOrZones: string[];
  floorsOrLevels: string[];
}
export const getSiteDrawingFilterOptions = (projectId: string) =>
  apiGet<SiteDrawingFilterOptions>(`${base(projectId)}/filter-options`);

export const getSiteDrawingSourceHealth = (projectId: string) =>
  apiGet<SiteDrawingSourceHealth>(`${base(projectId)}/source-health`);

export interface SiteDrawingSyncOutcome {
  status: 'SUCCESS' | 'FAILED';
  drawingsSeen: number;
  drawingsCreated: number;
  revisionsCreated: number;
}
// Triggers an immediate sync rather than waiting for the sync job's own
// 15-minute schedule (SiteDrawingSyncService) -- 'sharepoint' is the
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

// A fresh short-lived (15 min) presigned URL -- never cached/reused past
// that window (brief section 9). Callers should fetch this right before
// opening the viewer or starting an offline download, not store it.
export const getSiteDrawingDownloadUrl = (projectId: string, revisionId: string) =>
  apiGet<{ url: string; expiresInSeconds: number; workflowStatus: SiteDrawingWorkflowStatus; isSuperseded: boolean }>(`${base(projectId)}/revisions/${revisionId}/download`);

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
