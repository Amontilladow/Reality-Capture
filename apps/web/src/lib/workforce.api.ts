import { apiGet, apiPost, apiPatch, apiDelete } from './api';
import type {
  Activity, ProductivityScore, WorkforcePrivacySettings, WorkforceTeamMember, WorkforceReportingLine,
  WorkforceScreenshotView, MonitoringLevel, ApplicationRegistryEntry, ProductivityClassification,
  WorkforceShiftPreference, WorkforceShiftAssignment, WorkforceAbsence, AbsenceType,
  WorkforceCalendarStatus, CalendarEventSummary,
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
  windowTitleEnabled?: boolean;
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

// company_admin+ only for writes (GET is open to any authenticated
// company member, enforced server-side) -- the DeskTime-style "which
// apps/executables count as productive" registry behind the productivity
// breakdown. New apps show up here as 'unclassified' the moment the
// desktop agent first reports them (see ActivitiesService.ingest()'s
// auto-registration), ready for an admin to triage.
export function listApplications() {
  return apiGet<ApplicationRegistryEntry[]>('/workforce/applications');
}

export function updateApplicationClassification(id: string, productivityClassification: ProductivityClassification) {
  return apiPatch<ApplicationRegistryEntry>(`/workforce/applications/${id}`, { productivityClassification });
}

export interface CompanyReportRow {
  userId: string;
  name: string;
  companyRole: string;
  totalActiveSeconds: number;
  engineeringShare: number;
  productiveSeconds: number;
  unproductiveSeconds: number;
  neutralSeconds: number;
  unclassifiedSeconds: number;
  productivityRatio: number;
}

// company_admin+ only (enforced server-side) -- one row per active company
// user for the given period, company-wide (not reporting-chain-scoped like
// getMyActivitySummary/getMyProductivityScore). DeskTime's own "Reports"
// screen.
export function getCompanyReport(params?: { from?: string; to?: string }) {
  return apiGet<CompanyReportRow[]>('/workforce/reports/company-summary', { params });
}

// ── Shift scheduling + absence calendar ──
// DeskTime's own shift-scheduling ("which days/times employees prefer
// working") + a request/approve absence calendar. Deliberately minimal --
// no leave-balance accrual, this is not an HRIS.

export function setMyShiftPreference(dto: { dayOfWeek: number; preferred?: boolean; startTime?: string; endTime?: string }) {
  return apiPost<WorkforceShiftPreference>('/workforce/scheduling/shift-preferences', dto);
}

export function getMyShiftPreferences() {
  return apiGet<WorkforceShiftPreference[]>('/workforce/scheduling/shift-preferences/me');
}

export interface CompanyShiftPreferenceRow extends WorkforceShiftPreference {
  firstName: string;
  lastName: string;
}

// company_admin+ only (enforced server-side) -- every user's preferences,
// for whoever is building the actual schedule.
export function listCompanyShiftPreferences() {
  return apiGet<CompanyShiftPreferenceRow[]>('/workforce/scheduling/shift-preferences');
}

// company_admin+ only (enforced server-side).
export function assignShift(dto: { userId: string; shiftDate: string; startTime: string; endTime: string }) {
  return apiPost<WorkforceShiftAssignment>('/workforce/scheduling/shifts', dto);
}

// Same targetUserId convention as getMyActivitySummary -- switches to the
// sibling GET /workforce/scheduling/shifts/:userId route (manager/
// leadership visibility, enforced server-side). Omit params/targetUserId
// for "today through two weeks out" for the caller's own shifts.
export function getMyShifts(params?: { from?: string; to?: string }, targetUserId?: string) {
  const url = targetUserId ? `/workforce/scheduling/shifts/${targetUserId}` : '/workforce/scheduling/shifts/me';
  return apiGet<WorkforceShiftAssignment[]>(url, { params });
}

export interface CompanyShiftRow extends WorkforceShiftAssignment {
  firstName: string;
  lastName: string;
}

// company_admin+ only (enforced server-side) -- the full company schedule
// for a date range.
export function getCompanyShifts(params?: { from?: string; to?: string }) {
  return apiGet<CompanyShiftRow[]>('/workforce/scheduling/shifts', { params });
}

export function requestAbsence(dto: { absenceType: AbsenceType; startDate: string; endDate: string; reason?: string }) {
  return apiPost<WorkforceAbsence>('/workforce/scheduling/absences', dto);
}

// Same targetUserId convention as getMyShifts.
export function getMyAbsences(targetUserId?: string) {
  const url = targetUserId ? `/workforce/scheduling/absences/${targetUserId}` : '/workforce/scheduling/absences/me';
  return apiGet<WorkforceAbsence[]>(url);
}

export interface CompanyAbsenceRow extends WorkforceAbsence {
  firstName: string;
  lastName: string;
}

// company_admin+ only (enforced server-side) -- pending only by default.
export function listCompanyAbsences(includeDecided = false) {
  return apiGet<CompanyAbsenceRow[]>('/workforce/scheduling/absences', { params: { includeDecided: includeDecided ? 'true' : undefined } });
}

// company_admin+ only (enforced server-side).
export function decideAbsence(absenceId: string, status: 'approved' | 'denied') {
  return apiPatch<WorkforceAbsence>(`/workforce/scheduling/absences/${absenceId}/decide`, { status });
}

// ── Google Calendar integration ──
// Self-service only -- there is no admin view of another user's calendar
// connection. See migration 041's header comment: OAuth connect/disconnect
// + a live "today's events" read, not persisted or scored.

export async function getGoogleCalendarAuthorizeUrl() {
  const { url } = await apiGet<{ url: string }>('/workforce/calendar-integration/google-calendar/authorize-url');
  return url;
}

export function getGoogleCalendarStatus() {
  return apiGet<WorkforceCalendarStatus>('/workforce/calendar-integration/google-calendar/status');
}

export function disconnectGoogleCalendar() {
  return apiDelete<{ disconnected: boolean }>('/workforce/calendar-integration/google-calendar');
}

export function getTodayCalendarEvents() {
  return apiGet<CalendarEventSummary[]>('/workforce/calendar-integration/google-calendar/events/today');
}
