import { apiGet, apiPost, apiPatch } from './api';
import type {
  Activity, ProductivityScore, WorkforcePrivacySettings, WorkforceTeamMember, WorkforceReportingLine,
  WorkforceScreenshotView, MonitoringLevel,
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

// targetUserId switches to the sibling GET /workforce/activities/:userId
// route (manager/leadership visibility, enforced server-side) instead of
// the caller's own /me. Omit it (or pass undefined) for self-view.
export function getMyActivitySummary(params?: { from?: string; to?: string }, targetUserId?: string) {
  const url = targetUserId ? `/workforce/activities/${targetUserId}` : '/workforce/activities/me';
  return apiGet<ActivitySummary>(url, { params });
}

export function attributeActivity(activityId: string, projectId: string) {
  return apiPost<unknown>(`/workforce/activities/${activityId}/attribute`, { projectId });
}

// Same targetUserId convention as getMyActivitySummary -- switches to
// GET /workforce/productivity/:userId.
export function getMyProductivityScore(
  params?: { periodType?: 'day' | 'week'; periodStart?: string; from?: string; to?: string },
  targetUserId?: string,
) {
  const url = targetUserId ? `/workforce/productivity/${targetUserId}` : '/workforce/productivity/me';
  return apiGet<ProductivityScore>(url, { params });
}

export function getWorkforcePrivacySettings() {
  return apiGet<WorkforcePrivacySettings>('/workforce/privacy-settings');
}

// company_admin+ only (enforced server-side). This is the literal switch
// that turns real screenshot capture on for the company -- the agent's
// upload-url request is rejected with 403 until this sets
// screenshotEnabled: true.
export function updateWorkforcePrivacySettings(dto: {
  monitoringLevel?: MonitoringLevel;
  screenshotEnabled?: boolean;
  retentionDays?: number;
  selfViewEnabled?: boolean;
}) {
  return apiPatch<WorkforcePrivacySettings>('/workforce/privacy-settings', dto);
}

// Same targetUserId convention as getMyActivitySummary/getMyProductivityScore,
// except there is no "me" shortcut route server-side -- self is just the
// userId === caller case of the identical GET /workforce/screenshots/:userId
// route every viewer (self or manager) uses.
export function getMyScreenshots(userId: string, params?: { from?: string; to?: string }) {
  return apiGet<WorkforceScreenshotView[]>(`/workforce/screenshots/${userId}`, { params });
}

// Everyone in the current user's downward reporting chain (empty for an
// individual contributor with no reports).
export function getMyTeam() {
  return apiGet<WorkforceTeamMember[]>('/workforce/team');
}

export interface ReportingLineRow {
  userId: string;
  managerId: string;
  userFirstName: string;
  userLastName: string;
  managerFirstName: string;
  managerLastName: string;
}

// company_admin+ only (enforced server-side) -- for the minimal reporting-
// line admin table in WorkforcePage.
export function listReportingLines() {
  return apiGet<ReportingLineRow[]>('/workforce/reporting-lines');
}

export function setReportingLine(userId: string, managerId: string) {
  return apiPost<WorkforceReportingLine>('/workforce/reporting-lines', { userId, managerId });
}
