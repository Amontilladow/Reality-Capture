import { randomUUID } from 'node:crypto';
import axios from 'axios';
import { enroll } from './enroll.js';
import { loadConfig, QUEUE_PATH } from './config.js';
import { createApiClient } from './api-client.js';
import { ActivityTracker } from './activity-tracker.js';
import { flushQueue } from './flush.js';
import { runScreenshotCycle } from './screenshot-cycle.js';
import { enqueueActivity } from './queue.js';
import { getActiveApplicationName, getIdleSeconds, captureScreenshot } from './native.js';
import type { ClosedSegment } from './activity-tracker.js';
import type { IngestActivityItem } from './types.js';

const SAMPLE_INTERVAL_MS = 10_000;
const FLUSH_INTERVAL_MS = 60_000;

function toIngestItem(segment: ClosedSegment, deviceId: string): IngestActivityItem {
  return {
    clientEventId: randomUUID(),
    deviceId,
    applicationNameRaw: segment.applicationNameRaw,
    activityType: segment.activityType,
    startedAt: segment.startedAt,
    endedAt: segment.endedAt,
  };
}

async function runStart(): Promise<void> {
  const config = loadConfig();
  const client = createApiClient(config);
  const tracker = new ActivityTracker(config.idleThresholdSeconds);

  console.log(
    `Workforce Intelligence agent started (device ${config.deviceId}). ` +
    `Sampling every ${SAMPLE_INTERVAL_MS / 1000}s, flushing every ${FLUSH_INTERVAL_MS / 1000}s, ` +
    `screenshots every ${config.screenshotIntervalMinutes}m.`,
  );

  const sampleTimer = setInterval(() => {
    tracker.sample(getActiveApplicationName, getIdleSeconds)
      .then((closed) => { if (closed) enqueueActivity(QUEUE_PATH, toIngestItem(closed, config.deviceId)); })
      .catch((err: Error) => console.warn('Activity sample failed:', err.message));
  }, SAMPLE_INTERVAL_MS);

  const flushTimer = setInterval(() => {
    flushQueue(QUEUE_PATH, items => client.ingestActivities(items))
      .then((result) => {
        if (result) console.log(`Flushed activity: ${result.inserted} inserted, ${result.duplicates} duplicate, ${result.rejected} rejected.`);
      })
      .catch((err: Error) => console.warn('Activity flush failed, will retry next cycle:', err.message));
  }, FLUSH_INTERVAL_MS);

  const screenshotTimer = setInterval(() => {
    runScreenshotCycle({
      requestUploadUrl: () => client.requestScreenshotUploadUrl(),
      capture: captureScreenshot,
      putImage: (uploadUrl, image) => axios.put(uploadUrl, image, { headers: { 'Content-Type': 'image/jpeg' } }).then(() => undefined),
      recordScreenshot: ({ storageKey, capturedAt }) => client.recordScreenshot({ storageKey, capturedAt, deviceId: config.deviceId }),
      isForbiddenError: err => client.isForbidden(err),
    }).catch((err: Error) => console.warn('Screenshot cycle crashed unexpectedly:', err.message));
  }, config.screenshotIntervalMinutes * 60_000);

  // Flush whatever's queued (including the segment still open at the
  // moment of shutdown) instead of waiting for the next scheduled tick.
  const shutdown = () => {
    clearInterval(sampleTimer);
    clearInterval(flushTimer);
    clearInterval(screenshotTimer);
    const closed = tracker.closeCurrent();
    if (closed) enqueueActivity(QUEUE_PATH, toIngestItem(closed, config.deviceId));
    flushQueue(QUEUE_PATH, items => client.ingestActivities(items))
      .catch((err: Error) => console.warn('Final flush on shutdown failed (queued locally, will retry on next start):', err.message))
      .finally(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

async function main(): Promise<void> {
  const command = process.argv[2];

  if (command === 'enroll') {
    await enroll();
    return;
  }
  if (command === 'start') {
    await runStart();
    return;
  }

  console.error('Usage: agent <enroll|start>');
  process.exitCode = 1;
}

main().catch((err) => {
  console.error('Agent crashed:', err);
  process.exitCode = 1;
});
