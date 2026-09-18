// Mirrors apps/api/src/modules/workforce/activities/dto/ingest-activities.dto.ts's
// IngestActivityItemDto shape exactly. The agent only ever produces
// 'ACTIVE'/'IDLE'/'PRIVATE' -- the richer engineering/design/etc.
// classification happens server-side via the application registry, not
// something this agent decides.
export type ActivityType = 'ACTIVE' | 'IDLE' | 'PRIVATE';

// The only value this agent ever sends as applicationNameRaw while
// "Private Time" is on -- see ActivityTracker.sample()'s isPrivate branch.
// The API force-redacts this server-side too regardless, but the point of
// doing it here as well is that the real app name is never even read
// (let alone queued to local disk or sent over the network) during
// private time.
export const PRIVATE_APPLICATION_NAME = 'Private';

export interface IngestActivityItem {
  clientEventId: string;
  deviceId: string;
  applicationNameRaw: string;
  activityType: ActivityType;
  startedAt: string;
  endedAt: string;
  // Sent whenever ActivityTracker captured one -- the server decides
  // whether to actually persist it (workforce_privacy_settings.
  // window_title_enabled, off by default) or force-drop it, the same
  // trust model as PRIVATE_APPLICATION_NAME redaction above: this agent
  // never assumes the company's setting, the API is the sole enforcement
  // point.
  windowTitle?: string;
}

export interface AgentConfig {
  serverUrl: string;
  accessToken: string;
  refreshToken: string;
  deviceId: string;
  screenshotIntervalMinutes: number;
  idleThresholdSeconds: number;
}
