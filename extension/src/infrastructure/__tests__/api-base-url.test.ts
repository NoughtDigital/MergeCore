import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { validateApiBaseUrl } from '../api-base-url';

test('rejects empty base URL', () => {
  const r = validateApiBaseUrl('', false);
  assert.equal(r.ok, false);
});

test('rejects the default example placeholder', () => {
  const r = validateApiBaseUrl('https://api.mergecore.example', false);
  assert.equal(r.ok, false);
});

test('accepts https origins', () => {
  const r = validateApiBaseUrl('https://api.mergecore.dev/v1', false);
  assert.equal(r.ok, true);
  assert.ok(r.url);
});

test('rejects http for remote hosts', () => {
  const r = validateApiBaseUrl('http://attacker.test', false);
  assert.equal(r.ok, false);
});

test('accepts http://localhost only when explicitly allowed', () => {
  assert.equal(validateApiBaseUrl('http://localhost:3000', false).ok, false);
  assert.equal(validateApiBaseUrl('http://localhost:3000', true).ok, true);
  assert.equal(validateApiBaseUrl('http://127.0.0.1:8080', true).ok, true);
  assert.equal(validateApiBaseUrl('http://10.0.0.5', true).ok, false);
});

test('rejects unparseable URLs', () => {
  assert.equal(validateApiBaseUrl('not a url', false).ok, false);
});

test('strips trailing slashes before parsing', () => {
  const r = validateApiBaseUrl('https://api.mergecore.dev///', false);
  assert.equal(r.ok, true);
});
