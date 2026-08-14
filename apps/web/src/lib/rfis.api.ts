import axios from 'axios';
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

// ── Attachments (presigned-PUT, same shape as issues.api.ts's) ────────────
export interface RfiAttachment {
  id: string;
  rfiId: string;
  storageKey: string;
  filename: string;
  sizeBytes: number | string;
  uploadedBy: string;
  uploadedByName?: string;
  uploadedAt: string;
  attachmentReadUrl?: string;
}

export function getRfiAttachmentUploadUrl(projectId: string, rfiId: string, filename: string, sizeBytes: number) {
  return apiPost<{ uploadUrl: string; storageKey: string }>(
    `/projects/${projectId}/rfis/${rfiId}/attachments/upload-url`,
    { filename, sizeBytes },
  );
}

export function addRfiAttachment(
  projectId: string,
  rfiId: string,
  payload: { storageKey: string; filename: string; sizeBytes: number },
) {
  return apiPost<RfiAttachment>(`/projects/${projectId}/rfis/${rfiId}/attachments`, payload);
}

export function getRfiAttachments(projectId: string, rfiId: string) {
  return apiGet<RfiAttachment[]>(`/projects/${projectId}/rfis/${rfiId}/attachments`);
}

export function deleteRfiAttachment(projectId: string, rfiId: string, attachmentId: string) {
  return apiDelete<{ message: string }>(`/projects/${projectId}/rfis/${rfiId}/attachments/${attachmentId}`);
}

// Full client-side flow: request the presigned URL, PUT the file straight
// to storage, then register it as an rfi_attachments row.
export async function uploadRfiAttachment(projectId: string, rfiId: string, file: File): Promise<RfiAttachment> {
  const { uploadUrl, storageKey } = await getRfiAttachmentUploadUrl(projectId, rfiId, file.name, file.size);
  await axios.put(uploadUrl, file, { headers: { 'Content-Type': file.type || 'application/octet-stream' } });
  return addRfiAttachment(projectId, rfiId, { storageKey, filename: file.name, sizeBytes: file.size });
}
