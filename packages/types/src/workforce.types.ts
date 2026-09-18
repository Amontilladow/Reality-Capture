// ══════════════════════════════════════════════════════════════════════════
// Workforce Intelligence™ — shared types
// See docs/workforce-intelligence-data-model.md for the full schema and
// the rationale for which vocabularies are closed (validated here) vs.
// open/configurable (free text at the API layer).
// ══════════════════════════════════════════════════════════════════════════

export const DEVICE_PLATFORMS = ['windows', 'macos', 'linux', 'web'] as const;
export type DevicePlatform = typeof DEVICE_PLATFORMS[number];

export const ACTIVITY_SOURCES = ['agent', 'browser_extension', 'manual', 'seed', 'import'] as const;
export type ActivitySource = typeof ACTIVITY_SOURCES[number];

// Extensible by design (brief §10): this is the MVP seed set, not an
// exhaustive enum. Adding a new value is a code change here, never a
// database migration — activities.activity_type is a plain VARCHAR.
export const ACTIVITY_TYPES = [
  'ACTIVE', 'IDLE', 'MEETING', 'ENGINEERING', 'DESIGN', 'MODELING',
  'DOCUMENTATION', 'REVIEW', 'COORDINATION', 'COMMUNICATION',
  'ADMINISTRATIVE', 'TRAINING', 'UNKNOWN',
  // Employee-initiated "Private Time" (DeskTime's own term for it): still
  // counts as tracked/active time, but application_name_raw/domain are
  // never the real value for a row carrying this type -- see
  // ActivitiesService.insertOne(), which force-redacts them server-side
  // regardless of what any client actually sends.
  'PRIVATE',
] as const;
export type ActivityType = typeof ACTIVITY_TYPES[number];

// A closed, small vocabulary on purpose — the productivity scoring engine
// branches on these values directly (see data model doc).
export const PRODUCTIVITY_CLASSIFICATIONS = ['productive', 'neutral', 'unproductive', 'unclassified'] as const;
export type ProductivityClassification = typeof PRODUCTIVITY_CLASSIFICATIONS[number];

// Project-attribution mechanisms (brief §12). MVP implements
// 'manual_selection' and 'task_context'; the rest are modeled now so V1/V2
// signals slot into the same evidence/confidence shape without a schema
// change.
export const ATTRIBUTION_METHODS = [
  'manual_selection', 'task_context', 'file_path', 'bim_model_metadata',
  'document_metadata', 'browser_context', 'integrated_system', 'ai_inference',
] as const;
export type AttributionMethod = typeof ATTRIBUTION_METHODS[number];

export const MONITORING_LEVELS = ['minimal', 'standard', 'detailed'] as const;
export type MonitoringLevel = typeof MONITORING_LEVELS[number];

export const PRODUCTIVITY_MODEL_VERSION = 'v1';

export interface Device {
  id: string;
  companyId: string;
  userId: string;
  platform: DevicePlatform;
  hostname?: string;
  deviceFingerprint?: string;
  agentVersion?: string;
  enrolledAt: string;
  lastSeenAt?: string;
  isActive: boolean;
  revokedAt?: string;
  revokedBy?: string;
  createdAt: string;
}

