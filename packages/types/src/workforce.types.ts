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
  periodType: 'day' | 'week';
  periodStart: string;
  periodEnd: string;
  score: number;
  factors: ProductivityFactors;
  modelVersion: string;
  calculatedAt: string;
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
