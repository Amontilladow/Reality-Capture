import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { enqueueActivity, readQueue, removeFromQueue } from './queue.js';
import type { IngestActivityItem } from './types.js';

function makeItem(clientEventId: string): IngestActivityItem {
  return { clientEventId, deviceId: 'device-1', applicationNameRaw: 'Revit', activityType: 'ACTIVE', startedAt: 't0', endedAt: 't1' };
}

test('readQueue returns [] for a queue file that does not exist yet', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agent-queue-test-'));
  try {
    assert.deepEqual(readQueue(join(dir, 'queue.jsonl')), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('enqueueActivity appends one JSON line per item, in order', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agent-queue-test-'));
  const queuePath = join(dir, 'queue.jsonl');
  try {
    enqueueActivity(queuePath, makeItem('a'));
    enqueueActivity(queuePath, makeItem('b'));
    const items = readQueue(queuePath);
    assert.deepEqual(items.map(i => i.clientEventId), ['a', 'b']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('removeFromQueue removes only the given count from the front, leaving the rest', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agent-queue-test-'));
  const queuePath = join(dir, 'queue.jsonl');
  try {
    enqueueActivity(queuePath, makeItem('a'));
    enqueueActivity(queuePath, makeItem('b'));
    enqueueActivity(queuePath, makeItem('c'));

    removeFromQueue(queuePath, 2);

    assert.deepEqual(readQueue(queuePath).map(i => i.clientEventId), ['c']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
