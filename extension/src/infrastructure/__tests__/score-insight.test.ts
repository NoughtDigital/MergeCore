import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import type { ReviewResult } from '../../domain/review-types';
import { buildScoreInsight } from '../../presentation/webview/score-insight';

test('mock: one architecture warning → Convention fit deducted, Mock band, headline 9.45', () => {
  const result: ReviewResult = {
    score: 9.45,
    summary: 'This is a mock review so you can try the flow without an account.',
    findings: [
      {
        id: 'mock-convention-service-in-actions-repo',
        severity: 'warning',
        message: 'New Service class diverges from arch:actions-pattern.',
        category: 'architecture',
        code: 'MERGECORE_CONVENTION_DIVERGENCE',
        source: 'mock-rule',
      },
    ],
  };
  const insight = buildScoreInsight(result);
  assert.equal(insight.mockBadge, 'Mock · deterministic rules · not pack-scored');
  const style = insight.dimensions.find((d) => d.key === 'style');
  const func = insight.dimensions.find((d) => d.key === 'functionality');
  assert.ok(style);
  assert.ok(func);
  assert.equal(style!.label, 'Convention fit');
  assert.equal(style!.subScore, 9.45);
  assert.equal(style!.level, 'Mock band');
  assert.equal(func!.label, 'Rule pressure');
  assert.equal(func!.subScore, 10);
  assert.equal(func!.level, 'Mock band');
  assert.ok(!insight.dimensions.some((d) => d.level === 'Senior'));
  assert.ok(insight.pathToTen[0]?.startsWith('Mock rule hit:'));
});

test('mock: zero findings residual mentions demo variance', () => {
  const result: ReviewResult = {
    score: 9.92,
    summary: 'This is a mock review of your git diff.',
    findings: [],
  };
  const insight = buildScoreInsight(result);
  assert.match(insight.residualNote ?? '', /demo variance/);
  assert.match(insight.pathToTen[0] ?? '', /Connect the API/);
});

test('production: architecture warning buckets to style, keeps seniority labels', () => {
  const result: ReviewResult = {
    score: 9.45,
    summary: 'Reviewed against packs.',
    findings: [
      {
        id: 'arch-1',
        severity: 'warning',
        message: 'Split this module.',
        category: 'architecture',
      },
    ],
  };
  const insight = buildScoreInsight(result);
  assert.equal(insight.mockBadge, undefined);
  const style = insight.dimensions.find((d) => d.key === 'style');
  assert.equal(style?.label, 'Style and maintainability');
  assert.equal(style?.subScore, 9.45);
  assert.equal(style?.level, 'Senior');
  const func = insight.dimensions.find((d) => d.key === 'functionality');
  assert.equal(func?.label, 'Functionality and risk');
  assert.equal(func?.subScore, 10);
});
