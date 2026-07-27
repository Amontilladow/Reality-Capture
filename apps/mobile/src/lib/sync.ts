import * as TaskManager from 'expo-task-manager';
import * as BackgroundFetch from 'expo-background-fetch';
import NetInfo from '@react-native-community/netinfo';
import * as FileSystem from 'expo-file-system';
import { SYNC_TASK_NAME, MAX_UPLOAD_RETRIES } from './config';
import { listQueuedCaptures, updateQueueStatus, deleteQueuedCapture, type QueuedCapture } from './db';
import { uploadLocalFile } from './captures.api';
import { useAuthStore } from '../store/auth.store';

export type SyncListener = (event: { processed: number; succeeded: number; failed: number }) => void;
const listeners = new Set<SyncListener>();

export function onSyncComplete(listener: SyncListener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

let isSyncing = false;

/**
 * Uploads every pending/retryable item in the local queue, one at a time (deliberately
 * serial — construction site connectivity is often thin, and parallel uploads of large
 * 360°/video files tend to starve each other rather than finish faster).
 */
export async function processQueue(): Promise<{ processed: number; succeeded: number; failed: number }> {
  if (isSyncing) return { processed: 0, succeeded: 0, failed: 0 };

  // Don't burn retries against a connection that isn't there — the queue stays intact
  // and background fetch will try again on its own schedule.
  const net = await NetInfo.fetch();
  if (!net.isConnected || net.isInternetReachable === false) {
    return { processed: 0, succeeded: 0, failed: 0 };
  }

  // A signed-out queue can't upload — items wait for the next sign-in.
  if (!useAuthStore.getState().accessToken) {
    return { processed: 0, succeeded: 0, failed: 0 };
  }

  isSyncing = true;
  let succeeded = 0;
  let failed = 0;

  try {
    const candidates: QueuedCapture[] = [
      ...listQueuedCaptures('pending'),
      ...listQueuedCaptures('failed').filter((c) => c.attempts < MAX_UPLOAD_RETRIES),
    ];

    for (const item of candidates) {
      updateQueueStatus(item.id, 'uploading');
      try {
        const fileInfo = await FileSystem.getInfoAsync(item.localFileUri);
        if (!fileInfo.exists) {
          // The local file is gone (app storage cleared, etc.) — nothing to retry.
          updateQueueStatus(item.id, 'failed', { lastError: 'Local file no longer exists on device.', incrementAttempts: true });
          failed += 1;
          continue;
        }

        const capture = await uploadLocalFile(item.projectId, item.localFileUri, item.mimeType, item.sizeBytes, {
          captureType: item.captureType,
          locationId: item.locationId,
          phase: (item.phase as any) ?? undefined,
          title: item.title,
          description: item.description,
          capturedAt: item.capturedAt,
          gpsLat: item.gpsLat,
          gpsLng: item.gpsLng,
          gpsAccuracyM: item.gpsAccuracyM,
          compassHeadingDeg: item.compassHeadingDeg,
        });

        updateQueueStatus(item.id, 'uploaded', { remoteCaptureId: capture.id });
        // Free device storage once the server has the file durably stored.
        await FileSystem.deleteAsync(item.localFileUri, { idempotent: true }).catch(() => {});
        succeeded += 1;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Upload failed';
        updateQueueStatus(item.id, 'failed', { lastError: message, incrementAttempts: true });
        failed += 1;
      }
    }

    const result = { processed: candidates.length, succeeded, failed };
    listeners.forEach((l) => l(result));
    return result;
  } finally {
    isSyncing = false;
  }
}

// Clears queue entries that succeeded a while back, keeping the local DB small.
// (Kept separate from processQueue so history screens can still show recent successes.)
export function pruneUploaded(olderThanDays = 7) {
  const cutoff = new Date(Date.now() - olderThanDays * 86_400_000).toISOString();
  for (const item of listQueuedCaptures('uploaded')) {
    if (item.updatedAt < cutoff) deleteQueuedCapture(item.id);
  }
}

TaskManager.defineTask(SYNC_TASK_NAME, async () => {
  try {
    const result = await processQueue();
    return result.processed > 0
      ? BackgroundFetch.BackgroundFetchResult.NewData
      : BackgroundFetch.BackgroundFetchResult.NoData;
  } catch {
    return BackgroundFetch.BackgroundFetchResult.Failed;
  }
});

export async function registerBackgroundSync() {
  const status = await BackgroundFetch.getStatusAsync();
  if (status === BackgroundFetch.BackgroundFetchStatus.Restricted || status === BackgroundFetch.BackgroundFetchStatus.Denied) {
    return false;
  }
  const already = await TaskManager.isTaskRegisteredAsync(SYNC_TASK_NAME);
  if (already) return true;

  await BackgroundFetch.registerTaskAsync(SYNC_TASK_NAME, {
    minimumInterval: 15 * 60, // seconds — the OS treats this as a floor, not a guarantee
    stopOnTerminate: false,
    startOnBoot: true,
  });
  return true;
}

let netInfoUnsubscribe: (() => void) | null = null;

/** Kicks a sync attempt whenever connectivity is regained, in addition to background fetch. */
export function startNetworkTriggeredSync() {
  if (netInfoUnsubscribe) return;
  let wasConnected = true;
  netInfoUnsubscribe = NetInfo.addEventListener((state) => {
    const isConnected = Boolean(state.isConnected && state.isInternetReachable !== false);
    if (isConnected && !wasConnected) {
      processQueue().catch(() => {});
    }
    wasConnected = isConnected;
  });
}

export function stopNetworkTriggeredSync() {
  netInfoUnsubscribe?.();
  netInfoUnsubscribe = null;
}
