import axios from 'axios';
import type {
  Rfi, RfiStatus, RfiPriority, RfiDiscipline, RfiImpactLevel, RfiWorkflowStatus,
  RfiAttachmentKind, RfiDocumentType, ProjectOrganizationSlot,
} from '@engineeringos/types';
import { apiGet, apiGetWithMeta, apiPost, apiPatch, apiDelete } from './api';

// Rfi.status stays RfiStatus (legacy-only) in the shared types package --
// see the comment on Rfi.status in packages/types/src/rfi.types.ts for why.
// Every endpoint here can hand back a row carrying the wider workflow
// vocabulary (submit/requestClarification/respond/close/reopen all write
// new statuses), so this frontend-only type widens just that one field for
// every page that needs to render/compare against the full vocabulary.
export type RfiListItem = Omit<Rfi, 'status'> & { status: RfiWorkflowStatus };

export interface RfiSummary {
  total: number;
  open: number;
  answered: number;
  overdue: number;
}

export interface RfiFilters {
  status?: string;
  priority?: string;
  discipline?: string;
  costImpactLevel?: string;
  timeImpactLevel?: string;
  assignedTo?: string;
  dateFrom?: string;
  dateTo?: string;
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
  // Legacy boolean shape -- still accepted by the backend for compatibility.
  costImpact?: boolean;
  timeImpact?: boolean;
  // 4-state shape (Phase 1 backend, wired up in this ticket).
  costImpactLevel?: RfiImpactLevel;
  costImpactAmount?: number;
  costImpactCurrency?: string;
  costImpactDescription?: string;
  timeImpactLevel?: RfiImpactLevel;
  timeImpactDays?: number;
  timeImpactDescription?: string;
  assignedTo?: string;
  dueDate?: string;
}

export function createRfi(projectId: string, payload: CreateRfiPayload) {
  return apiPost<RfiListItem>(`/projects/${projectId}/rfis`, payload);
}

export interface UpdateRfiPayload {
  subject?: string;
  question?: string;
  answer?: string;
  // PATCH only ever accepts the legacy status vocabulary -- the widened
  // workflow statuses are only reachable through the dedicated
  // submit/requestClarification/respond/close/reopen endpoints below (see
  // UpdateRfiDto in apps/api, unchanged in this ticket).
  status?: RfiStatus;
  priority?: RfiPriority;
  discipline?: RfiDiscipline;
  disciplineOther?: string;
  costImpact?: boolean;
  timeImpact?: boolean;
  costImpactLevel?: RfiImpactLevel;
  costImpactAmount?: number;
  costImpactCurrency?: string;
  costImpactDescription?: string;
  timeImpactLevel?: RfiImpactLevel;
  timeImpactDays?: number;
  timeImpactDescription?: string;
  assignedTo?: string;
  dueDate?: string;
}

export function updateRfi(projectId: string, rfiId: string, payload: UpdateRfiPayload) {
  return apiPatch<RfiListItem>(`/projects/${projectId}/rfis/${rfiId}`, payload);
}

export function deleteRfi(projectId: string, rfiId: string) {
  return apiDelete<{ message: string }>(`/projects/${projectId}/rfis/${rfiId}`);
}

// ── Workflow (Phase 3 -- wiring up the Phase 1 backend endpoints) ─────────
export function submitRfi(projectId: string, rfiId: string) {
  return apiPost<RfiListItem>(`/projects/${projectId}/rfis/${rfiId}/submit`);
}

export function requestClarification(projectId: string, rfiId: string, reason: string) {
  return apiPost<RfiListItem>(`/projects/${projectId}/rfis/${rfiId}/request-clarification`, { reason });
}

export function respondToRfi(projectId: string, rfiId: string, answer: string) {
  return apiPost<RfiListItem>(`/projects/${projectId}/rfis/${rfiId}/respond`, { answer });
}

export function closeRfi(projectId: string, rfiId: string) {
  return apiPost<RfiListItem>(`/projects/${projectId}/rfis/${rfiId}/close`);
}

export function reopenRfi(projectId: string, rfiId: string) {
  return apiPost<RfiListItem>(`/projects/${projectId}/rfis/${rfiId}/reopen`);
}

// ── Comments (Phase 2 backend, wired up here) ──────────────────────────────
export interface RfiComment {
  id: string;
  rfiId: string;
  companyId: string;
  userId: string;
  userName?: string;
  organizationSlot?: ProjectOrganizationSlot;
  body: string;
  createdAt: string;
}

export function addRfiComment(
  projectId: string,
  rfiId: string,
  payload: { body: string; organizationSlot?: ProjectOrganizationSlot },
) {
  return apiPost<RfiComment>(`/projects/${projectId}/rfis/${rfiId}/comments`, payload);
}

export function getRfiComments(projectId: string, rfiId: string) {
  return apiGet<RfiComment[]>(`/projects/${projectId}/rfis/${rfiId}/comments`);
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
  kind?: RfiAttachmentKind;
  documentType?: RfiDocumentType;
  documentTypeOther?: string;
  revision?: string;
  description?: string;
  commentId?: string;
}

export function getRfiAttachmentUploadUrl(projectId: string, rfiId: string, filename: string, sizeBytes: number) {
  return apiPost<{ uploadUrl: string; storageKey: string }>(
    `/projects/${projectId}/rfis/${rfiId}/attachments/upload-url`,
    { filename, sizeBytes },
  );
}

export interface AddRfiAttachmentPayload {
  storageKey: string;
  filename: string;
  sizeBytes: number;
  kind?: RfiAttachmentKind;
  documentType?: RfiDocumentType;
  documentTypeOther?: string;
  revision?: string;
  description?: string;
  commentId?: string;
}

export function addRfiAttachment(projectId: string, rfiId: string, payload: AddRfiAttachmentPayload) {
  return apiPost<RfiAttachment>(`/projects/${projectId}/rfis/${rfiId}/attachments`, payload);
}

export function getRfiAttachments(projectId: string, rfiId: string) {
  return apiGet<RfiAttachment[]>(`/projects/${projectId}/rfis/${rfiId}/attachments`);
}

export function deleteRfiAttachment(projectId: string, rfiId: string, attachmentId: string) {
  return apiDelete<{ message: string }>(`/projects/${projectId}/rfis/${rfiId}/attachments/${attachmentId}`);
}

// Full client-side flow: request the presigned URL, PUT the file straight
// to storage, then register it as an rfi_attachments row. `extra` carries
// the Phase 2 kind/documentType/etc. fields -- optional so this still works
// exactly as before for any caller that doesn't pass them.
export async function uploadRfiAttachment(
  projectId: string,
  rfiId: string,
  file: File,
  extra?: Omit<AddRfiAttachmentPayload, 'storageKey' | 'filename' | 'sizeBytes'>,
): Promise<RfiAttachment> {
  const { uploadUrl, storageKey } = await getRfiAttachmentUploadUrl(projectId, rfiId, file.name, file.size);
  await axios.put(uploadUrl, file, { headers: { 'Content-Type': file.type || 'application/octet-stream' } });
  return addRfiAttachment(projectId, rfiId, { storageKey, filename: file.name, sizeBytes: file.size, ...extra });
}
