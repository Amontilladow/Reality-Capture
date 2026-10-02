import { apiGet, apiPost, apiDelete, apiDownload } from './api';

// Internal, authenticated side -- same manage_project_records gate as
// Submittals' review actions. `http` (used under the hood) only attaches a
// bearer token when one exists in the auth store, so the public helpers
// below reuse the same client with no separate instance.

export interface ProgressReportFilters {
  dateFrom: string;
  dateTo: string;
  buildingId?: string;
  levelId?: string;
}

export interface ProgressReportIssueRow {
  id: string;
  issueNumber: string;
  title: string;
  status: string;
  priority: string;
  locationName?: string;
  assignedToName?: string;
  deadline?: string;
  createdAt: string;
  closedAt?: string;
}

export interface ProgressReportCapture {
  id: string;
  thumbnailUrl?: string;
  capturedAt: string;
  title?: string;
  locationName?: string;
}

export interface ProgressReport {
  project: { name: string; code?: string };
  building?: { name: string };
  level?: { name: string };
  dateFrom: string;
  dateTo: string;
  generatedAt: string;
  captureCount: number;
  captures: ProgressReportCapture[];
  newIssues: ProgressReportIssueRow[];
  closedIssues: ProgressReportIssueRow[];
  overdueIssues: ProgressReportIssueRow[];
  blockers: ProgressReportIssueRow[];
}

const toParams = (filters: ProgressReportFilters) => {
  const params = new URLSearchParams({ dateFrom: filters.dateFrom, dateTo: filters.dateTo });
  if (filters.buildingId) params.set('buildingId', filters.buildingId);
  if (filters.levelId) params.set('levelId', filters.levelId);
  return params;
};

export function getProgressReport(projectId: string, filters: ProgressReportFilters) {
  return apiGet<ProgressReport>(`/projects/${projectId}/progress-reports`, { params: Object.fromEntries(toParams(filters)) });
}

export function downloadProgressReportPdf(projectId: string, filters: ProgressReportFilters, filename: string) {
  return apiDownload(`/projects/${projectId}/progress-reports/pdf?${toParams(filters).toString()}`, filename);
}

export interface ProgressReportShare {
  id: string;
  buildingId?: string;
  levelId?: string;
  dateFrom: string;
  dateTo: string;
  expiresAt: string;
  revokedAt?: string;
  usedAt?: string;
  createdBy: string;
  createdAt: string;
}

export function createProgressReportShare(projectId: string, filters: ProgressReportFilters, expiresInDays?: number) {
  return apiPost<ProgressReportShare & { shareUrl: string }>(`/projects/${projectId}/progress-reports/shares`, { ...filters, expiresInDays });
}

export function listProgressReportShares(projectId: string) {
  return apiGet<ProgressReportShare[]>(`/projects/${projectId}/progress-reports/shares`);
}

export function revokeProgressReportShare(projectId: string, shareId: string) {
  return apiDelete<{ message: string }>(`/projects/${projectId}/progress-reports/shares/${shareId}`);
}

// ── Public, unauthenticated side (the /progress-report/:token page) ───────
export function getProgressReportByToken(token: string) {
  return apiGet<ProgressReport>(`/public/progress-reports/${token}`);
}
