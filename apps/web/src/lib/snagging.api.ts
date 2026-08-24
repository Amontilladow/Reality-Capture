import axios from 'axios';
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

// ══════════════════════════════════════════════════════════════════════
// Detail-view workflow actions — mirrors issues.api.ts's equivalent
// activities/forward/force-status/attachments functions one-to-one.
// ══════════════════════════════════════════════════════════════════════

// Mirrors IssueActivity's shape (packages/types/src/issue.types.ts) —
// snag_activities carries the same columns as issue_activities, scoped to
// this feature's smaller activity-type set.
export interface SnagActivity {
  id: string;
  snagItemId: string;
  companyId: string;
  activityType: 'comment' | 'status_change' | 'forward' | 'status_force';
  content?: string;
  fromValue?: string;
  toValue?: string;
  attachmentUrl?: string;
  attachmentName?: string;
  // BIGINT in Postgres — node-postgres returns BIGINT columns as strings,
  // so this is a string over the wire despite being a byte count.
  attachmentSizeBytes?: number | string;
  performedBy: string;
  createdAt: string;
  performedByName?: string;
  avatarUrl?: string;
  // Presigned read URL, present only on activities that have an
  // attachment (absent, never null, otherwise).
  attachmentReadUrl?: string;
}

export function getSnagActivities(projectId: string, snagId: string) {
  return apiGet<SnagActivity[]>(`/projects/${projectId}/snag-items/${snagId}/activities`);
}

export function addSnagComment(projectId: string, snagId: string, content: string) {
  return apiPost<SnagActivity>(`/projects/${projectId}/snag-items/${snagId}/activities`, {
    activityType: 'comment',
    content,
  });
}

// ── Forward (reassign) ──────────────────────────────────────────────────
export function forwardSnag(projectId: string, snagId: string, payload: { toUserId: string; comment?: string }) {
  return apiPost<SnagItem>(`/projects/${projectId}/snag-items/${snagId}/forward`, payload);
}

// ── Admin force-status (manager/admin only — gated in the UI via
// isSnagManager(), enforced server-side by @Roles) ─────────────────────
export function forceSnagStatus(projectId: string, snagId: string, status: SnagStatus) {
  return apiPatch<SnagItem>(`/projects/${projectId}/snag-items/${snagId}/force-status`, { status });
}

// ── Attachments (presigned-PUT, same shape as uploadIssueAttachment()) ──
export function getSnagAttachmentUploadUrl(projectId: string, snagId: string, filename: string, sizeBytes: number) {
  return apiPost<{ uploadUrl: string; storageKey: string }>(
    `/projects/${projectId}/snag-items/${snagId}/attachments/upload-url`,
    { filename, sizeBytes },
  );
}

export function addSnagAttachment(
  projectId: string,
  snagId: string,
  payload: { storageKey: string; filename: string; sizeBytes: number; comment?: string },
) {
  return apiPost<SnagActivity>(`/projects/${projectId}/snag-items/${snagId}/attachments`, payload);
}

// Full client-side flow: request the presigned URL, PUT the file straight
// to storage, then register it as a snag_activities row.
export async function uploadSnagAttachment(
  projectId: string,
  snagId: string,
  file: File,
  comment?: string,
): Promise<SnagActivity> {
  const { uploadUrl, storageKey } = await getSnagAttachmentUploadUrl(projectId, snagId, file.name, file.size);
  await axios.put(uploadUrl, file, { headers: { 'Content-Type': file.type || 'application/octet-stream' } });
  return addSnagAttachment(projectId, snagId, { storageKey, filename: file.name, sizeBytes: file.size, comment });
}
