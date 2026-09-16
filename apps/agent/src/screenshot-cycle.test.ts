import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runScreenshotCycle } from './screenshot-cycle.js';

test('returns "skipped-disabled" and never attempts a capture when the server says screenshots are off (403)', async () => {
  const logs: string[] = [];
  let captureCalled = false;

  const result = await runScreenshotCycle({
    requestUploadUrl: async () => { throw new Error('403'); },
    capture: async () => { captureCalled = true; return Buffer.from(''); },
    putImage: async () => undefined,
    recordScreenshot: async () => undefined,
    isForbiddenError: () => true,
    log: msg => logs.push(msg),
  });

  assert.equal(result, 'skipped-disabled');
  assert.equal(captureCalled, false);
  assert.match(logs[0], /disabled/i);
});

test('captures, uploads, and records on a successful cycle', async () => {
  const calls: string[] = [];

  const result = await runScreenshotCycle({
    requestUploadUrl: async () => ({ uploadUrl: 'https://upload', storageKey: 'key-1' }),
    capture: async () => { calls.push('capture'); return Buffer.from('fake-image'); },
    putImage: async (url, image) => { calls.push(`put:${url}:${image.toString()}`); },
    recordScreenshot: async (params) => { calls.push(`record:${params.storageKey}`); },
    isForbiddenError: () => false,
    log: () => {},
  });

  assert.equal(result, 'recorded');
  assert.deepEqual(calls, ['capture', 'put:https://upload:fake-image', 'record:key-1']);
});

test('returns "failed" (not thrown) when the upload URL request fails for a non-403 reason', async () => {
  const result = await runScreenshotCycle({
    requestUploadUrl: async () => { throw new Error('network timeout'); },
    capture: async () => Buffer.from(''),
    putImage: async () => undefined,
    recordScreenshot: async () => undefined,
    isForbiddenError: () => false,
    log: () => {},
  });
  assert.equal(result, 'failed');
});

test('returns "failed" (not thrown) when the capture/upload/record step itself fails', async () => {
  const result = await runScreenshotCycle({
    requestUploadUrl: async () => ({ uploadUrl: 'https://upload', storageKey: 'key-1' }),
    capture: async () => { throw new Error('display unavailable'); },
    putImage: async () => undefined,
    recordScreenshot: async () => undefined,
    isForbiddenError: () => false,
    log: () => {},
  });
  assert.equal(result, 'failed');
});
