import axios from 'axios';
import type {
  Issue, IssueActivity, IssueType, IssuePriority, IssueStatus, IssueDiscipline, IssueCategory, IssueReminder,
} from '@engineeringos/types';
import { apiGet, apiGetWithMeta, apiPost, apiPatch, apiDelete } from './api';

export interface IssueListItem extends Issue {
  createdByName?: string;
  assignedToName?: string;
  assignedToAvatar?: string;
  locationName?: string;
  buildingName?: string;
  levelName?: string;
}

export interface IssueDetailItem extends IssueListItem {
  elementType?: string;
  elementName?: string;
  elementGuid?: string;
  elementModelId?: string;
  screenshotUrl?: string;
}

export interface IssueSummary {
  total: number;
  open: number;
  inProgress: number;
  resolved: number;
  closed: number;
  critical: number;
  overdue: number;
  createdThisWeek: number;
  closedThisWeek: number;
}

export interface IssueFilters {
  status?: string;
  priority?: string;
  issueType?: string;
  assignedTo?: string;
  discipline?: string;
  dateFrom?: string;
  dateTo?: string;
  overdue?: boolean;
  myIssues?: boolean;
  search?: string;
  page?: number;
  perPage?: number;
}

export function listIssues(projectId: string, filters?: IssueFilters) {
  return apiGetWithMeta<IssueListItem[]>(`/projects/${projectId}/issues`, { params: filters });
}

export function getIssueSummary(projectId: string) {
  return apiGet<IssueSummary>(`/projects/${projectId}/issues/summary`);
}

export function getIssue(projectId: string, issueId: string) {
  return apiGet<IssueDetailItem>(`/projects/${projectId}/issues/${issueId}`);
}

export interface CreateIssuePayload {
  issueType: IssueType;
  title: string;
  description?: string;
  priority?: IssuePriority;
  discipline: IssueDiscipline;
  category?: IssueCategory;
  trade?: string;
  specificationRef?: string;
  buildingId?: string;
  levelId?: string;
  locationId?: string;
  elementId?: string;
  assignedTo?: string;
  responsibleCompany?: string;
  // Required on create — matches CreateIssueDto.deadline (API-level only;
  // the DB column stays nullable for pre-existing rows).
  deadline: string;
  drawingId?: string;
  posXNorm?: number;
  posYNorm?: number;
  modelId?: string;
  cameraPosX?: number;
  cameraPosY?: number;
  cameraPosZ?: number;
  cameraTargetX?: number;
  cameraTargetY?: number;
  cameraTargetZ?: number;
  screenshotStorageKey?: string;
}

export function createIssue(projectId: string, payload: CreateIssuePayload) {
  return apiPost<Issue>(`/projects/${projectId}/issues`, payload);
}

export function getIssueScreenshotUploadUrl(projectId: string) {
  return apiPost<{ uploadUrl: string; storageKey: string }>(
    `/projects/${projectId}/issues/screenshot-upload-url`,
    {},
  );
}

// Uploads a data URL (from BimViewerHandle.getScreenshotDataUrl()) as a
// view-state screenshot and returns its storage key, ready to pass as
// CreateIssuePayload.screenshotStorageKey. Returns null on any failure --
// a screenshot is a nice-to-have, never worth blocking issue creation over.
export async function uploadIssueScreenshot(projectId: string, dataUrl: string): Promise<string | null> {
  try {
    const { uploadUrl, storageKey } = await getIssueScreenshotUploadUrl(projectId);
    const blob = await (await fetch(dataUrl)).blob();
    await axios.put(uploadUrl, blob, { headers: { 'Content-Type': 'image/png' } });
    return storageKey;
  } catch {
    return null;
  }
}

export interface UpdateIssuePayload {
  title?: string;
  description?: string;
  priority?: IssuePriority;
  status?: IssueStatus;
  discipline?: IssueDiscipline;
  category?: IssueCategory;
  trade?: string;
  buildingId?: string;
  levelId?: string;
  locationId?: string;
  elementId?: string | null;
  assignedTo?: string;
  responsibleCompany?: string;
  deadline?: string;
  tags?: string[];
}

export function updateIssue(projectId: string, issueId: string, payload: UpdateIssuePayload) {
  return apiPatch<Issue>(`/projects/${projectId}/issues/${issueId}`, payload);
}

