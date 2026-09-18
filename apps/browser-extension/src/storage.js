// Thin wrapper around a chrome.storage.local-shaped area:
// { get(keys): Promise<object>, set(obj): Promise<void> }. Parameterized
// by that area (rather than importing `chrome` directly) the same way
// apps/agent/src/queue.ts is parameterized by a queuePath -- so the pure
// state/queue logic here is unit-testable against a plain in-memory fake,
// without a real browser or chrome.storage.local present.

const STATE_KEY = 'workforceState';
const QUEUE_KEY = 'workforceQueue';

const DEFAULT_STATE = {
  serverUrl: null,
  accessToken: null,
  refreshToken: null,
  deviceId: null,
  privateMode: false,
  // The tracker's currently-open segment, persisted so it survives a
  // Manifest V3 service-worker suspend/wake cycle -- see
  // tracker.js's toPersisted()/fromPersisted().
  openSegment: null,
};

export async function loadState(storageArea) {
  const stored = await storageArea.get(STATE_KEY);
  return { ...DEFAULT_STATE, ...(stored[STATE_KEY] ?? {}) };
}

export async function saveState(storageArea, partialState) {
  const current = await loadState(storageArea);
  const next = { ...current, ...partialState };
  await storageArea.set({ [STATE_KEY]: next });
  return next;
}

export async function readQueue(storageArea) {
  const stored = await storageArea.get(QUEUE_KEY);
  return stored[QUEUE_KEY] ?? [];
}

export async function enqueueActivity(storageArea, item) {
  const queue = await readQueue(storageArea);
  queue.push(item);
  await storageArea.set({ [QUEUE_KEY]: queue });
}

// Removes exactly the given count from the front of the queue -- called
// only after a confirmed successful flush of that many items, mirroring
// apps/agent/src/queue.ts's removeFromQueue().
export async function removeFromQueue(storageArea, count) {
  const queue = await readQueue(storageArea);
  await storageArea.set({ [QUEUE_KEY]: queue.slice(count) });
}
