import axios from 'axios';
import { apiGet, apiGetWithMeta, apiPatch, apiPost } from './api';

export interface BimModel {
  id: string;
  name: string;
  format: string;
  status: 'pending' | 'processing' | 'ready' | 'failed';
  processingStage: string | null;
  processingProgress: number;
  processingError: string | null;
  elementCount: number | null;
  uploadedByName?: string;
  createdAt: string;
}

export interface BimModelStatus {
  id: string;
  status: string;
  processingStage: string | null;
  processingProgress: number;
  processingError: string | null;
  elementCount: number | null;
  parsedAt: string | null;
}

export interface BimModelViewerData {
  status: string;
  fragmentsUrl: string | null;
  processingError: string | null;
}

export interface BimSpatialNode {
  id: string;
  parentId: string | null;
  ifcGuid: string;
  ifcType: string;
  name: string | null;
  elevation: number | null;
  elementCount: number;
}

export interface BimElementQuantity {
  quantitySet: string | null;
  name: string;
  quantityType: string | null;
  value: number | null;
  unit: string | null;
}

export interface BimElementMaterial {
  name: string;
  category: string | null;
}

export interface BimElementClassification {
  system: string;
  code: string | null;
  name: string | null;
}

export interface BimElementDetail {
  id: string;
  ifcGuid: string;
  ifcType: string;
  ifcName: string | null;
  ifcDescription: string | null;
  modelName?: string;
  spatialNodeName?: string | null;
  spatialNodeType?: string | null;
  constructionStatus: string | null;
  properties: Record<string, unknown>;
  quantities: BimElementQuantity[];
  materials: BimElementMaterial[];
  classifications: BimElementClassification[];
  linkedPin: { locationId: string; name: string; drawingId: string; linkedRecord: { type: 'issue' | 'snag'; id: string } | null } | null;
}

export function listBimModels(projectId: string) {
  return apiGet<BimModel[]>(`/projects/${projectId}/bim/models`);
}

export function getModelUploadUrl(projectId: string, filename: string) {
  return apiPost<{ uploadUrl: string; storageKey: string }>(
    `/projects/${projectId}/bim/models/upload-url`,
    { filename },
  );
}

export function registerBimModel(projectId: string, dto: { name: string; storageKey: string; format?: string; originalFilename?: string }) {
  return apiPost<BimModel>(`/projects/${projectId}/bim/models`, dto);
}

export async function uploadBimModel(
  projectId: string,
  file: File,
  name: string,
  onProgress?: (pct: number) => void,
): Promise<BimModel> {
  const { uploadUrl, storageKey } = await getModelUploadUrl(projectId, file.name);
  await axios.put(uploadUrl, file, {
    headers: { 'Content-Type': 'application/octet-stream' },
    onUploadProgress: (evt) => {
      if (onProgress && evt.total) onProgress(Math.round((evt.loaded / evt.total) * 100));
    },
  });
  return registerBimModel(projectId, { name, storageKey, format: 'IFC', originalFilename: file.name });
}

export function getModelStatus(projectId: string, modelId: string) {
  return apiGet<BimModelStatus>(`/projects/${projectId}/bim/models/${modelId}/status`);
}

export function reprocessModel(projectId: string, modelId: string) {
  return apiPost<BimModelStatus>(`/projects/${projectId}/bim/models/${modelId}/reprocess`);
}

export function getModelViewerData(projectId: string, modelId: string) {
  return apiGet<BimModelViewerData>(`/projects/${projectId}/bim/models/${modelId}/viewer-data`);
}

export function getModelHierarchy(projectId: string, modelId: string) {
  return apiGet<BimSpatialNode[]>(`/projects/${projectId}/bim/models/${modelId}/hierarchy`);
}

export function getElement(projectId: string, elementId: string) {
  return apiGet<BimElementDetail>(`/projects/${projectId}/bim/elements/${elementId}`);
}

export function getElementByGuid(projectId: string, modelId: string, guid: string) {
  return apiGet<BimElementDetail>(`/projects/${projectId}/bim/models/${modelId}/elements/by-guid/${guid}`);
}

export function listElements(
  projectId: string,
  query?: { page?: number; perPage?: number; modelId?: string; ifcType?: string; search?: string },
) {
  return apiGetWithMeta<BimElementDetail[]>(`/projects/${projectId}/bim/elements`, { params: query });
}

export function updateElementStatus(projectId: string, elementId: string, status: string) {
  return apiPatch<BimElementDetail>(`/projects/${projectId}/bim/elements/${elementId}/status`, { status });
}

export interface ElementCapture {
  id: string;
  captureType: string;
  capturedAt: string;
  phase: string | null;
  title: string | null;
  status: string;
  linkType: string | null;
  capturedByName?: string;
}

export function getCapturesForElement(projectId: string, elementId: string) {
  return apiGet<ElementCapture[]>(`/projects/${projectId}/bim/elements/${elementId}/captures`);
}

export interface ElementIssue {
  id: string;
  issueNumber: string;
  title: string;
  status: string;
  priority: string;
  assignedToName?: string;
}

export function getIssuesForElement(elementId: string) {
  return apiGet<ElementIssue[]>(`/elements/${elementId}/issues`);
}

export function createPinForElement(projectId: string, elementId: string, name: string) {
  return apiPost<{ id: string; name: string; elementId: string }>(
    `/projects/${projectId}/bim/elements/${elementId}/pins`,
    { name },
  );
}
