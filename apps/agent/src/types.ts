// Mirrors apps/api/src/modules/workforce/activities/dto/ingest-activities.dto.ts's
// IngestActivityItemDto shape exactly. The agent only ever produces
// 'ACTIVE'/'IDLE' -- the richer engineering/design/etc. classification
// happens server-side via the application registry, not something this
// agent decides.
export type ActivityType = 'ACTIVE' | 'IDLE';

export interface IngestActivityItem {
  clientEventId: string;
  deviceId: string;
  applicationNameRaw: string;
  activityType: ActivityType;
  startedAt: string;
  endedAt: string;
}

export interface AgentConfig {
  serverUrl: string;
  accessToken: string;
  refreshToken: string;
  deviceId: string;
  screenshotIntervalMinutes: number;
  idleThresholdSeconds: number;
}
