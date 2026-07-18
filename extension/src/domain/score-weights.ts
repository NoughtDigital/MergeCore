import type { Severity } from './review-types';

/** Shared severity weights for mock headline scores and score-insight UI. */
export const SEVERITY_PENALTY: Record<Severity, number> = {
  info: 0.15,
  hint: 0.25,
  warning: 0.55,
  error: 0.85,
  critical: 1.2,
};

export type ScoreBucket = 'functionality' | 'style';

const STYLE_CATEGORIES = new Set([
  'architecture',
  'maintainability',
  'naming',
  'testing',
  'ui',
  'tooling',
  'other',
  'types',
]);

const FUNCTIONALITY_CATEGORIES = new Set([
  'security',
  'correctness',
  'reliability',
  'operability',
  'data',
]);

/**
 * Bucket by category, not severity. Architecture warnings are convention/style
 * pressure — not "Functionality and risk".
 */
export function bucketForCategory(category: string | undefined): ScoreBucket {
  const key = (category ?? 'other').toLowerCase();
  if (FUNCTIONALITY_CATEGORIES.has(key)) {
    return 'functionality';
  }
  if (STYLE_CATEGORIES.has(key)) {
    return 'style';
  }
  // Unknown categories default to style so we do not invent risk scores.
  return 'style';
}

export function penaltyForSeverity(severity: Severity): number {
  return SEVERITY_PENALTY[severity] ?? 0.25;
}

export function clampScore10(n: number): number {
  return Math.max(0, Math.min(10, Math.round(n * 100) / 100));
}
