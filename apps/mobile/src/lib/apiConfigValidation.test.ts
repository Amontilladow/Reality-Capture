import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveAppEnv, validateApiBaseUrlForEnv } from './apiConfigValidation';

test('resolveAppEnv trusts an explicit EXPO_PUBLIC_APP_ENV value', () => {
  assert.equal(resolveAppEnv('preview', false), 'preview');
  assert.equal(resolveAppEnv('production', false), 'production');
  assert.equal(resolveAppEnv('development', true), 'development');
});

test('resolveAppEnv falls back to __DEV__, defaulting an unmarked release build to production', () => {
  assert.equal(resolveAppEnv(undefined, true), 'development');
  assert.equal(resolveAppEnv(undefined, false), 'production');
  assert.equal(resolveAppEnv('not-a-real-env', false), 'production');
});

test('development accepts any non-empty URL, including localhost', () => {
  assert.doesNotThrow(() => validateApiBaseUrlForEnv('http://localhost:3000/api/v1', 'development'));
  assert.doesNotThrow(() => validateApiBaseUrlForEnv('http://192.168.1.20:3000/api/v1', 'development'));
});

test('empty URL is rejected for every non-development environment', () => {
  assert.throws(() => validateApiBaseUrlForEnv('', 'preview'), /No API base URL configured/);
  assert.throws(() => validateApiBaseUrlForEnv('', 'production'), /No API base URL configured/);
});

test('a valid HTTPS staging URL is accepted for preview', () => {
  assert.doesNotThrow(() => validateApiBaseUrlForEnv('https://staging-api.engineeringos.com/api/v1', 'preview'));
});

test('a valid HTTP staging URL is accepted for preview (HTTPS is not required there)', () => {
  assert.doesNotThrow(() => validateApiBaseUrlForEnv('http://staging-api.internal.engineeringos.com/api/v1', 'preview'));
});

test('preview rejects localhost, the Android emulator host, and placeholder strings', () => {
  assert.throws(() => validateApiBaseUrlForEnv('http://localhost:3000/api/v1', 'preview'), /placeholder or a local-development address/);
  assert.throws(() => validateApiBaseUrlForEnv('http://10.0.2.2:3000/api/v1', 'preview'), /placeholder or a local-development address/);
  assert.throws(() => validateApiBaseUrlForEnv('REPLACE_WITH_STAGING_API_URL', 'preview'), /placeholder or a local-development address/);
});

test('a valid HTTPS production URL is accepted', () => {
  assert.doesNotThrow(() => validateApiBaseUrlForEnv('https://api.engineeringos.com/api/v1', 'production'));
});

test('production rejects an HTTP URL even if it is otherwise a real domain', () => {
  assert.throws(() => validateApiBaseUrlForEnv('http://api.engineeringos.com/api/v1', 'production'), /requires an HTTPS/);
});

test('production rejects localhost, 127.0.0.1, the Android emulator host, and placeholder strings', () => {
  assert.throws(() => validateApiBaseUrlForEnv('https://localhost/api/v1', 'production'), /placeholder or a local-development address/);
  assert.throws(() => validateApiBaseUrlForEnv('https://127.0.0.1/api/v1', 'production'), /placeholder or a local-development address/);
  assert.throws(() => validateApiBaseUrlForEnv('https://10.0.2.2/api/v1', 'production'), /placeholder or a local-development address/);
  assert.throws(() => validateApiBaseUrlForEnv('REPLACE_WITH_PRODUCTION_API_URL', 'production'), /placeholder or a local-development address/);
});

test('production rejects a bare private-network IP address', () => {
  assert.throws(() => validateApiBaseUrlForEnv('https://10.20.30.40/api/v1', 'production'), /private-network address/);
  assert.throws(() => validateApiBaseUrlForEnv('https://192.168.1.50/api/v1', 'production'), /private-network address/);
  assert.throws(() => validateApiBaseUrlForEnv('https://172.16.5.5/api/v1', 'production'), /private-network address/);
});

test('production does not flag a normal public domain that merely contains digits', () => {
  assert.doesNotThrow(() => validateApiBaseUrlForEnv('https://api-v2.engineeringos.com/api/v1', 'production'));
});
