import { apiGet } from './api';

export interface AuditEntry {
  id: number;
  userName?: string;
  action: string;
  resourceType: string;
  resourceLabel?: string;
  occurredAt: string;
}

export function getProjectActivity(projectId: string, perPage = 10) {
  return apiGet<AuditEntry[]>(`/audit/project/${projectId}`, { params: { perPage } });
}
