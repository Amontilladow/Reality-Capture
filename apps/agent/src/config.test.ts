import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isPrivateModeOn, setPrivateMode } from './config.js';

test('isPrivateModeOn is false until setPrivateMode(true) creates the marker file, and false again after setPrivateMode(false)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agent-private-mode-test-'));
  const markerPath = join(dir, 'nested', 'private-mode'); // nested -- setPrivateMode must create the parent dir itself
  try {
    assert.equal(isPrivateModeOn(markerPath), false);

    setPrivateMode(true, markerPath);
    assert.equal(isPrivateModeOn(markerPath), true);

    setPrivateMode(false, markerPath);
    assert.equal(isPrivateModeOn(markerPath), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('setPrivateMode(false) on an already-off marker is a no-op, not an error', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agent-private-mode-test-'));
  const markerPath = join(dir, 'private-mode');
  try {
    assert.doesNotThrow(() => setPrivateMode(false, markerPath));
    assert.equal(isPrivateModeOn(markerPath), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
