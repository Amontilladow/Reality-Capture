import axios from 'axios';
import type { RfiDiscipline } from '@engineeringos/types';
import { apiGet, apiGetWithMeta, apiPost, apiDelete } from './api';

export type QaqcRecordType = 'ncr' | 'sor';
export type QaqcPriority = 'critical' | 'high' | 'medium' | 'low';
export type QaqcStatus = 'open' | 'responded' | 'closed' | 'void';
export type QaqcAttachmentKind = 'issue' | 'response';

// Field set mirrors RfiListItem's own shape (same shared Discipline
// vocabulary, same assignee/location-name join convention) -- see
// qaqc.service.ts's findAll()/findOne() SELECT for the exact source columns.
export interface QaqcRecord {
  id: string;
  companyId: string;
  projectId: string;
  recordType: QaqcRecordType;
  recordNumber?: string;
  subject: string;
  description: string;
  discipline: RfiDiscipline;
  disciplineOther?: string;
  priority: QaqcPriority;
  status: QaqcStatus;
  locationId?: string;
  locationName?: string;
  assignedTo?: string;
  assignedToName?: string;
  dueDate?: string;
  response?: string;
  issuedBy: string;
  issuedByName?: string;
  closedBy?: string;
  closedByName?: string;
  closedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface QaqcSummary {
  total: number;
  ncrTotal: number;
  sorTotal: number;
  ncrOpen: number;
  sorOpen: number;
  ncrClosed: number;
  sorClosed: number;
  critical: number;
  overdue: number;
}

export interface QaqcFilters {
  recordType?: QaqcRecordType;
  status?: string;
  priority?: string;
  discipline?: string;
  assignedTo?: string;
  page?: number;
  perPage?: number;
}

export function listQaqcRecords(projectId: string, filters?: QaqcFilters) {
  return apiGetWithMeta<QaqcRecord[]>(`/projects/${projectId}/qaqc`, { params: filters });
}

export function getQaqcSummary(projectId: string) {
  return apiGet<QaqcSummary>(`/projects/${projectId}/qaqc/summary`);
}

export function getQaqcRecord(projectId: string, qaqcId: string) {
  return apiGet<QaqcRecord>(`/projects/${projectId}/qaqc/${qaqcId}`);
}

export interface CreateQaqcPayload {
  recordType: QaqcRecordType;
  subject: string;
  description: string;
  priority?: QaqcPriority;
  discipline: RfiDiscipline;
  disciplineOther?: string;
  locationId?: string;
  assignedTo?: string;
  dueDate?: string;
}

export function createQaqcRecord(projectId: string, payload: CreateQaqcPayload) {
  return apiPost<QaqcRecord>(`/projects/${projectId}/qaqc`, payload);
}

export function closeQaqcRecord(projectId: string, qaqcId: string, response: string) {
  return apiPost<QaqcRecord>(`/projects/${projectId}/qaqc/${qaqcId}/close`, { response });
}

// ── Attachments (same presigned-PUT flow as rfis.api.ts's) ────────────────
export interface QaqcAttachment {
  id: string;
  qaqcId: string;
  companyId: string;
  kind: QaqcAttachmentKind;
  storageKey: string;
  filename: string;
  sizeBytes: number | string;
  uploadedBy: string;
  uploadedByName?: string;
  uploadedAt: string;
  attachmentReadUrl?: string;
}

export function getQaqcAttachmentUploadUrl(projectId: string, qaqcId: string, filename: string, sizeBytes: number) {
  return apiPost<{ uploadUrl: string; storageKey: string }>(
    `/projects/${projectId}/qaqc/${qaqcId}/attachments/upload-url`,
    { filename, sizeBytes },
  );
}

export interface AddQaqcAttachmentPayload {
  storageKey: string;
  filename: string;
  sizeBytes: number;
  kind?: QaqcAttachmentKind;
}

export function addQaqcAttachment(projectId: string, qaqcId: string, payload: AddQaqcAttachmentPayload) {
  return apiPost<QaqcAttachment>(`/projects/${projectId}/qaqc/${qaqcId}/attachments`, payload);
}

export function getQaqcAttachments(projectId: string, qaqcId: string) {
  return apiGet<QaqcAttachment[]>(`/projects/${projectId}/qaqc/${qaqcId}/attachments`);
}

export function deleteQaqcAttachment(projectId: string, qaqcId: string, attachmentId: string) {
  return apiDelete<{ message: string }>(`/projects/${projectId}/qaqc/${qaqcId}/attachments/${attachmentId}`);
}

// Full client-side flow: request the presigned URL, PUT the file straight
// to storage, then register it as a qaqc_attachments row -- identical
// shape to uploadRfiAttachment() in rfis.api.ts.
export async function uploadQaqcAttachment(
  projectId: string,
  qaqcId: string,
  file: File,
  kind: QaqcAttachmentKind = 'issue',
): Promise<QaqcAttachment> {
  const { uploadUrl, storageKey } = await getQaqcAttachmentUploadUrl(projectId, qaqcId, file.name, file.size);
  await axios.put(uploadUrl, file, { headers: { 'Content-Type': file.type || 'application/octet-stream' } });
  return addQaqcAttachment(projectId, qaqcId, { storageKey, filename: file.name, sizeBytes: file.size, kind });
}
