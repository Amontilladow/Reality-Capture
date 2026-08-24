import { apiGet } from './api';

// KPI dashboard payload for the project Reports page — built server-side by
// GET /projects/:projectId/reports/kpis (backend ticket, built in parallel).
// Field names below mirror getIssueSummary()'s IssueSummary (issues.api.ts)
// and getSnagSummary()'s SnagSummary (snagging.api.ts) exactly, since the
// stat tiles here are meant to match what the Issues/Snagging tabs already
// show — no separate shape invented for this page.
export interface ReportIssueSummary {
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

export interface ReportOpenIssue {
  id: string;
  issueNumber?: string;
  title: string;
  status: string;
  priority: string;
  discipline?: string;
  deadline?: string;
  assignedToName?: string;
}

export interface ReportSnagSummary {
  total: number;
  open: number;
  fixed: number;
  verified: number;
  overdue: number;
}

export interface ReportOpenSnag {
  id: string;
  snagNumber?: string;
  title: string;
  status: string;
  priority: string;
  trade?: string;
  location?: string;
  dueDate?: string;
  assignedToName?: string;
}

export interface ReportKpis {
  project: { name?: string; code?: string };
  issues: {
    summary: ReportIssueSummary;
    byStatus: Record<string, number>;
    byPriority: Record<string, number>;
    byDiscipline: Record<string, number>;
    openList: ReportOpenIssue[];
  };
  snagging: {
    summary: ReportSnagSummary;
    byStatus: Record<string, number>;
    byPriority: Record<string, number>;
    byTrade: Record<string, number>;
    openList: ReportOpenSnag[];
  };
}

export function getReportKpis(projectId: string) {
  return apiGet<ReportKpis>(`/projects/${projectId}/reports/kpis`);
}
