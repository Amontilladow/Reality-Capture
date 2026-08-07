import { apiPost } from './api';

export type ReportType = 'progress' | 'site_condition' | 'handover' | 'dispute_evidence';

export interface GeneratedReport {
  project: { name: string; code?: string; location?: string };
  narrative: string;
  data: {
    captureCount: number;
    issueSummary: { status: string; priority: string; count: number }[];
  };
  format: string;
}

export function generateReport(projectId: string, reportType: ReportType, dateFrom?: string, dateTo?: string) {
  return apiPost<GeneratedReport>(`/projects/${projectId}/reports/generate`, {
    reportType,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
  });
}
