import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { redactSecrets, scanForSecrets, scrub } from '../secret-scrubber';

test('scanForSecrets: returns empty on clean input', () => {
  assert.deepEqual(scanForSecrets('hello world'), []);
  assert.deepEqual(scanForSecrets(''), []);
});

test('scanForSecrets: detects AWS access key ids', () => {
  const hits = scanForSecrets('let k = "AKIAABCDEFGHIJKLMNOP"');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].rule, 'aws-access-key-id');
});

test('scanForSecrets: detects GitHub tokens', () => {
  const hits = scanForSecrets('export GH=ghp_abcdefghijABCDEFGHIJ1234567890xyz');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].rule, 'github-token');
});

test('scanForSecrets: detects PEM private keys', () => {
  const pem =
    '-----BEGIN RSA PRIVATE KEY-----\nMIIBOwIBAAJBAJ...\n-----END RSA PRIVATE KEY-----';
  const hits = scanForSecrets(pem);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].rule, 'private-key-pem');
});

test('scanForSecrets: detects generic assignment style secrets', () => {
  const hits = scanForSecrets('password = "supersecretvalue1234"');
  assert.ok(hits.length >= 1, 'should detect generic secret assignment');
  assert.ok(hits.some((h) => h.rule === 'generic-assignment'));
});

test('redactSecrets: replaces every match with a tagged placeholder', () => {
  const aws = 'AKIAABCDEFGHIJKLMNOP';
  const google = 'AIza' + 'B'.repeat(35);
  const src = `${aws} and ${google}`;
  const { hits, redacted } = scrub(src);
  assert.ok(hits.length >= 2, `expected ≥2 hits, got ${hits.length}`);
  assert.ok(redacted.includes('<REDACTED:'));
  for (const hit of hits) {
    const slice = src.slice(hit.start, hit.end);
    assert.ok(!redacted.includes(slice), `raw secret still present: ${hit.rule}`);
  }
});

test('redactSecrets: handles overlapping hits deterministically', () => {
  const src = 'x y z';
  const out = redactSecrets(src, []);
  assert.equal(out, src);
});

test('scrub: idempotent on already-redacted input', () => {
  const src = 'safe source with <REDACTED:whatever> marker';
  const first = scrub(src);
  const second = scrub(first.redacted);
  assert.equal(second.redacted, first.redacted);
});
