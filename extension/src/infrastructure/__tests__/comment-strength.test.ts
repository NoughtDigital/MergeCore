import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  auditCommentStrength,
  stripHedgedOpening,
} from '../../../../engine/pipeline/comment-strength';

test('stripHedgedOpening rewrites "Consider …" openings in place', () => {
  const out = stripHedgedOpening(
    'Consider refactoring this method into smaller units.'
  );
  assert.equal(out, 'Refactoring this method into smaller units.');
});

test('stripHedgedOpening rewrites "Maybe …" and similar softeners', () => {
  assert.equal(stripHedgedOpening('Maybe add a null check here.'), 'Add a null check here.');
  assert.equal(stripHedgedOpening('Might want to extract this.'), 'Extract this.');
  assert.equal(stripHedgedOpening('Perhaps split auth from persistence.'), 'Split auth from persistence.');
  assert.equal(stripHedgedOpening('Try to avoid `any` here.'), 'Avoid `any` here.');
});

test('stripHedgedOpening leaves direct comments untouched', () => {
  const direct =
    'This method mixes auth, validation and persistence. Split immediately.';
  assert.equal(stripHedgedOpening(direct), direct);
});

test('stripHedgedOpening does not touch hedges inside a sentence', () => {
  const value = 'The caller must consider the retry budget before retrying.';
  assert.equal(stripHedgedOpening(value), value);
});

test('auditCommentStrength flags hedged openings on message', () => {
  const report = auditCommentStrength({
    message: 'Consider refactor.',
    whyItMatters: 'Might cause issues.',
    fixHint: 'Could extract a helper.',
  });
  assert.equal(report.ok, false);
  const kinds = report.issues.map((i) => `${i.field}:${i.kind}`);
  assert.ok(kinds.includes('message:hedged-opening'));
  assert.ok(kinds.includes('whyItMatters:hedged-opening'));
  assert.ok(kinds.includes('fixHint:hedged-opening'));
});

test('auditCommentStrength flags empty-verdict wording', () => {
  const report = auditCommentStrength({
    message: 'This code is a bit messy.',
    fixHint: 'Could be cleaner.',
  });
  assert.equal(report.ok, false);
  assert.ok(report.issues.some((i) => i.field === 'message' && i.kind === 'empty-verdict'));
  assert.ok(report.issues.some((i) => i.field === 'fixHint' && i.kind === 'empty-verdict'));
});

test('auditCommentStrength flags bare "refactor this" as empty verdict', () => {
  const report = auditCommentStrength({ message: 'Refactor this.' });
  assert.equal(report.ok, false);
  assert.equal(report.issues[0]?.kind, 'empty-verdict');
});

test('auditCommentStrength flags too-short messages', () => {
  const report = auditCommentStrength({ message: 'Bad.' });
  assert.equal(report.ok, false);
  assert.ok(report.issues.some((i) => i.kind === 'too-short'));
});

test('auditCommentStrength passes strong, specific comments', () => {
  const report = auditCommentStrength({
    message:
      'This method mixes auth, validation and persistence. Split immediately.',
    whyItMatters:
      'Payment path has no test coverage; a regression here corrupts live ledgers.',
    fixHint:
      'Extract a PaymentGateway service and cover the happy path plus the 3D-Secure branch in Pest.',
  });
  assert.equal(report.ok, true);
  assert.deepEqual(report.issues, []);
});

test('auditCommentStrength ignores missing fields', () => {
  const report = auditCommentStrength({ message: 'This endpoint is unauthenticated. Require auth before any query.' });
  assert.equal(report.ok, true);
});

test('auditCommentStrength ignores hedges mid-sentence (only leading position)', () => {
  const report = auditCommentStrength({
    message: 'The caller should consider the retry budget before retrying this request.',
  });
  assert.equal(report.ok, true);
});
