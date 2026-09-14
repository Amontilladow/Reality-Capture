import { apiGet, apiPost } from './api';
import type {
  Activity, ProductivityScore, WorkforcePrivacySettings,
} from '@engineeringos/types';

export interface ActivitySummary {
  rangeStart: string;
  rangeEnd: string;
  totalSeconds: number;
  activities: (Activity & { applicationName?: string; projectId?: string; projectName?: string })[];
  byApplication: { label: string; seconds: number }[];
  byActivityType: { label: string; seconds: number }[];
  byProject: { label: string; seconds: number }[];
}

export function getMyActivitySummary(params?: { from?: string; to?: string }) {
  return apiGet<ActivitySummary>('/workforce/activities/me', { params });
}

export function attributeActivity(activityId: string, projectId: string) {
  return apiPost<unknown>(`/workforce/activities/${activityId}/attribute`, { projectId });
}

export function getMyProductivityScore(params?: { periodType?: 'day' | 'week'; periodStart?: string }) {
  return apiGet<ProductivityScore>('/workforce/productivity/me', { params });
}

export function getWorkforcePrivacySettings() {
  return apiGet<WorkforcePrivacySettings>('/workforce/privacy-settings');
}
