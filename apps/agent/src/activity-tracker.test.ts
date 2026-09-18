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

test('when isPrivate() is true, redacts the app name at the source instead of reading the real active window', async () => {
  const tracker = new ActivityTracker(120);
  let realWindowWasRead = false;
  const getActiveApplicationName = async () => { realWindowWasRead = true; return 'Gmail'; };

  await tracker.sample(getActiveApplicationName, () => 0, () => 't0', () => true);
  const closed = tracker.closeCurrent(() => 't1');

  assert.deepEqual(closed, { applicationNameRaw: 'Private', activityType: 'PRIVATE', startedAt: 't0', endedAt: 't1' });
  assert.equal(realWindowWasRead, false); // the real active-window adapter was never even called
});

test('private mode ignores idle state -- private time is tracked regardless of idle seconds', async () => {
  const tracker = new ActivityTracker(120);
  await tracker.sample(async () => 'Revit', () => 0, () => 't0', () => true);
  // Idle seconds well past the threshold -- still stays PRIVATE, not IDLE.
  const closed = await tracker.sample(async () => 'Revit', () => 999, () => 't1', () => true);
  assert.equal(closed, null); // unchanged segment (still PRIVATE) -- nothing closes
});

test('leaving private mode closes the private segment and opens a normal one', async () => {
  const tracker = new ActivityTracker(120);
  await tracker.sample(async () => 'Revit', () => 0, () => 't0', () => true);
  const closed = await tracker.sample(async () => 'Revit', () => 0, () => 't1', () => false);
  assert.deepEqual(closed, { applicationNameRaw: 'Private', activityType: 'PRIVATE', startedAt: 't0', endedAt: 't1' });
});

test('closeCurrent() closes the open segment on demand (graceful shutdown) and returns null if nothing was open', async () => {
  const tracker = new ActivityTracker(120);
  assert.equal(tracker.closeCurrent(() => 't0'), null);

  await tracker.sample(async () => 'Revit', () => 0, () => 't1');
  const closed = tracker.closeCurrent(() => 't2');
  assert.deepEqual(closed, { applicationNameRaw: 'Revit', activityType: 'ACTIVE', startedAt: 't1', endedAt: 't2' });
  assert.equal(tracker.closeCurrent(() => 't3'), null); // nothing open anymore
});

// Window title capture -- getWindowTitle is the new 5th param (after the
// already-defaulted now/isPrivate), so every test above that never passes
// it exercises the exact same "no windowTitle key at all" segment shape
// this class has always produced.

test('a caller that never wires getWindowTitle in produces segments with no windowTitle key at all', async () => {
  const tracker = new ActivityTracker(120);
  await tracker.sample(async () => 'Revit', () => 0, () => 't0');
  const closed = await tracker.sample(async () => 'Outlook', () => 0, () => 't1');
  assert.deepEqual(closed, { applicationNameRaw: 'Revit', activityType: 'ACTIVE', startedAt: 't0', endedAt: 't1' });
  assert.equal('windowTitle' in (closed ?? {}), false);
});

test('captures the window title alongside the app name when getWindowTitle is wired in', async () => {
  const tracker = new ActivityTracker(120);
  await tracker.sample(async () => 'Excel', () => 0, () => 't0', () => false, async () => 'Q3-Budget.xlsx - Excel');
  const closed = await tracker.sample(async () => 'Outlook', () => 0, () => 't1', () => false, async () => 'Inbox - Outlook');
  assert.deepEqual(closed, { applicationNameRaw: 'Excel', activityType: 'ACTIVE', startedAt: 't0', endedAt: 't1', windowTitle: 'Q3-Budget.xlsx - Excel' });
});

test('updates the stored title within the same open segment when the title changes but the app/activity type does not', async () => {
  const tracker = new ActivityTracker(120);
  await tracker.sample(async () => 'Excel', () => 0, () => 't0', () => false, async () => 'Q3-Budget.xlsx - Excel');
  await tracker.sample(async () => 'Excel', () => 0, () => 't1', () => false, async () => 'Q4-Forecast.xlsx - Excel'); // same app -- segment stays open, title updates
  const closed = await tracker.sample(async () => 'Outlook', () => 0, () => 't2', () => false, async () => undefined);
  assert.deepEqual(closed, { applicationNameRaw: 'Excel', activityType: 'ACTIVE', startedAt: 't0', endedAt: 't2', windowTitle: 'Q4-Forecast.xlsx - Excel' });
});

test('never captures a window title while Private Time is on, even if getWindowTitle is wired in', async () => {
  const tracker = new ActivityTracker(120);
  let realTitleWasRead = false;
  const getWindowTitle = async () => { realTitleWasRead = true; return 'Re: salary negotiation - Gmail'; };

  await tracker.sample(async () => 'Gmail', () => 0, () => 't0', () => true, getWindowTitle);
  const closed = tracker.closeCurrent(() => 't1');

  assert.deepEqual(closed, { applicationNameRaw: 'Private', activityType: 'PRIVATE', startedAt: 't0', endedAt: 't1' });
  assert.equal('windowTitle' in (closed ?? {}), false);
  assert.equal(realTitleWasRead, false); // the real title adapter was never even called, same as the app-name adapter
});
