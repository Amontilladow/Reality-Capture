import type { Rfi, RfiStatus, RfiPriority, RfiDiscipline } from '@engineeringos/types';
import { apiGet, apiGetWithMeta, apiPost, apiPatch, apiDelete } from './api';

export type RfiListItem = Rfi;

export interface RfiSummary {
  total: number;
  open: number;
  answered: number;
  overdue: number;
}

export interface RfiFilters {
  status?: string;
  priority?: string;
  page?: number;
  perPage?: number;
}

export function listRfis(projectId: string, filters?: RfiFilters) {
  return apiGetWithMeta<RfiListItem[]>(`/projects/${projectId}/rfis`, { params: filters });
}

export function getRfiSummary(projectId: string) {
  return apiGet<RfiSummary>(`/projects/${projectId}/rfis/summary`);
}

export function getRfi(projectId: string, rfiId: string) {
  return apiGet<RfiListItem>(`/projects/${projectId}/rfis/${rfiId}`);
}

export interface CreateRfiPayload {
  subject: string;
  question: string;
  priority?: RfiPriority;
  discipline: RfiDiscipline;
  disciplineOther?: string;
  costImpact?: boolean;
  timeImpact?: boolean;
  assignedTo?: string;
  dueDate?: string;
}

export function createRfi(projectId: string, payload: CreateRfiPayload) {
  return apiPost<Rfi>(`/projects/${projectId}/rfis`, payload);
}

export interface UpdateRfiPayload {
  subject?: string;
  question?: string;
  answer?: string;
  status?: RfiStatus;
  priority?: RfiPriority;
  discipline?: RfiDiscipline;
  disciplineOther?: string;
  costImpact?: boolean;
  timeImpact?: boolean;
  assignedTo?: string;
  dueDate?: string;
}

export function updateRfi(projectId: string, rfiId: string, payload: UpdateRfiPayload) {
  return apiPatch<Rfi>(`/projects/${projectId}/rfis/${rfiId}`, payload);
}

export function deleteRfi(projectId: string, rfiId: string) {
  return apiDelete<{ message: string }>(`/projects/${projectId}/rfis/${rfiId}`);
}
