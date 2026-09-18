import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DomainTracker } from './tracker.js';

test('opens a segment on the first state and returns null (nothing closed yet)', () => {
  const tracker = new DomainTracker();
  const closed = tracker.recordState('github.com', 'ACTIVE', 't0');
  assert.equal(closed, null);
});

test('keeps the segment open across states with the same domain and activity type', () => {
  const tracker = new DomainTracker();
  tracker.recordState('github.com', 'ACTIVE', 't0');
  const closed = tracker.recordState('github.com', 'ACTIVE', 't1');
  assert.equal(closed, null);
});

test('closes the segment and opens a new one when the domain changes', () => {
  const tracker = new DomainTracker();
  tracker.recordState('github.com', 'ACTIVE', 't0');
  const closed = tracker.recordState('docs.google.com', 'ACTIVE', 't1');
  assert.deepEqual(closed, { domain: 'github.com', activityType: 'ACTIVE', startedAt: 't0', endedAt: 't1' });

  const stillOpen = tracker.recordState('docs.google.com', 'ACTIVE', 't2');
  assert.equal(stillOpen, null);
});

test('closes the segment when activity type changes even if the domain is unchanged (e.g. going idle)', () => {
  const tracker = new DomainTracker();
  tracker.recordState('github.com', 'ACTIVE', 't0');
  const closed = tracker.recordState('github.com', 'IDLE', 't1');
  assert.deepEqual(closed, { domain: 'github.com', activityType: 'ACTIVE', startedAt: 't0', endedAt: 't1' });
});

test('closeCurrent() closes the open segment on demand and returns null if nothing was open', () => {
  const tracker = new DomainTracker();
  assert.equal(tracker.closeCurrent('t0'), null);

  tracker.recordState('github.com', 'ACTIVE', 't1');
  const closed = tracker.closeCurrent('t2');
  assert.deepEqual(closed, { domain: 'github.com', activityType: 'ACTIVE', startedAt: 't1', endedAt: 't2' });
  assert.equal(tracker.closeCurrent('t3'), null);
});

test('toPersisted()/fromPersisted() round-trip the open segment across a simulated service-worker restart', () => {
  const tracker = new DomainTracker();
  tracker.recordState('github.com', 'ACTIVE', 't0');
  const persisted = tracker.toPersisted();
  assert.deepEqual(persisted, { domain: 'github.com', activityType: 'ACTIVE', startedAt: 't0' });

  // Simulate a fresh service-worker instance restoring state from
  // chrome.storage.local instead of losing the in-progress segment.
  const restored = new DomainTracker();
  restored.fromPersisted(persisted);
  const closed = restored.closeCurrent('t1');
  assert.deepEqual(closed, { domain: 'github.com', activityType: 'ACTIVE', startedAt: 't0', endedAt: 't1' });
});

test('fromPersisted(null) leaves a fresh tracker with no open segment', () => {
  const tracker = new DomainTracker();
  tracker.fromPersisted(null);
  assert.equal(tracker.closeCurrent('t0'), null);
});
