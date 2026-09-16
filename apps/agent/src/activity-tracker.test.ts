import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ActivityTracker } from './activity-tracker.js';

// getActiveApplicationName/getIdleSeconds are injected fakes throughout --
// this exercises the segment-open/close decision logic without active-win
// or desktop-idle (or any real display/OS idle-time API) present, which
// this sandbox does not have. See README.md's testing notes.

test('opens a segment on the first sample and returns null (nothing closed yet)', async () => {
  const tracker = new ActivityTracker(120);
  const closed = await tracker.sample(async () => 'Revit', () => 0, () => 't0');
  assert.equal(closed, null);
});

test('keeps the segment open across samples with the same app and activity state', async () => {
  const tracker = new ActivityTracker(120);
  await tracker.sample(async () => 'Revit', () => 0, () => 't0');
  const closed = await tracker.sample(async () => 'Revit', () => 5, () => 't1'); // still well under the idle threshold
  assert.equal(closed, null);
});

test('closes the segment and opens a new one when the active application changes', async () => {
  const tracker = new ActivityTracker(120);
  await tracker.sample(async () => 'Revit', () => 0, () => 't0');
  const closed = await tracker.sample(async () => 'Outlook', () => 0, () => 't1');
  assert.deepEqual(closed, { applicationNameRaw: 'Revit', activityType: 'ACTIVE', startedAt: 't0', endedAt: 't1' });

  // the new segment is now open under the new app
  const stillOpen = await tracker.sample(async () => 'Outlook', () => 0, () => 't2');
  assert.equal(stillOpen, null);
});

test('closes the segment when idle seconds crosses the threshold, even if the app is unchanged', async () => {
  const tracker = new ActivityTracker(120);
  await tracker.sample(async () => 'Revit', () => 0, () => 't0');
  const closed = await tracker.sample(async () => 'Revit', () => 121, () => 't1');
  assert.deepEqual(closed, { applicationNameRaw: 'Revit', activityType: 'ACTIVE', startedAt: 't0', endedAt: 't1' });
});

test('falls back to "Unknown" when the active-window adapter reports no application', async () => {
  const tracker = new ActivityTracker(120);
  await tracker.sample(async () => undefined, () => 0, () => 't0');
  const closed = await tracker.sample(async () => 'Revit', () => 0, () => 't1');
  assert.equal(closed?.applicationNameRaw, 'Unknown');
});

test('closeCurrent() closes the open segment on demand (graceful shutdown) and returns null if nothing was open', async () => {
  const tracker = new ActivityTracker(120);
  assert.equal(tracker.closeCurrent(() => 't0'), null);

  await tracker.sample(async () => 'Revit', () => 0, () => 't1');
  const closed = tracker.closeCurrent(() => 't2');
  assert.deepEqual(closed, { applicationNameRaw: 'Revit', activityType: 'ACTIVE', startedAt: 't1', endedAt: 't2' });
  assert.equal(tracker.closeCurrent(() => 't3'), null); // nothing open anymore
});
