// Manifest V3 background service worker -- wires chrome.tabs/windows/idle/
// alarms/storage to the pure tracker.js/domain.js/storage.js logic. This
// file itself is NOT unit-tested: chrome.* APIs don't exist under
// node --test and this sandbox has no real browser to load the extension
// into (see README.md's "How this was tested"). Keep this file as thin as
// possible -- every actual decision (open/close a segment, resolve a
// trackable domain, merge queue state) belongs in the tested modules it
// calls, not here.
import { DomainTracker, PRIVATE_DOMAIN_NAME } from './tracker.js';
import { resolveTrackableDomain } from './domain.js';
import { loadState, saveState, enqueueActivity, readQueue, removeFromQueue } from './storage.js';
import { createApiClient } from './api-client.js';

const IDLE_THRESHOLD_SECONDS = 120;
const FLUSH_ALARM_NAME = 'workforce-flush';
const FLUSH_ALARM_PERIOD_MINUTES = 1;

const tracker = new DomainTracker();
let trackerRestored = false;

// The service worker can be suspended and woken at any time between
// events (unlike the desktop agent's single long-lived process) -- restore
// whatever segment was open before this instance existed, once, lazily,
// rather than on every single event.
async function ensureTrackerRestored() {
  if (trackerRestored) return;
  const state = await loadState(chrome.storage.local);
  tracker.fromPersisted(state.openSegment);
  trackerRestored = true;
}

function toIngestItem(closedSegment, deviceId) {
  // Domain doubles as applicationNameRaw -- deliberate, not a shortcut: a
  // domain then flows through the exact same application_registry auto-
  // registration/classification pipeline the desktop agent's app names
  // already use (see apps/api/.../activities/activities.service.ts), so
  // admins classify websites in the same "Application productivity"
  // screen with zero backend changes for this feature.
  const isPrivate = closedSegment.activityType === 'PRIVATE';
  return {
    clientEventId: crypto.randomUUID(),
    deviceId,
    applicationNameRaw: closedSegment.domain,
    domain: isPrivate ? undefined : closedSegment.domain,
    activityType: closedSegment.activityType,
    startedAt: closedSegment.startedAt,
    endedAt: closedSegment.endedAt,
  };
}

async function recordAndQueue(domain, activityType, deviceId) {
  await ensureTrackerRestored();
  const closed = tracker.recordState(domain, activityType, new Date().toISOString());
  if (closed) await enqueueActivity(chrome.storage.local, toIngestItem(closed, deviceId));
  await saveState(chrome.storage.local, { openSegment: tracker.toPersisted() });
}

async function handleStateChange() {
  const state = await loadState(chrome.storage.local);
  if (!state.deviceId) return; // not enrolled yet -- nothing to record against

  if (state.privateMode) {
    await recordAndQueue(PRIVATE_DOMAIN_NAME, 'PRIVATE', state.deviceId);
    return;
  }

  const idleState = await chrome.idle.queryState(IDLE_THRESHOLD_SECONDS);
  if (idleState !== 'active') {
    await recordAndQueue('idle', 'IDLE', state.deviceId);
    return;
  }

  const focused = await chrome.windows.getLastFocused();
  if (focused && focused.focused === false) {
    // The browser itself isn't the OS-focused app -- there's no other
    // app-level signal available from an extension, so this is treated
    // like idle rather than guessed at.
    await recordAndQueue('idle', 'IDLE', state.deviceId);
    return;
  }

  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const domain = resolveTrackableDomain(tab?.url);
  if (!domain) {
    // Internal browser page (chrome://, the extension's own popup, etc.)
    // or a tab with no readable URL -- nothing to classify. Treated like
    // idle rather than left open indefinitely under whatever domain was
    // previously active.
    await recordAndQueue('idle', 'IDLE', state.deviceId);
    return;
  }

  await recordAndQueue(domain, 'ACTIVE', state.deviceId);
}

function onEvent() {
  handleStateChange().catch((err) => console.warn('Workforce state change failed:', err));
}

chrome.tabs.onActivated.addListener(onEvent);
chrome.tabs.onUpdated.addListener((_tabId, info) => { if (info.url) onEvent(); });
chrome.windows.onFocusChanged.addListener(onEvent);
chrome.idle.onStateChanged.addListener(onEvent);
chrome.idle.setDetectionInterval(IDLE_THRESHOLD_SECONDS);

chrome.alarms.create(FLUSH_ALARM_NAME, { periodInMinutes: FLUSH_ALARM_PERIOD_MINUTES });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === FLUSH_ALARM_NAME) flush().catch((err) => console.warn('Workforce flush failed, will retry next alarm:', err));
});

async function flush() {
  const state = await loadState(chrome.storage.local);
  if (!state.deviceId || !state.accessToken) return;

  const items = (await readQueue(chrome.storage.local)).slice(0, 500);
  if (items.length === 0) return;

  const client = createApiClient(state, (accessToken, refreshToken) => saveState(chrome.storage.local, { accessToken, refreshToken }));
  await client.ingestActivities(items);
  await removeFromQueue(chrome.storage.local, items.length);
}
