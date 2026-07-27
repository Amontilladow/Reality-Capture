import type {
  Capture, CaptureType, ProjectPhase, Hotspot, PaginationQuery,
  UploadUrlRequest, UploadUrlResponse, RegisterCaptureDto,
} from '@engineeringos/types';
import axios from 'axios';
import { apiGet, apiGetWithMeta, apiPost, apiPatch, apiDelete } from './api';

export function listCaptures(
  projectId: string,
  query?: PaginationQuery & { locationId?: string; phase?: string; captureType?: string; status?: string },
) {
  return apiGetWithMeta<Capture[]>(`/projects/${projectId}/captures`, { params: query });
}

export function getCapture(projectId: string, captureId: string) {
  return apiGet<Capture>(`/projects/${projectId}/captures/${captureId}`);
}

export function getUploadUrl(projectId: string, payload: UploadUrlRequest) {
  return apiPost<UploadUrlResponse>(`/projects/${projectId}/captures/upload-url`, payload);
}

export function registerCapture(projectId: string, payload: RegisterCaptureDto) {
  return apiPost<Capture>(`/projects/${projectId}/captures`, payload);
}

export function updateCapture(projectId: string, captureId: string, payload: Partial<RegisterCaptureDto>) {
  return apiPatch<Capture>(`/projects/${projectId}/captures/${captureId}`, payload);
}

export function deleteCapture(projectId: string, captureId: string) {
  return apiDelete<void>(`/projects/${projectId}/captures/${captureId}`);
}

export function getViewerData(projectId: string, locationId: string) {
  return apiGet<Capture[]>(`/projects/${projectId}/captures/viewer/${locationId}`);
}

export function createHotspot(
  projectId: string,
  captureId: string,
  payload: Partial<Hotspot> & { yawDeg: number; pitchDeg: number },
) {
  return apiPost<Hotspot>(`/projects/${projectId}/captures/${captureId}/hotspots`, payload);
}

export function updateHotspot(projectId: string, captureId: string, hotspotId: string, payload: Partial<Hotspot>) {
  return apiPatch<Hotspot>(`/projects/${projectId}/captures/${captureId}/hotspots/${hotspotId}`, payload);
}

export function deleteHotspot(projectId: string, captureId: string, hotspotId: string) {
  return apiDelete<void>(`/projects/${projectId}/captures/${captureId}/hotspots/${hotspotId}`);
}

/**
 * Full direct-to-S3 upload flow:
 * 1. Ask the API for a presigned PUT URL
 * 2. PUT the raw file bytes straight to storage (never through our API server)
 * 3. Register the capture record with the storage key returned in step 1
 */
export async function uploadCapture(
  projectId: string,
  file: File,
  meta: {
    captureType: CaptureType;
    locationId?: string;
    phase?: ProjectPhase;
    title?: string;
    description?: string;
    capturedAt?: string;
  },
  onProgress?: (pct: number) => void,
): Promise<Capture> {
  const uploadUrlRes = await getUploadUrl(projectId, {
    filename: file.name,
    mimeType: file.type || 'application/octet-stream',
    sizeBytes: file.size,
    captureType: meta.captureType,
    locationId: meta.locationId,
  });

  await axios.put(uploadUrlRes.uploadUrl, file, {
    headers: { 'Content-Type': file.type || 'application/octet-stream' },
    onUploadProgress: (evt) => {
      if (onProgress && evt.total) onProgress(Math.round((evt.loaded / evt.total) * 100));
    },
  });

  return registerCapture(projectId, {
    storageKey: uploadUrlRes.storageKey,
    originalSizeBytes: file.size,
    originalMimeType: file.type || 'application/octet-stream',
    captureType: meta.captureType,
    capturedAt: meta.capturedAt ?? new Date().toISOString(),
    locationId: meta.locationId,
    phase: meta.phase,
    title: meta.title,
    description: meta.description,
  });
}