export interface ApplicationRegistryEntry {
  id: string;
  companyId: string;
  name: string;
  matchPattern: string;
  category?: string;
  discipline?: string;
  productivityClassification: ProductivityClassification;
  engineeringRelevance: boolean;
  isActive: boolean;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Activity {
  id: string;
  companyId: string;
  userId: string;
  deviceId?: string;
  clientEventId?: string;
  applicationId?: string;
  applicationNameRaw: string;
  domain?: string;
  activityType: string;
  startedAt: string;
  endedAt: string;
  durationSeconds: number;
  source: ActivitySource;
  confidence?: number;
  rawMetadata: Record<string, unknown>;
  createdAt: string;
  // The active window's title bar text (e.g. "Q3-Budget.xlsx - Excel") --
  // absent unless the company has windowTitleEnabled on (see
  // WorkforcePrivacySettings) and this row isn't 'PRIVATE'; enforced
  // server-side regardless of what any client sends (see
  // ActivitiesService.insertOne()).
  windowTitle?: string;
}

export interface ActivityProjectAttribution {
  id: string;
  companyId: string;
  activityId: string;
  projectId: string;
  confidence: number;
  method: AttributionMethod;
  evidence: Record<string, unknown>;
  attributedBy?: string;
  attributedAt: string;
}

export interface ProductivityFactors {
  utilization: number;
  engineeringShare: number;
  totalActiveSeconds: number;
  totalEngineeringSeconds: number;
  topApplications: { applicationId: string | null; name: string; seconds: number }[];
  // DeskTime-style productive/unproductive/neutral/unclassified time
  // breakdown, by each activity's application_registry.productivity_
  // classification (idle time excluded from all four, same as DeskTime).
  // Optional because productivity_scores rows persisted before this field
  // existed still have a factors JSONB without it.
  productiveSeconds?: number;
  unproductiveSeconds?: number;
  neutralSeconds?: number;
  unclassifiedSeconds?: number;
  // Time under the employee-initiated 'PRIVATE' activity type -- counted
  // in totalActiveSeconds (it's still tracked work time) but excluded from
  // the four buckets above and from productivityRatio's denominator, since
  // there's no app data to classify.
  privateSeconds?: number;
  // productiveSeconds / (totalActiveSeconds - privateSeconds) -- DeskTime's
  // own headline ratio, kept separate from `score` (see
  // productivity.service.ts). Private time is excluded entirely rather
  // than counted as a neutral drag on it.
  productivityRatio?: number;
}

export interface ProductivityScore {
  id: string;
  companyId: string;
  userId: string;
  projectId?: string;
  // 'day' | 'week' | 'range' (an explicit from/to override -- see
  // ProductivityService.getMyScoreForRange) -- plain string since the
  // period_type column is an unconstrained VARCHAR(10), not a DB enum.
  periodType: string;
  periodStart: string;
  periodEnd: string;
  score: number;
  factors: ProductivityFactors;
  modelVersion: string;
  calculatedAt: string;
}

// Chain-of-command visibility (manager/leadership over an employee's own
// self-view) -- see docs/workforce-intelligence-architecture.md's RBAC
// section and workforce-visibility.util.ts. Deliberately its own
// workforce-scoped table (workforce_reporting_lines), not a manager_id
// column on the core `users` table.
export interface WorkforceReportingLine {
  id: string;
  companyId: string;
  userId: string;
  managerId: string;
  createdBy?: string;
  createdAt: string;
}

// One row per person in a viewer's downward reporting closure (or, for a
// weight-based leadership viewer, one row per company user) -- returned by
// GET /workforce/team to populate the team list in the UI.
export interface WorkforceTeamMember {
  userId: string;
  name: string;
  companyRole: string;
}

// A stored screenshot row. `url` is a presigned read URL resolved at
// request time (GET /workforce/screenshots/:userId) -- never persisted,
// since it expires.
export interface WorkforceScreenshotView {
  id: string;
  capturedAt: string;
  url: string | null;
}

export interface WorkforcePrivacySettings {
  id: string;
  companyId: string;
  monitoringLevel: MonitoringLevel;
  screenshotEnabled: boolean;
  // Same off-by-default, company-wide-switch, server-enforced-regardless-
  // of-client treatment as screenshotEnabled -- see migration 042.
  windowTitleEnabled: boolean;
  retentionDays: number;
  selfViewEnabled: boolean;
  updatedBy?: string;
  updatedAt: string;
  createdAt: string;
}

// ══════════════════════════════════════════════════════════════════════════
// Shift scheduling + absence calendar -- see migration 040's own header
// comment for why this exists despite this doc's earlier "not this
// product's job" call on attendance/leave; kept deliberately minimal
// (no leave-balance accrual, no PTO policy engine).
// ══════════════════════════════════════════════════════════════════════════

export const ABSENCE_TYPES = ['vacation', 'sick', 'personal', 'other'] as const;
export type AbsenceType = typeof ABSENCE_TYPES[number];

export const ABSENCE_STATUSES = ['pending', 'approved', 'denied'] as const;
export type AbsenceStatus = typeof ABSENCE_STATUSES[number];

// A preference, not a schedule -- "which days/times I'd prefer to work,"
// considered (not guaranteed) by whoever builds the actual schedule
// (WorkforceShiftAssignment). day_of_week: 0 = Sunday, matching JS
// Date#getDay(), enforced identically client- and server-side.
export interface WorkforceShiftPreference {
  id: string;
  companyId: string;
  userId: string;
  dayOfWeek: number;
  preferred: boolean;
  startTime?: string;
  endTime?: string;
  createdAt: string;
  updatedAt: string;
}

// The actual assigned schedule -- one row per (user, calendar date),
// admin-managed.
export interface WorkforceShiftAssignment {
  id: string;
  companyId: string;
  userId: string;
  shiftDate: string;
  startTime: string;
  endTime: string;
  assignedBy?: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkforceAbsence {
  id: string;
  companyId: string;
  userId: string;
  absenceType: AbsenceType;
  startDate: string;
  endDate: string;
  reason?: string;
  status: AbsenceStatus;
  decidedBy?: string;
  decidedAt?: string;
  createdAt: string;
  updatedAt: string;
}

// ══════════════════════════════════════════════════════════════════════════
// Google Calendar integration -- DeskTime's own "integrate with calendar
// apps to help track offline time," scoped for this pass to OAuth connect/
// disconnect plus a live "today's events" read (not persisted into
// `activities`, not factored into scoring -- see migration 041's header
// comment for why).
// ══════════════════════════════════════════════════════════════════════════

export const CALENDAR_PROVIDERS = ['google_calendar'] as const;
export type CalendarProvider = typeof CALENDAR_PROVIDERS[number];

export interface WorkforceCalendarStatus {
  connected: boolean;
  connectedAt: string | null;
  lastUsedAt: string | null;
}

// A live-fetched event, never persisted server-side -- id/title/startTime/
// endTime only, nothing else Google's API returns (attendees, description,
// location, etc. are deliberately not surfaced).
export interface CalendarEventSummary {
  id: string;
  title: string;
  startTime: string;
  endTime: string;
}
