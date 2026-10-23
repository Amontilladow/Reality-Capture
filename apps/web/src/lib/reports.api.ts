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

// RFIs join the Reports module for the first time here (there was no
// existing RFI reports section to extend) -- see RfisService.getSummary()/
// getKpiBreakdown()/getDrawingUpdatesNotApplied() (apps/api). summary reuses
// RfisPage's own RfiSummary shape exactly (total/open/answered/overdue).
export interface ReportRfiSummary {
  total: number;
  open: number;
  answered: number;
  overdue: number;
}

export interface ReportRfiDrawingUpdate {
  id: string;
  rfiNumber?: string;
  subject: string;
  drawingImpactLevel: string;
  createdAt: string;
  drawingUpdateOwnerName?: string;
}

// QAQC NCR/SOR/WIR/MIR -- mirrors QaqcService.getSummary()'s exact shape
// (apps/api). Per-type counts are split rather than merged, per the
// brief's explicit ask.
export interface ReportQaqcSummary {
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

export interface ReportOpenQaqcRecord {
  id: string;
  recordType: 'ncr' | 'sor' | 'wir' | 'mir';
  recordNumber?: string;
  subject: string;
  status: string;
  priority: string;
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
  rfis: {
    summary: ReportRfiSummary;
    byDrawingImpact: Record<string, number>;
    drawingUpdateStatus: { totalRequiringDrawingUpdate: number; applied: number; notApplied: number };
    notAppliedList: ReportRfiDrawingUpdate[];
  };
  qaqc: {
    summary: ReportQaqcSummary;
    byRecordType: Record<string, number>;
    byStatus: Record<string, number>;
    byPriority: Record<string, number>;
    openList: ReportOpenQaqcRecord[];
  };
}

export function getReportKpis(projectId: string) {
  return apiGet<ReportKpis>(`/projects/${projectId}/reports/kpis`);
}

// ── Company-wide executive summary (Phase 4 cross-project view) ───────────
// Lean per-project rollup from GET /reports/company-summary -- backed by
// ReportsService.getCompanySummary(), itself a loop over the exact same
// per-project getSummary()/getExecutiveSummary() methods the single-project
// pages call. Never the full ReportKpis shape (no byStatus/openList here --
// unused at company scale and expensive to carry for every project).
export interface CompanyProjectSummary {
  projectId: string;
  projectName: string;
  projectCode?: string;
  risk: { criticalCount: number; overdueCount: number; totalOpenRisks: number; overallScore: number; overallLevel: string };
  issues: { critical: number; overdue: number; total: number };
  snagging: { overdue: number; total: number };
  rfis: { overdue: number; total: number };
  qaqc: { critical: number; overdue: number; total: number };
}

export interface CompanySummary {
  projects: CompanyProjectSummary[];
}

export function getCompanySummary() {
  return apiGet<CompanySummary>('/reports/company-summary');
}
