/**
 * Caching strategy for editor-grade latency and cost control.
 * Implement in API layer (Redis/Valkey). Keys must never include secrets.
 */

import { createHash } from 'node:crypto';

export interface CacheKeyParts {
  readonly tenantId: string;
  readonly rulesetVersion: string;
  readonly scope: string;
  readonly filePath: string;
  readonly contentSha256: string;
}

export function contentSha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** Primary key: exact same code + same rules version -> reuse LLM output. */
export function buildReviewCacheKey(parts: CacheKeyParts): string {
  return `review:v1:${parts.tenantId}:${parts.rulesetVersion}:${parts.scope}:${parts.filePath}:${parts.contentSha256}`;
}

/** Negative cache for empty/error responses: short TTL only. */
export function buildFailureCacheKey(parts: CacheKeyParts): string {
  return `review_fail:v1:${parts.tenantId}:${parts.rulesetVersion}:${parts.contentSha256}`;
}

/**
 * Diff-aware key: normalise diff (strip whitespace noise) then hash.
 * Useful when users re-run review on unchanged diff.
 */
export function normaliseDiffForCache(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/[ \t]+$/gm, '');
}
