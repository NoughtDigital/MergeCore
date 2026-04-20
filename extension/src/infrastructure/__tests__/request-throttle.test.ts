import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { RequestThrottle } from '../request-throttle';

test('debounces the same key', () => {
  const t = new RequestThrottle(1000, 2);
  assert.equal(t.check('file'), undefined);
  const release = t.begin('file');
  assert.match(String(t.check('file', Date.now() + 500)), /Please wait/);
  release();
  assert.equal(t.check('file', Date.now() + 2000), undefined);
});

test('caps concurrency across keys', () => {
  const t = new RequestThrottle(0, 2);
  const r1 = t.begin('a');
  const r2 = t.begin('b');
  assert.match(String(t.check('c')), /Another MergeCore review/);
  r1();
  assert.equal(t.check('c'), undefined);
  r2();
});

test('releaser is idempotent', () => {
  const t = new RequestThrottle(0, 1);
  const release = t.begin('x');
  release();
  release();
  assert.equal(t.check('x'), undefined);
});
