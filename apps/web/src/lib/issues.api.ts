import type { Issue, IssueActivity, IssueType, IssuePriority, IssueStatus } from '@engineeringos/types';
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
  discipline?: string;
  trade?: string;
  buildingId?: string;
  levelId?: string;
  locationId?: string;
  elementId?: string;
  assignedTo?: string;
  deadline?: string;
  drawingId?: string;
  posXNorm?: number;
  posYNorm?: number;
}

export function createIssue(projectId: string, payload: CreateIssuePayload) {
  return apiPost<Issue>(`/projects/${projectId}/issues`, payload);
}

export interface UpdateIssuePayload {
  title?: string;
  description?: string;
  priority?: IssuePriority;
  status?: IssueStatus;
  discipline?: string;
  trade?: string;
  assignedTo?: string;
  deadline?: string;
}

export function updateIssue(projectId: string, issueId: string, payload: UpdateIssuePayload) {
  return apiPatch<Issue>(`/projects/${projectId}/issues/${issueId}`, payload);
}

export function deleteIssue(projectId: string, issueId: string) {
  return apiDelete<{ message: string }>(`/projects/${projectId}/issues/${issueId}`);
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