export function deleteIssue(projectId: string, issueId: string) {
  return apiDelete<{ message: string }>(`/projects/${projectId}/issues/${issueId}`);
}

// ══════════════════════════════════════════════════════════════════════
// Ticket 2b — workflow actions
// ══════════════════════════════════════════════════════════════════════

// ── Forward (reassign) ──────────────────────────────────────────────────
export function forwardIssue(projectId: string, issueId: string, payload: { toUserId: string; comment?: string }) {
  return apiPost<Issue>(`/projects/${projectId}/issues/${issueId}/forward`, payload);
}

// ── Admin force-status (manager/admin only — gated in the UI via
// isIssueManager(), enforced server-side by @Roles) ─────────────────────
export function forceIssueStatus(projectId: string, issueId: string, status: IssueStatus) {
  return apiPatch<Issue>(`/projects/${projectId}/issues/${issueId}/force-status`, { status });
}

// ── Bulk close ────────────────────────────────────────────────────────
export interface BulkCloseResult {
  closed: number;
  issueIds: string[];
}

export function bulkCloseIssues(projectId: string, issueIds: string[]) {
  return apiPost<BulkCloseResult>(`/projects/${projectId}/issues/bulk-close`, { issueIds });
}

// ── Reminders (manager/admin only for the two send endpoints) ──────────
export type IssueReminderRow = IssueReminder & {
  sentByName?: string;
  sentToName?: string;
  issueNumber?: string;
  issueTitle?: string;
};

export function listReminders(projectId: string, query?: { page?: number; perPage?: number }) {
  return apiGetWithMeta<IssueReminderRow[]>(`/projects/${projectId}/issues/reminders`, { params: query });
}

export function broadcastReminder(projectId: string, message: string) {
  return apiPost<{ remindersSent: number }>(`/projects/${projectId}/issues/reminders/broadcast`, { message });
}

export function sendUserReminder(projectId: string, userId: string, message: string) {
  return apiPost<{ remindersSent: number }>(`/projects/${projectId}/issues/reminders/user`, { userId, message });
}

export function warnUser(projectId: string, userId: string) {
  return apiPost<{ warned: number }>(`/projects/${projectId}/issues/warn-user`, { userId });
}

// ── Attachments (presigned-PUT, same shape as uploadDrawing() in
// drawings.api.ts) ───────────────────────────────────────────────────────
export function getIssueAttachmentUploadUrl(projectId: string, issueId: string, filename: string, sizeBytes: number) {
  return apiPost<{ uploadUrl: string; storageKey: string }>(
    `/projects/${projectId}/issues/${issueId}/attachments/upload-url`,
    { filename, sizeBytes },
  );
}

export function addIssueAttachment(
  projectId: string,
  issueId: string,
  payload: { storageKey: string; filename: string; sizeBytes: number; comment?: string },
) {
  return apiPost<IssueActivity>(`/projects/${projectId}/issues/${issueId}/attachments`, payload);
}

// Full client-side flow: request the presigned URL, PUT the file straight
// to storage, then register it as an issue_activities row.
export async function uploadIssueAttachment(
  projectId: string,
  issueId: string,
  file: File,
  comment?: string,
): Promise<IssueActivity> {
  const { uploadUrl, storageKey } = await getIssueAttachmentUploadUrl(projectId, issueId, file.name, file.size);
  await axios.put(uploadUrl, file, { headers: { 'Content-Type': file.type || 'application/octet-stream' } });
  return addIssueAttachment(projectId, issueId, { storageKey, filename: file.name, sizeBytes: file.size, comment });
}

export function getActivities(projectId: string, issueId: string) {
  return apiGet<(IssueActivity & { performedByName?: string; avatarUrl?: string })[]>(
    `/projects/${projectId}/issues/${issueId}/activities`,
  );
}

export function addComment(projectId: string, issueId: string, content: string) {
  return apiPost<IssueActivity>(`/projects/${projectId}/issues/${issueId}/activities`, {
    activityType: 'comment',
    content,
  });
}

export function addEvidenceCapture(projectId: string, issueId: string, captureId: string, caption?: string) {
  return apiPost<unknown>(`/projects/${projectId}/issues/${issueId}/captures`, { captureId, caption });
}
