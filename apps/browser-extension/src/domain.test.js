import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveTrackableDomain } from './domain.js';

test('resolves an https URL to its hostname', () => {
  assert.equal(resolveTrackableDomain('https://github.com/anthropics/claude-code'), 'github.com');
});

test('resolves an http URL to its hostname', () => {
  assert.equal(resolveTrackableDomain('http://example.com/'), 'example.com');
});

test('returns null for a browser-internal chrome:// page', () => {
  assert.equal(resolveTrackableDomain('chrome://settings/'), null);
});

test('returns null for a local file:// path -- never leaked as a trackable domain', () => {
  assert.equal(resolveTrackableDomain('file:///Users/alice/Documents/salary.xlsx'), null);
});

test('returns null for the extension\'s own pages', () => {
  assert.equal(resolveTrackableDomain('chrome-extension://abcdefghijklmnop/popup.html'), null);
});

test('returns null for an undefined/empty URL (e.g. a tab with no url permission granted)', () => {
  assert.equal(resolveTrackableDomain(undefined), null);
  assert.equal(resolveTrackableDomain(''), null);
});

test('returns null for a malformed URL rather than throwing', () => {
  assert.equal(resolveTrackableDomain('not a url'), null);
});
