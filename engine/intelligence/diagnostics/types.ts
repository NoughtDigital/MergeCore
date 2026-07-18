export const USAGE_METRICS_SCHEMA_VERSION = 1;

export type UsageEventKind =
  | 'context_pack_generated'
  | 'hover_use'
  | 'explanation_opened'
  | 'manually_added_file'
  | 'manually_removed_file'
  | 'low_confidence_query'
  | 'retrieval_latency'
  | 'index_latency'
  | 'parse_failure'
  /** Hashed path hit only — updates frequentSourceHashes, no other counters. */
  | 'frequent_source';

export interface UsageMetricsSnapshot {
  readonly schemaVersion: number;
  readonly updatedAt: string;
  readonly contextPacksGenerated: number;
  readonly hoverUses: number;
  readonly explanationsOpened: number;
  readonly manuallyAddedFiles: number;
  readonly manuallyRemovedFiles: number;
  readonly lowConfidenceQueries: number;
  /** Sum of retrieval latencies (ms). */
  readonly retrievalLatencyMsSum: number;
  readonly retrievalLatencyCount: number;
  /** Sum of index latencies (ms). */
  readonly indexLatencyMsSum: number;
  readonly indexLatencyCount: number;
  readonly parseFailureCount: number;
  /**
   * Hashed path keys only (sha256 of workspace-relative path).
   * Never store raw filenames here for aggregate export.
   */
  readonly frequentSourceHashes: Readonly<Record<string, number>>;
  readonly lowConfidenceQueryFingerprints: readonly string[];
}

export interface UsageEvent {
  readonly kind: UsageEventKind;
  readonly at?: number;
  /** Latency sample in ms for retrieval/index events. */
  readonly latencyMs?: number;
  /** SHA-256 of relative path — never raw path in aggregate counters. */
  readonly pathHash?: string;
  /** SHA-256 of query — never raw query text. */
  readonly queryFingerprint?: string;
  readonly count?: number;
}

/** Categories disclosed before opt-in external analytics. */
export const USAGE_ANALYTICS_CATEGORIES = [
  'Context packs generated (count)',
  'Hover uses (count)',
  'Explanations opened (count)',
  'Manually added/removed files (counts; hashed path keys only when enabled)',
  'Low-confidence queries (count + query fingerprints)',
  'Retrieval latency (sum/count)',
  'Index latency (sum/count)',
  'Parse-failure counts',
] as const;

export const EMPTY_USAGE_METRICS: UsageMetricsSnapshot = {
  schemaVersion: USAGE_METRICS_SCHEMA_VERSION,
  updatedAt: new Date(0).toISOString(),
  contextPacksGenerated: 0,
  hoverUses: 0,
  explanationsOpened: 0,
  manuallyAddedFiles: 0,
  manuallyRemovedFiles: 0,
  lowConfidenceQueries: 0,
  retrievalLatencyMsSum: 0,
  retrievalLatencyCount: 0,
  indexLatencyMsSum: 0,
  indexLatencyCount: 0,
  parseFailureCount: 0,
  frequentSourceHashes: {},
  lowConfidenceQueryFingerprints: [],
};
