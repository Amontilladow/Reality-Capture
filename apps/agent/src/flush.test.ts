import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { flushQueue } from './flush.js';
import { enqueueActivity, readQueue } from './queue.js';
import type { IngestActivityItem } from './types.js';

function makeItem(clientEventId: string): IngestActivityItem {
  return { clientEventId, deviceId: 'device-1', applicationNameRaw: 'Revit', activityType: 'ACTIVE', startedAt: 't0', endedAt: 't1' };
}

test('returns null and calls nothing when the queue is empty', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'agent-flush-test-'));
  const queuePath = join(dir, 'queue.jsonl');
  try {
    let called = false;
    const result = await flushQueue(queuePath, async () => { called = true; return { total: 0, inserted: 0, duplicates: 0, rejected: 0 }; });
    assert.equal(result, null);
    assert.equal(called, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('removes flushed items from the queue only after a successful ingest', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'agent-flush-test-'));
  const queuePath = join(dir, 'queue.jsonl');
  try {
    enqueueActivity(queuePath, makeItem('a'));
    enqueueActivity(queuePath, makeItem('b'));

    const result = await flushQueue(queuePath, async items => ({ total: items.length, inserted: items.length, duplicates: 0, rejected: 0 }));

    assert.deepEqual(result, { total: 2, inserted: 2, duplicates: 0, rejected: 0 });
    assert.deepEqual(readQueue(queuePath), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('leaves the queue untouched when ingest throws (offline-first retry behavior)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'agent-flush-test-'));
  const queuePath = join(dir, 'queue.jsonl');
  try {
    enqueueActivity(queuePath, makeItem('a'));

    await assert.rejects(
      flushQueue(queuePath, async () => { throw new Error('network down'); }),
    );

    assert.deepEqual(readQueue(queuePath).map(i => i.clientEventId), ['a']); // still queued, not lost
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('caps a single flush at 500 items, leaving the rest queued', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'agent-flush-test-'));
  const queuePath = join(dir, 'queue.jsonl');
  try {
    for (let i = 0; i < 501; i++) enqueueActivity(queuePath, makeItem(`item-${i}`));

    let receivedCount = 0;
    await flushQueue(queuePath, async (items) => {
      receivedCount = items.length;
      return { total: items.length, inserted: items.length, duplicates: 0, rejected: 0 };
    });

    assert.equal(receivedCount, 500);
    assert.equal(readQueue(queuePath).length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
