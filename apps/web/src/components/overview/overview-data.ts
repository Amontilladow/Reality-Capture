import { useQuery } from '@tanstack/react-query';
import { getProjectActivity } from '../../lib/audit.api';
import { groupActivity } from '../../lib/activity-feed';
import type { ProjectBriefing } from './useProjectBriefing';

export const PROCESSING_STATUS_LABELS: Record<string, string> = { pending: 'Pending', processing: 'Processing', ready: 'Ready', failed: 'Failed' };

export function useRecentActivity(projectId: string, enabled = true) {
  // Fetched wider than shown: internal pipeline events are filtered out.
  const query = useQuery({ queryKey: ['project-activity', projectId], queryFn: () => getProjectActivity(projectId, 30), enabled });
  return { isLoading: query.isLoading, isLoaded: Boolean(query.data), entries: groupActivity(query.data ?? []) };
}

export type RecentActivity = ReturnType<typeof useRecentActivity>;

// One line for the BIM section's collapsed summary, e.g. "3 ready · 1 failed".
export function bimSummary(brief: ProjectBriefing): string {
  const models = brief.bimModels ?? [];
  if (models.length === 0) return 'No BIM models uploaded yet';
  const counts = models.reduce<Record<string, number>>((acc, m) => ({ ...acc, [m.status]: (acc[m.status] ?? 0) + 1 }), {});
  return Object.entries(counts).map(([s, n]) => `${n} ${PROCESSING_STATUS_LABELS[s]?.toLowerCase() ?? s}`).join(' · ');
}
