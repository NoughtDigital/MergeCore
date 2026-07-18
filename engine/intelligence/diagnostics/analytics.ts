import { USAGE_ANALYTICS_CATEGORIES, type UsageMetricsSnapshot } from './types';
import { scrubAnalyticsPayload } from './scrub';

export interface ScrubbedAnalyticsBundle {
  readonly exportedAt: string;
  readonly categories: readonly string[];
  readonly metrics: Record<string, unknown>;
  readonly notes: readonly string[];
}

/**
 * Build an anonymised analytics bundle for opt-in export.
 * Excludes source code, prompts, task text, filenames, and repository identity.
 */
export function buildScrubbedAnalyticsBundle(
  metrics: UsageMetricsSnapshot
): ScrubbedAnalyticsBundle {
  const raw = {
    schemaVersion: metrics.schemaVersion,
    updatedAt: metrics.updatedAt,
    contextPacksGenerated: metrics.contextPacksGenerated,
    hoverUses: metrics.hoverUses,
    explanationsOpened: metrics.explanationsOpened,
    manuallyAddedFiles: metrics.manuallyAddedFiles,
    manuallyRemovedFiles: metrics.manuallyRemovedFiles,
    lowConfidenceQueries: metrics.lowConfidenceQueries,
    retrievalLatencyMsSum: metrics.retrievalLatencyMsSum,
    retrievalLatencyCount: metrics.retrievalLatencyCount,
    indexLatencyMsSum: metrics.indexLatencyMsSum,
    indexLatencyCount: metrics.indexLatencyCount,
    parseFailureCount: metrics.parseFailureCount,
    // hashed keys only — no filenames
    frequentSourceHashes: metrics.frequentSourceHashes,
    lowConfidenceQueryFingerprints: metrics.lowConfidenceQueryFingerprints,
  };
  return {
    exportedAt: new Date().toISOString(),
    categories: [...USAGE_ANALYTICS_CATEGORIES],
    metrics: scrubAnalyticsPayload(raw),
    notes: [
      'Anonymised usage counts only.',
      'Source code, prompts, task text, filenames, and repository identity are excluded.',
      'Disable usage analytics and delete local diagnostics at any time.',
    ],
  };
}

export function analyticsCategoriesDisclosure(): readonly string[] {
  return [...USAGE_ANALYTICS_CATEGORIES];
}
