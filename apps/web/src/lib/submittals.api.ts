import type { Submittal, SubmittalStatus, SubmittalPriority } from '@engineeringos/types';
import { apiGet, apiGetWithMeta, apiPost, apiPatch, apiDelete } from './api';

export interface SubmittalListItem extends Submittal {
  createdByName?: string;
  assignedToName?: string;
}

export interface SubmittalSummary {
  total: number;
  pending: number;
  approved: number;
  overdue: number;
}

export interface SubmittalFilters {
  status?: string;
  priority?: string;
  page?: number;
  perPage?: number;
}

export function listSubmittals(projectId: string, filters?: SubmittalFilters) {
  return apiGetWithMeta<SubmittalListItem[]>(`/projects/${projectId}/submittals`, { params: filters });
}

export function getSubmittalSummary(projectId: string) {
  return apiGet<SubmittalSummary>(`/projects/${projectId}/submittals/summary`);
}

export function getSubmittal(projectId: string, submittalId: string) {
  return apiGet<SubmittalListItem>(`/projects/${projectId}/submittals/${submittalId}`);
}

export interface CreateSubmittalPayload {
  title: string;
  specSection?: string;
  description?: string;
  priority?: SubmittalPriority;
  discipline?: string;
  revision?: string;
  assignedTo?: string;
  dueDate?: string;
}

export function createSubmittal(projectId: string, payload: CreateSubmittalPayload) {
  return apiPost<Submittal>(`/projects/${projectId}/submittals`, payload);
}

export interface UpdateSubmittalPayload {
  title?: string;
  specSection?: string;
  description?: string;
  status?: SubmittalStatus;
  priority?: SubmittalPriority;
  discipline?: string;
  revision?: string;
  assignedTo?: string;
  dueDate?: string;
  reviewComments?: string;
}

export function updateSubmittal(projectId: string, submittalId: string, payload: UpdateSubmittalPayload) {
  return apiPatch<Submittal>(`/projects/${projectId}/submittals/${submittalId}`, payload);
}

export function deleteSubmittal(projectId: string, submittalId: string) {
  return apiDelete<{ message: string }>(`/projects/${projectId}/submittals/${submittalId}`);
}
