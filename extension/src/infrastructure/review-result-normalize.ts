import type { ReviewResult } from '../domain/review-types';

function normaliseForCompare(source: string): string {
  return source.replace(/\r\n/g, '\n').trim();
}

function withoutRewriteMeta(r: ReviewResult): ReviewResult {
  return {
    ...r,
    improvedCode: undefined,
    rewriteSummary: undefined,
    rewriteAmends: undefined,
    crossFileImpacts: undefined,
  };
}

export function omitRewriteIfUnchanged(result: ReviewResult, reviewedSource: string): ReviewResult {
  const improved = result.improvedCode;
  if (improved === undefined || improved === null) {
    return withoutRewriteMeta(result);
  }
  const t = improved.trim();
  if (t.length === 0) {
    return withoutRewriteMeta(result);
  }
  if (normaliseForCompare(t) === normaliseForCompare(reviewedSource)) {
    return withoutRewriteMeta(result);
  }
  return { ...result, improvedCode: improved };
}
