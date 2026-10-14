import axios from 'axios';
import type { RfiDiscipline, RfiDocumentType } from '@engineeringos/types';
import { apiGet, apiGetWithMeta, apiPost, apiDelete } from './api';

export type QaqcRecordType = 'ncr' | 'sor' | 'wir' | 'mir';
export type QaqcPriority = 'critical' | 'high' | 'medium' | 'low';
// Two-step close: 'open' (issued, awaiting a response) -> 'pending_confirmation'
// (responded, awaiting QAQC's confirmation) -> 'closed' (QAQC confirmed,
// terminal) or 'reopened' (QAQC rejected the response -- can be responded
// to again, functionally like 'open').
export type QaqcStatus = 'open' | 'pending_confirmation' | 'closed' | 'reopened';
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
  respondedBy?: string;
  respondedByName?: string;
  respondedAt?: string;
  confirmationComment?: string;
  issuedBy: string;
  issuedByName?: string;
  confirmedBy?: string;
  confirmedByName?: string;
  confirmedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface QaqcSummary {
  total: number;
  ncrTotal: number;
  sorTotal: number;
  wirTotal: number;
  mirTotal: number;
  ncrOpen: number;
  sorOpen: number;
  wirOpen: number;
  mirOpen: number;
  pendingConfirmation: number;
  ncrClosed: number;
  sorClosed: number;
  wirClosed: number;
  mirClosed: number;
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

// ── Two-step close ─────────────────────────────────────────────────────────
// Step 1: construction/PM/director/engineering (or admin) responds. Moves
// open/reopened -> pending_confirmation. Distinct from closeQaqcRecord --
// there is no such thing anymore; see confirmQaqcRecord for the step that
// actually finalizes it.
export function respondToQaqcRecord(projectId: string, qaqcId: string, response: string) {
  return apiPost<QaqcRecord>(`/projects/${projectId}/qaqc/${qaqcId}/respond`, { response });
}

// Step 2: QAQC-in-charge (or admin) only. 'confirmed' -> closed (terminal).
// 'rejected' -> reopened (comment required, can be responded to again).
export function confirmQaqcRecord(projectId: string, qaqcId: string, decision: 'confirmed' | 'rejected', comment?: string) {
  return apiPost<QaqcRecord>(`/projects/${projectId}/qaqc/${qaqcId}/confirm`, { decision, comment });
}

// ── Generic document attachments ("+Add document", same presigned-PUT flow
// as rfis.api.ts's) ─────────────────────────────────────────────────────────
export interface QaqcAttachment {
  id: string;
  qaqcId: string;
  companyId: string;
  kind: QaqcAttachmentKind;
  documentType?: RfiDocumentType;
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
  documentType?: RfiDocumentType;
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
  extra?: Omit<AddQaqcAttachmentPayload, 'storageKey' | 'filename' | 'sizeBytes'>,
): Promise<QaqcAttachment> {
  const { uploadUrl, storageKey } = await getQaqcAttachmentUploadUrl(projectId, qaqcId, file.name, file.size);
  await axios.put(uploadUrl, file, { headers: { 'Content-Type': file.type || 'application/octet-stream' } });
  return addQaqcAttachment(projectId, qaqcId, { storageKey, filename: file.name, sizeBytes: file.size, ...extra });
}

// ── Quick photo picker ("+Add photo") -- links an already-uploaded Capture
// (uploaded via captures.api.ts's uploadCapture()), mirroring
// issues.api.ts's addEvidenceCapture() one-for-one. This is a different
// path from uploadQaqcAttachment() above: the photo becomes a real
// Capture (shows up in the project's Captures grid), not a bare
// qaqc_attachments row. ──────────────────────────────────────────────────
export interface QaqcLinkedCapture {
  id: string;
  captureId: string;
  kind: QaqcAttachmentKind;
  caption?: string;
  createdAt: string;
  captureType: string;
  capturedAt: string;
  title?: string;
  thumbnailUrl?: string;
  addedByName?: string;
}

export function linkQaqcCapture(projectId: string, qaqcId: string, captureId: string, kind: QaqcAttachmentKind = 'issue', caption?: string) {
  return apiPost<unknown>(`/projects/${projectId}/qaqc/${qaqcId}/captures`, { captureId, kind, caption });
}

export function getQaqcCaptures(projectId: string, qaqcId: string) {
  return apiGet<QaqcLinkedCapture[]>(`/projects/${projectId}/qaqc/${qaqcId}/captures`);
}
