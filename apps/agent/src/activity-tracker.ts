import type { ActivityType } from './types.js';

interface OpenSegment {
  applicationNameRaw: string;
  activityType: ActivityType;
  startedAt: string;
}

export interface ClosedSegment extends OpenSegment {
  endedAt: string;
}

// Pure segment-tracking logic, deliberately with zero filesystem/network
// I/O and zero direct dependency on active-win/desktop-idle -- both are
// passed in as plain functions on each sample() call, so this class (the
// actual "when does a segment start/end" decision) is unit-testable
// without mocking native modules or touching a real OS idle-time API.
//
// Maintains one open "segment" (app name + active/idle state); the moment
// either changes, the previous segment is closed and returned so the
// caller can queue it, and a new segment opens starting at that same
// instant -- no gaps, no overlaps.
export class ActivityTracker {
  private openSegment: OpenSegment | null = null;

  constructor(private readonly idleThresholdSeconds: number) {}

  async sample(
    getActiveApplicationName: () => Promise<string | undefined>,
    getIdleSeconds: () => number,
    now: () => string = () => new Date().toISOString(),
  ): Promise<ClosedSegment | null> {
    const applicationNameRaw = (await getActiveApplicationName()) ?? 'Unknown';
    const activityType: ActivityType = getIdleSeconds() >= this.idleThresholdSeconds ? 'IDLE' : 'ACTIVE';
    const timestamp = now();

    if (!this.openSegment) {
      this.openSegment = { applicationNameRaw, activityType, startedAt: timestamp };
      return null;
    }

    const unchanged = this.openSegment.applicationNameRaw === applicationNameRaw && this.openSegment.activityType === activityType;
    if (unchanged) return null;

    const closed: ClosedSegment = { ...this.openSegment, endedAt: timestamp };
    this.openSegment = { applicationNameRaw, activityType, startedAt: timestamp };
    return closed;
  }

  // Closes whatever segment is currently open without starting a new one --
  // called on graceful shutdown (SIGINT/SIGTERM) so the last in-progress
  // segment isn't silently dropped between the last sample and process exit.
  closeCurrent(now: () => string = () => new Date().toISOString()): ClosedSegment | null {
    if (!this.openSegment) return null;
    const closed: ClosedSegment = { ...this.openSegment, endedAt: now() };
    this.openSegment = null;
    return closed;
  }
}
