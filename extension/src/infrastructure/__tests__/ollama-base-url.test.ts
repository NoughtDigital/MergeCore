import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { validateOllamaBaseUrl } from '../ollama-base-url';

test('rejects empty Ollama base URL', () => {
  assert.equal(validateOllamaBaseUrl('').ok, false);
});

test('accepts default localhost HTTP', () => {
  const r = validateOllamaBaseUrl('http://127.0.0.1:11434');
  assert.equal(r.ok, true);
  assert.equal(r.url?.origin, 'http://127.0.0.1:11434');
});

test('accepts localhost and IPv6 loopback HTTP', () => {
  assert.equal(validateOllamaBaseUrl('http://localhost:11434').ok, true);
  assert.equal(validateOllamaBaseUrl('http://[::1]:11434').ok, true);
});

test('rejects remote HTTP (settings hijack)', () => {
  const r = validateOllamaBaseUrl('http://attacker.test:11434');
  assert.equal(r.ok, false);
});

test('accepts remote HTTPS', () => {
  assert.equal(validateOllamaBaseUrl('https://ollama.example.com').ok, true);
});

test('rejects unparseable and non-http(s) schemes', () => {
  assert.equal(validateOllamaBaseUrl('not a url').ok, false);
  assert.equal(validateOllamaBaseUrl('ftp://127.0.0.1:11434').ok, false);
});

test('strips trailing slashes', () => {
  const r = validateOllamaBaseUrl('http://127.0.0.1:11434///');
  assert.equal(r.ok, true);
  assert.equal(r.url?.href, 'http://127.0.0.1:11434/');
});
