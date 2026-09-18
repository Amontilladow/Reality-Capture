import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadState, saveState, readQueue, enqueueActivity, removeFromQueue } from './storage.js';

// A minimal in-memory stand-in for chrome.storage.local's promise-based
// get/set shape -- real chrome.storage.local is not available under
// node --test, so every test here exercises the same interface the real
// one exposes, backed by a plain object instead.
function makeFakeStorageArea() {
  const data = {};
  return {
    async get(key) {
      return key in data ? { [key]: data[key] } : {};
    },
    async set(obj) {
      Object.assign(data, obj);
    },
  };
}

test('loadState returns defaults when nothing has been saved yet', async () => {
  const area = makeFakeStorageArea();
  const state = await loadState(area);
  assert.equal(state.deviceId, null);
  assert.equal(state.privateMode, false);
});

test('saveState merges into existing state rather than replacing it', async () => {
  const area = makeFakeStorageArea();
  await saveState(area, { serverUrl: 'https://api.example.com', deviceId: 'device-1' });
  await saveState(area, { privateMode: true });

  const state = await loadState(area);
  assert.equal(state.serverUrl, 'https://api.example.com'); // preserved from the first save
  assert.equal(state.deviceId, 'device-1');
  assert.equal(state.privateMode, true);
});

test('readQueue returns [] when nothing has been queued yet', async () => {
  const area = makeFakeStorageArea();
  assert.deepEqual(await readQueue(area), []);
});

test('enqueueActivity appends items in order', async () => {
  const area = makeFakeStorageArea();
  await enqueueActivity(area, { clientEventId: 'a' });
  await enqueueActivity(area, { clientEventId: 'b' });
  const queue = await readQueue(area);
  assert.deepEqual(queue.map((i) => i.clientEventId), ['a', 'b']);
});

test('removeFromQueue removes only the given count from the front, leaving the rest', async () => {
  const area = makeFakeStorageArea();
  await enqueueActivity(area, { clientEventId: 'a' });
  await enqueueActivity(area, { clientEventId: 'b' });
  await enqueueActivity(area, { clientEventId: 'c' });

  await removeFromQueue(area, 2);

  const queue = await readQueue(area);
  assert.deepEqual(queue.map((i) => i.clientEventId), ['c']);
});
