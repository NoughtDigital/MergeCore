import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { parseReviewResult, ReviewResponseError } from '../review-response.guard';

test('accepts a minimal valid response', () => {
  const out = parseReviewResult({ findings: [], score: 7 });
  assert.equal(out.score, 7);
  assert.deepEqual(out.findings, []);
});

test('rejects non-object bodies', () => {
  assert.throws(() => parseReviewResult(null), ReviewResponseError);
  assert.throws(() => parseReviewResult('hi'), ReviewResponseError);
  assert.throws(() => parseReviewResult([1, 2]), ReviewResponseError);
});

test('rejects score outside [0, 10]', () => {
  assert.throws(() => parseReviewResult({ findings: [], score: 11 }), ReviewResponseError);
  assert.throws(() => parseReviewResult({ findings: [], score: -1 }), ReviewResponseError);
  assert.throws(() => parseReviewResult({ findings: [], score: Number.NaN }), ReviewResponseError);
});

test('rejects unknown severity strings', () => {
  assert.throws(
    () =>
      parseReviewResult({
        findings: [{ id: 'x', severity: 'meh', message: 'nope' }],
        score: 5,
      }),
    ReviewResponseError
  );
});

test('parses a full finding shape', () => {
  const out = parseReviewResult({
    findings: [
      {
        id: 'rule-1',
        severity: 'Warning',
        message: 'thing',
        whyItMatters: 'because',
        fixHint: 'do x',
        line: 42,
      },
    ],
    score: 8.5,
    summary: 'ok',
  });
  assert.equal(out.findings.length, 1);
  assert.equal(out.findings[0].severity, 'warning');
  assert.equal(out.findings[0].line, 42);
});

test('enforces string max lengths', () => {
  const huge = 'a'.repeat(500_000);
  assert.throws(
    () =>
      parseReviewResult({
        findings: [{ id: 'rule-1', severity: 'info', message: huge }],
        score: 5,
      }),
    ReviewResponseError
  );
});

test('caps findings array length', () => {
  const big = new Array(201).fill({ id: 'x', severity: 'info', message: 'y' });
  assert.throws(() => parseReviewResult({ findings: big, score: 5 }), ReviewResponseError);
});
