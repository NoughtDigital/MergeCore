import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  auditTeaching,
  detectSideEffectSignal,
  extractSideEffectSignal,
} from '../teaching-audit';

test('critical finding without whyItMatters is flagged missing-why', () => {
  const report = auditTeaching({
    severity: 'critical',
    title: 'SQL injection risk',
    message: 'Raw user input is concatenated into the query.',
  });
  assert.equal(report.ok, false);
  assert.equal(report.issues[0]?.kind, 'missing-why');
  assert.equal(report.issues[0]?.field, 'whyItMatters');
});

test('warning finding without whyItMatters is also flagged', () => {
  const report = auditTeaching({
    severity: 'warning',
    message: 'Missing return type annotation.',
  });
  assert.equal(report.ok, false);
  assert.ok(report.issues.some((i) => i.kind === 'missing-why'));
});

test('info finding without whyItMatters is NOT flagged missing-why', () => {
  const report = auditTeaching({
    severity: 'info',
    message: 'Consider renaming for clarity.',
  });
  const kinds = report.issues.map((i) => i.kind);
  assert.ok(!kinds.includes('missing-why'));
});

test('shallow whyItMatters (under 60 chars) is flagged', () => {
  const report = auditTeaching({
    severity: 'error',
    message: 'Unvalidated input reaches the DB query.',
    whyItMatters: 'Bad practice.',
  });
  assert.equal(report.ok, false);
  assert.ok(report.issues.some((i) => i.kind === 'shallow-why'));
});

test('whyItMatters that restates the title is flagged', () => {
  const report = auditTeaching({
    severity: 'error',
    title: 'Unvalidated user input reaches the database query.',
    message: 'Unvalidated user input reaches the database query.',
    whyItMatters: 'Unvalidated user input reaches the database query.',
  });
  assert.equal(report.ok, false);
  assert.ok(report.issues.some((i) => i.kind === 'restates-title'));
});

test('hedged risk framing is flagged as unspecified-risk', () => {
  const report = auditTeaching({
    severity: 'error',
    message: 'Dynamic SQL executed from a user-controlled string.',
    whyItMatters:
      'Using eval like this may cause issues in production environments over time.',
  });
  assert.equal(report.ok, false);
  assert.ok(report.issues.some((i) => i.kind === 'unspecified-risk'));
});

test('strong teaching whyItMatters with concrete cost passes', () => {
  const report = auditTeaching({
    severity: 'critical',
    message: 'Raw request body concatenated into a SQL string.',
    whyItMatters:
      'An attacker controls the query shape: this is a classic SQL injection primitive that breaks caller contracts, can exfiltrate the whole users table, and turns every future caller into a potential incident.',
  });
  assert.equal(report.ok, true);
  assert.deepEqual(report.issues, []);
});

test('hidden side effect signal is detected in the message', () => {
  assert.equal(detectSideEffectSignal('This method silently swallows errors.'), true);
  assert.equal(detectSideEffectSignal('Calls an implicit cast from string to int.'), true);
  assert.equal(detectSideEffectSignal('Leaks state across requests.'), true);
  assert.equal(detectSideEffectSignal('Does what the signature says and returns.'), false);
});

test('extractSideEffectSignal returns the first matching phrase lowercased', () => {
  const phrase = extractSideEffectSignal('This method silently swallows errors.');
  assert.equal(phrase, 'silently');
  const implicit = extractSideEffectSignal('Performs an implicit cast at the boundary.');
  assert.equal(implicit, 'implicit cast');
});

test('undisclosed-side-effect fires when signal present but why lacks concrete cost', () => {
  const report = auditTeaching({
    severity: 'error',
    message: 'This handler silently returns null on every failure.',
    whyItMatters:
      'It is generally better to surface errors rather than swallow them in handlers like this one.',
  });
  assert.equal(report.ok, false);
  assert.equal(report.hasSideEffectSignal, true);
  assert.equal(report.sideEffectSignal, 'silently');
  assert.ok(report.issues.some((i) => i.kind === 'undisclosed-side-effect'));
});

test('hidden side effect explained with a concrete cost passes', () => {
  const report = auditTeaching({
    severity: 'error',
    message: 'This handler silently returns null on every failure.',
    whyItMatters:
      'Swallowing errors here breaks callers that expected an exception: a failed payment looks successful to the queue worker, and the incident surfaces hours later as data loss in the ledger.',
  });
  assert.equal(report.ok, true);
  assert.equal(report.hasSideEffectSignal, true);
  assert.equal(report.sideEffectSignal, 'silently');
});

test('hasSideEffectSignal is independent of severity', () => {
  const report = auditTeaching({
    severity: 'hint',
    message: 'Subtle: this mutates the caller object behind the scenes.',
  });
  assert.equal(report.hasSideEffectSignal, true);
});

test('missing severity defaults to info and does not require why', () => {
  const report = auditTeaching({ message: 'Note on style.' });
  assert.equal(report.ok, true);
});
