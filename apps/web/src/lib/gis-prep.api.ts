import axios from 'axios';
import { apiGet, apiPost } from './api';
import type { GisPrepJob, GisPrepSettings } from '@engineeringos/types';
export type { GisPrepJob, GisPrepJobStatus, GisPrepProfile, GisPrepSettings, GisPrepOutputFile } from '@engineeringos/types';

const base = (projectId: string) => `/projects/${projectId}/gis-prep`;

export const listGisPrepJobs = (projectId: string) => apiGet<GisPrepJob[]>(`${base(projectId)}/jobs`);

export const getGisPrepJob = (projectId: string, jobId: string) => apiGet<GisPrepJob>(`${base(projectId)}/jobs/${jobId}`);

export const rerunGisPrepJob = (projectId: string, jobId: string, settings: GisPrepSettings) =>
  apiPost<GisPrepJob>(`${base(projectId)}/jobs/${jobId}/rerun`, { settings });

// Same 3-step flow as every other upload in this app: presigned URL, PUT the
// file straight to storage, then create the job record.
export async function uploadAndCreateGisPrepJob(projectId: string, file: File, settings: GisPrepSettings): Promise<GisPrepJob> {
  const { uploadUrl, storageKey } = await apiPost<{ uploadUrl: string; storageKey: string }>(`${base(projectId)}/upload-url`, { filename: file.name });
  await axios.put(uploadUrl, file, { headers: { 'Content-Type': 'application/octet-stream' } });
  return apiPost<GisPrepJob>(`${base(projectId)}/jobs`, { storageKey, originalFilename: file.name, settings });
}
