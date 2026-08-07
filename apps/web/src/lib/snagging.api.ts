import type { SnagItem, SnagStatus, SnagPriority } from '@engineeringos/types';
import { apiGet, apiGetWithMeta, apiPost, apiPatch, apiDelete } from './api';

export interface SnagListItem extends SnagItem {
  createdByName?: string;
  assignedToName?: string;
}

export interface SnagSummary {
  total: number;
  open: number;
  fixed: number;
  verified: number;
  overdue: number;
}

export interface SnagFilters {
  status?: string;
  priority?: string;
  page?: number;
  perPage?: number;
}

export function listSnagItems(projectId: string, filters?: SnagFilters) {
  return apiGetWithMeta<SnagListItem[]>(`/projects/${projectId}/snag-items`, { params: filters });
}

export function getSnagSummary(projectId: string) {
  return apiGet<SnagSummary>(`/projects/${projectId}/snag-items/summary`);
}

export function getSnagItem(projectId: string, snagId: string) {
  return apiGet<SnagListItem>(`/projects/${projectId}/snag-items/${snagId}`);
}

export interface CreateSnagPayload {
  title: string;
  description?: string;
  location?: string;
  trade?: string;
  priority?: SnagPriority;
  assignedTo?: string;
  dueDate?: string;
}

export function createSnagItem(projectId: string, payload: CreateSnagPayload) {
  return apiPost<SnagItem>(`/projects/${projectId}/snag-items`, payload);
}

export interface UpdateSnagPayload {
  title?: string;
  description?: string;
  location?: string;
  trade?: string;
  priority?: SnagPriority;
  status?: SnagStatus;
  assignedTo?: string;
  dueDate?: string;
}

export function updateSnagItem(projectId: string, snagId: string, payload: UpdateSnagPayload) {
  return apiPatch<SnagItem>(`/projects/${projectId}/snag-items/${snagId}`, payload);
}

export function deleteSnagItem(projectId: string, snagId: string) {
  return apiDelete<{ message: string }>(`/projects/${projectId}/snag-items/${snagId}`);
}
