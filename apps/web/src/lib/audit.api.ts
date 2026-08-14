import { apiGet } from './api';

export interface AuditEntry {
  id: number;
  userName?: string;
  action: string;
  resourceType: string;
  // Added (Phase 3, additive) -- not previously exposed on this type since no
  // caller needed to filter by it; RfiDetailPage's audit trail section
  // filters this endpoint's results down to resourceType === 'rfi' &&
  // resourceId === rfiId client-side (no per-resource audit endpoint exists).
  resourceId?: string;
  resourceLabel?: string;
  occurredAt: string;
}

export function getProjectActivity(projectId: string, perPage = 10) {
  return apiGet<AuditEntry[]>(`/audit/project/${projectId}`, { params: { perPage } });
}
