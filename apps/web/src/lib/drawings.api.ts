import axios from 'axios';
import { apiGet, apiPost, apiDelete } from './api';

// A pin is a place someone marked on a drawing — it can exist before any
// photo does. Distinct from the legacy per-photo FloorPlanPin below.
export interface Pin {
  locationId: string;
  name: string;
  description?: string;
  posXNorm: number;
  posYNorm: number;
  createdVia: 'manual' | 'floor_plan_tap';
  createdAt: string;
  captureCount: number;
  latestCapturedAt?: string;
  thumbnailUrl?: string;
  compassHeadingDeg?: number;
  elementId?: string;
  elementName?: string;
  elementIfcType?: string;
  elementGuid?: string;
  elementModelId?: string;
}

export function createPin(projectId: string, drawingId: string, payload: { posXNorm: number; posYNorm: number; name?: string }) {
  return apiPost<Pin>(`/projects/${projectId}/drawings/${drawingId}/pins`, payload);
}

export function getPins(projectId: string, drawingId: string) {
  return apiGet<Pin[]>(`/projects/${projectId}/drawings/${drawingId}/pins`);
}

export interface ProjectPinResult {
  locationId: string;
  name: string;
  drawingId: string;
  drawingTitle: string;
}

export function searchProjectPins(projectId: string, search?: string) {
  return apiGet<ProjectPinResult[]>(`/projects/${projectId}/drawings/pins/search`, { params: { search } });
}

export interface Drawing {
  id: string;
  projectId: string;
  levelId?: string;
  title: string;
  storageKey: string;
  widthPx?: number;
  heightPx?: number;
  scaleRatio?: string;
  scalePxPerM?: number;
  isCurrent: boolean;
  linkedCaptureCount?: number;
  downloadUrl?: string;
}

export interface FloorPlanPin {
  posXNorm: number;
  posYNorm: number;
  captureId: string;
  locationId: string;
  captureType: string;
  capturedAt: string;
  phase?: string;
  title?: string;
  compassHeadingDeg?: number;
  thumbnailUrl?: string;
}

export interface FloorPlanData {
  drawing: Drawing;
  pins: FloorPlanPin[];
}

export function listDrawings(projectId: string, levelId?: string) {
  return apiGet<Drawing[]>(`/projects/${projectId}/drawings`, { params: levelId ? { levelId } : undefined });
}

export function getDrawing(projectId: string, drawingId: string) {
  return apiGet<Drawing>(`/projects/${projectId}/drawings/${drawingId}`);
}

export function getFloorPlanData(projectId: string, drawingId: string) {
  return apiGet<FloorPlanData>(`/projects/${projectId}/drawings/${drawingId}/floor-plan`);
}

export function linkCaptureToDrawing(
  projectId: string,
  drawingId: string,
  payload: { captureId: string; posXNorm: number; posYNorm: number },
) {
  return apiPost<unknown>(`/projects/${projectId}/drawings/${drawingId}/link-capture`, payload);
}

export function unlinkCaptureFromDrawing(projectId: string, drawingId: string, captureId: string) {
  return apiDelete<void>(`/projects/${projectId}/drawings/${drawingId}/captures/${captureId}`);
}

export async function uploadDrawing(
  projectId: string,
  file: File,
  meta: { title: string; levelId?: string; locationId?: string; widthPx?: number; heightPx?: number },
): Promise<Drawing> {
  const { uploadUrl, storageKey } = await apiPost<{ uploadUrl: string; storageKey: string; expiresIn: number }>(
    `/projects/${projectId}/drawings/upload-url`,
    { filename: file.name },
  );

  await axios.put(uploadUrl, file, { headers: { 'Content-Type': file.type || 'application/pdf' } });

  return apiPost<Drawing>(`/projects/${projectId}/drawings`, {
    storageKey,
    title: meta.title,
    levelId: meta.levelId,
    locationId: meta.locationId,
    widthPx: meta.widthPx,
    heightPx: meta.heightPx,
  });
}
