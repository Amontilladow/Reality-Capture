import type { QaInspection, QaInspectionStatus } from '@engineeringos/types';
import { apiGet, apiGetWithMeta, apiPost, apiPatch, apiDelete } from './api';

export interface QaInspectionListItem extends QaInspection {
  createdByName?: string;
  assignedToName?: string;
}

export interface QaSummary {
  total: number;
  pending: number;
  passed: number;
  failed: number;
}

export interface QaFilters {
  status?: string;
  page?: number;
  perPage?: number;
}

export function listInspections(projectId: string, filters?: QaFilters) {
  return apiGetWithMeta<QaInspectionListItem[]>(`/projects/${projectId}/qa-inspections`, { params: filters });
}

export function getQaSummary(projectId: string) {
  return apiGet<QaSummary>(`/projects/${projectId}/qa-inspections/summary`);
}

export function getInspection(projectId: string, inspectionId: string) {
  return apiGet<QaInspectionListItem>(`/projects/${projectId}/qa-inspections/${inspectionId}`);
}

export interface CreateInspectionPayload {
  title: string;
  inspectionType?: string;
  location?: string;
  checklist: string;
  assignedTo?: string;
  inspectionDate?: string;
}

export function createInspection(projectId: string, payload: CreateInspectionPayload) {
  return apiPost<QaInspection>(`/projects/${projectId}/qa-inspections`, payload);
}

export interface UpdateInspectionPayload {
  title?: string;
  inspectionType?: string;
  location?: string;
  checklist?: string;
  findings?: string;
  status?: QaInspectionStatus;
  assignedTo?: string;
  inspectionDate?: string;
}

export function updateInspection(projectId: string, inspectionId: string, payload: UpdateInspectionPayload) {
  return apiPatch<QaInspection>(`/projects/${projectId}/qa-inspections/${inspectionId}`, payload);
}

export function deleteInspection(projectId: string, inspectionId: string) {
  return apiDelete<{ message: string }>(`/projects/${projectId}/qa-inspections/${inspectionId}`);
}
