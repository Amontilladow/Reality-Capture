import axios from 'axios';
import { apiGet, apiPost, apiDelete } from './api';
import { GIS_PREP_MAX_UPLOAD_BYTES, GIS_PREP_MAX_UPLOAD_MB, type GisConvertSettings, type GisPrepJob, type GisPrepSettings } from '@engineeringos/types';
export type { GisConvertSettings, GisPrepJob, GisPrepJobStatus, GisPrepProfile, GisPrepSettings, GisPrepOutputFile } from '@engineeringos/types';
export { GIS_PREP_MAX_UPLOAD_BYTES, GIS_PREP_MAX_UPLOAD_MB };

const base = (projectId: string) => `/projects/${projectId}/gis-prep`;

export const listGisPrepJobs = (projectId: string) => apiGet<GisPrepJob[]>(`${base(projectId)}/jobs`);

export const getGisPrepJob = (projectId: string, jobId: string) => apiGet<GisPrepJob>(`${base(projectId)}/jobs/${jobId}`);

export const deleteGisPrepJob = (projectId: string, jobId: string) => apiDelete<{ message: string }>(`${base(projectId)}/jobs/${jobId}`);

export const bulkDeleteGisPrepJobs = (projectId: string, ids: string[]) =>
  apiPost<{ deleted: number; failed: number }>(`${base(projectId)}/jobs/bulk-delete`, { ids });

export const rerunGisPrepJob = (projectId: string, jobId: string, settings: GisPrepSettings | GisConvertSettings) =>
  apiPost<GisPrepJob>(`${base(projectId)}/jobs/${jobId}/rerun`, { settings });

// Same 3-step flow as every other upload in this app: presigned URL, PUT the
// file straight to storage, then create the job record. Checked here FIRST
// (before even requesting a presigned URL) so an obviously oversized file
// never starts an upload it would just be rejected for -- the API's own
// createJob() HEAD-based check (gis-prep.service.ts) is still what actually
// enforces this; a client-side check can always be bypassed.
export async function uploadAndCreateGisPrepJob(projectId: string, file: File, settings: GisPrepSettings | GisConvertSettings): Promise<GisPrepJob> {
  if (file.size > GIS_PREP_MAX_UPLOAD_BYTES) {
    throw new Error(`This drawing is ${(file.size / 1024 / 1024).toFixed(1)} MB, over the ${GIS_PREP_MAX_UPLOAD_MB} MB limit for GIS preparation.`);
  }
  const { uploadUrl, storageKey } = await apiPost<{ uploadUrl: string; storageKey: string }>(
    `${base(projectId)}/upload-url`, { filename: file.name, declaredSizeBytes: file.size },
  );
  await axios.put(uploadUrl, file, { headers: { 'Content-Type': 'application/octet-stream' } });
  return apiPost<GisPrepJob>(`${base(projectId)}/jobs`, { storageKey, originalFilename: file.name, settings });
}
