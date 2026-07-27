import * as FileSystem from 'expo-file-system';
import type { Capture, CaptureType, ProjectPhase, PaginationQuery, UploadUrlRequest, UploadUrlResponse, RegisterCaptureDto } from '@engineeringos/types';
import { apiGet, apiGetWithMeta, apiPost } from './api';

export function listCaptures(projectId: string, query?: PaginationQuery & { locationId?: string }) {
  return apiGetWithMeta<Capture[]>(`/projects/${projectId}/captures`, { params: query });
}

export function getViewerData(projectId: string, locationId: string) {
  return apiGet<Capture[]>(`/projects/${projectId}/captures/viewer/${locationId}`);
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

/**
 * Uploads a file already sitting on local disk (from the offline queue) straight to
 * S3/MinIO via a presigned PUT, then registers the capture. Used by the background
 * sync engine — separate from the web client's File-object upload because React
 * Native only gives us a file:// URI, not a Blob, for camera-captured media.
 */
export async function uploadLocalFile(
  projectId: string,
  localUri: string,
  mimeType: string,
  sizeBytes: number,
  meta: {
    captureType: CaptureType;
    locationId?: string | null;
    phase?: ProjectPhase | null;
    title?: string | null;
    description?: string | null;
    capturedAt: string;
    gpsLat?: number | null;
    gpsLng?: number | null;
    gpsAccuracyM?: number | null;
    compassHeadingDeg?: number | null;
  },
): Promise<Capture> {
  const filename = localUri.split('/').pop() ?? `capture-${Date.now()}`;

  const uploadUrlRes = await getUploadUrl(projectId, {
    filename,
    mimeType,
    sizeBytes,
    captureType: meta.captureType,
    locationId: meta.locationId ?? undefined,
  });

  const uploadResult = await FileSystem.uploadAsync(uploadUrlRes.uploadUrl, localUri, {
    httpMethod: 'PUT',
    uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
    headers: { 'Content-Type': mimeType },
  });

  if (uploadResult.status < 200 || uploadResult.status >= 300) {
    throw new Error(`Storage upload failed (HTTP ${uploadResult.status})`);
  }

  return registerCapture(projectId, {
    storageKey: uploadUrlRes.storageKey,
    originalSizeBytes: sizeBytes,
    originalMimeType: mimeType,
    captureType: meta.captureType,
    capturedAt: meta.capturedAt,
    locationId: meta.locationId ?? undefined,
    phase: meta.phase ?? undefined,
    title: meta.title ?? undefined,
    description: meta.description ?? undefined,
    gpsLat: meta.gpsLat ?? undefined,
    gpsLng: meta.gpsLng ?? undefined,
    gpsAccuracyM: meta.gpsAccuracyM ?? undefined,
    compassHeadingDeg: meta.compassHeadingDeg ?? undefined,
  });
}
