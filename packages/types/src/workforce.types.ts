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

export interface WorkforcePrivacySettings {
  id: string;
  companyId: string;
  monitoringLevel: MonitoringLevel;
  screenshotEnabled: boolean;
  retentionDays: number;
  selfViewEnabled: boolean;
  updatedBy?: string;
  updatedAt: string;
  createdAt: string;
}
