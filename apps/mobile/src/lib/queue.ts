import * as FileSystem from 'expo-file-system';
import * as Crypto from 'expo-crypto';
import type { CaptureType, ProjectPhase } from '@engineeringos/types';
import { insertQueuedCapture, type QueuedCapture } from './db';
import { getCurrentGpsTag } from './location';
import { processQueue } from './sync';

const CAPTURES_DIR = `${FileSystem.documentDirectory}engineeringos-captures/`;

async function ensureCapturesDir() {
  const info = await FileSystem.getInfoAsync(CAPTURES_DIR);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(CAPTURES_DIR, { intermediates: true });
  }
}

/**
 * Moves a file from its (often temporary/cache) source URI into permanent app
 * storage, tags it with GPS, and writes a queue row. The caller gets an
 * immediate, durable local record — upload happens later via the sync engine,
 * whether the device is online right now or not.
 */
export async function enqueueCapture(params: {
  sourceUri: string;
  projectId: string;
  locationId: string | null;
  captureType: CaptureType;
  phase: ProjectPhase | null;
  title: string | null;
  description: string | null;
  mimeType: string;
}): Promise<QueuedCapture> {
  await ensureCapturesDir();

  const id = Crypto.randomUUID();
  const extension = params.sourceUri.split('.').pop()?.split('?')[0] ?? 'jpg';
  const destUri = `${CAPTURES_DIR}${id}.${extension}`;

  await FileSystem.copyAsync({ from: params.sourceUri, to: destUri });
  const info = await FileSystem.getInfoAsync(destUri, { size: true });
  const sizeBytes = info.exists && 'size' in info ? info.size : 0;

  const gps = await getCurrentGpsTag();
  const now = new Date().toISOString();

  const item: QueuedCapture = {
    id,
    projectId: params.projectId,
    locationId: params.locationId,
    captureType: params.captureType,
    phase: params.phase,
    title: params.title,
    description: params.description,
    localFileUri: destUri,
    mimeType: params.mimeType,
    sizeBytes,
    gpsLat: gps.gpsLat,
    gpsLng: gps.gpsLng,
    gpsAccuracyM: gps.gpsAccuracyM,
    compassHeadingDeg: gps.compassHeadingDeg,
    capturedAt: now,
    status: 'pending',
    attempts: 0,
    lastError: null,
    remoteCaptureId: null,
    createdAt: now,
    updatedAt: now,
  };

  insertQueuedCapture(item);

  // Opportunistic immediate attempt — if we're online this uploads right away instead
  // of waiting for the next background-fetch window. processQueue() is a no-op if offline.
  processQueue().catch(() => {});

  return item;
}
