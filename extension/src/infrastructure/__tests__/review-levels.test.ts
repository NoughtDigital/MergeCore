import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  DEFAULT_REVIEW_LEVEL_ID,
  REVIEW_LEVELS,
  commandIdForReviewLevel,
  getReviewLevelById,
  isReviewLevelId,
} from '../../domain/review-levels';

test('REVIEW_LEVELS exposes the five canonical levels in order', () => {
  const ids = REVIEW_LEVELS.map((l) => l.id);
  assert.deepEqual(ids, ['quick', 'file', 'flow', 'pr', 'disaster']);
});

test('every review level has a unique id and badge', () => {
  const ids = new Set(REVIEW_LEVELS.map((l) => l.id));
  const badges = new Set(REVIEW_LEVELS.map((l) => l.badge));
  assert.equal(ids.size, REVIEW_LEVELS.length);
  assert.equal(badges.size, REVIEW_LEVELS.length);
});

test('isReviewLevelId rejects unknown ids without throwing', () => {
  assert.equal(isReviewLevelId('quick'), true);
  assert.equal(isReviewLevelId(''), false);
  assert.equal(isReviewLevelId('release'), false);
});

test('getReviewLevelById falls back to the default for unknown ids', () => {
  const fallback = getReviewLevelById('not-a-level');
  assert.equal(fallback.id, DEFAULT_REVIEW_LEVEL_ID);
});

test('commandIdForReviewLevel is stable and namespaced', () => {
  assert.equal(commandIdForReviewLevel('quick'), 'mergecore.review.quick');
  assert.equal(commandIdForReviewLevel('disaster'), 'mergecore.review.disaster');
});
