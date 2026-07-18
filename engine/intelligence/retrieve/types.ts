import type { SourceReference } from '../contracts';

/** Kind of ranked retrieval hit. */
export type RetrievalResultType =
  | 'file'
  | 'symbol'
  | 'chunk'
  | 'instruction'
  | 'test'
  | 'dependency'
  | 'architecture';

/** Whether the hit came from compiler/graph certainty or heuristics. */
export type RetrievalAnalysis = 'deterministic' | 'heuristic';

/** Per-signal score components (higher = stronger contribution). */
export interface ScoreBreakdown {
  readonly exactSymbol?: number;
  readonly symbolAlias?: number;
  readonly lexical?: number;
  readonly path?: number;
  readonly importDistance?: number;
  readonly callGraph?: number;
  readonly testRelation?: number;
  readonly instructionScope?: number;
  readonly architecture?: number;
  readonly recency?: number;
  readonly userSelected?: number;
  /** Negative penalty for generated / oversized / repetitive content. */
  readonly generatedPenalty?: number;
}

export interface RetrievalBudgets {
  readonly maxFiles?: number;
  readonly maxSymbols?: number;
  readonly maxChunks?: number;
  readonly maxDependencyDepth?: number;
  /** Approximate character budget across selected excerpts. */
  readonly maxChars?: number;
  /** Approximate token budget (chars / 4). */
  readonly maxTokensApprox?: number;
}

export interface RetrievalHit {
  readonly id: string;
  readonly resultType: RetrievalResultType;
  readonly score: number;
  readonly breakdown: ScoreBreakdown;
  readonly reference: SourceReference;
  /** Short evidence-backed reason this hit was selected. */
  readonly reason: string;
  readonly confidence: 'high' | 'medium' | 'low' | 'uncertain';
  readonly analysis: RetrievalAnalysis;
  readonly path: string;
  readonly symbolId?: string;
  readonly symbolName?: string;
  /** Estimated characters if this hit is expanded into context. */
  readonly charEstimate: number;
}

export interface FilteringDecision {
  readonly id: string;
  readonly path: string;
  readonly action: 'keep' | 'reject' | 'dedupe' | 'budget';
  readonly reason: string;
}

export type SourceFreshnessStatus = 'fresh' | 'stale' | 'missing' | 'unknown';

export interface RetrievalStageTiming {
  readonly name: string;
  readonly elapsedMs: number;
}

export interface RetrievalCandidateSummary {
  readonly id: string;
  readonly path: string;
  readonly resultType: RetrievalResultType;
  readonly score: number;
}

export interface RetrievalBudgetUsage {
  readonly maxChars: number;
  readonly usedChars: number;
  readonly maxFiles: number;
  readonly usedFiles: number;
  readonly maxSymbols: number;
  readonly usedSymbols: number;
  readonly maxChunks: number;
  readonly usedChunks: number;
}

export interface RetrievalSourceFreshness {
  readonly path: string;
  readonly status: SourceFreshnessStatus;
}

export interface RetrievalParserFailure {
  readonly path: string;
  readonly message?: string;
}

export interface RetrievalIndexHealth {
  readonly updatedAt?: number;
  readonly fileCount: number;
  readonly chunkCount: number;
  readonly schemaVersion?: number;
  readonly incomplete: boolean;
  /** True when index looks empty or never updated. */
  readonly possiblyStale: boolean;
}

export interface RetrievalDependencyPathSummary {
  readonly label: string;
  readonly paths: readonly string[];
  readonly score?: number;
}

/**
 * Explainable retrieval inspection — paths and scores only.
 * Never includes chunk text, excerpts, prompts, or task bodies.
 */
export interface RetrievalDebugInfo {
  readonly candidateCount: number;
  readonly selectedCount: number;
  readonly rejected: readonly FilteringDecision[];
  readonly filtering: readonly FilteringDecision[];
  readonly scoreComponents: ReadonlyArray<{
    readonly id: string;
    readonly breakdown: ScoreBreakdown;
    readonly total: number;
  }>;
  readonly selectedIds: readonly string[];
  readonly rejectedIds: readonly string[];
  readonly elapsedMs: number;
  /** Paths / tokens only — never full file bodies. */
  readonly notes: readonly string[];
  /** SHA-256 of original query (safe for aggregate logs). */
  readonly queryFingerprint: string;
  /** Tokenised / normalised query terms (no free-form task prose beyond tokens). */
  readonly normalisedQuery: readonly string[];
  readonly stages: readonly RetrievalStageTiming[];
  readonly candidates: readonly RetrievalCandidateSummary[];
  readonly budgetUsage: RetrievalBudgetUsage;
  readonly sourceFreshness: readonly RetrievalSourceFreshness[];
  readonly parserFailures: readonly RetrievalParserFailure[];
  readonly indexHealth: RetrievalIndexHealth;
  readonly dependencyPaths: readonly RetrievalDependencyPathSummary[];
}

/**
 * Session inspection record — may include original query for the local panel only.
 * Must not be written to aggregate metrics files.
 */
export interface RetrievalInspectionRecord {
  readonly capturedAt: number;
  readonly workspaceRoot: string;
  /** Present only in-memory / session UI — never persist to aggregate logs. */
  readonly originalQuery?: string;
  readonly result: RepositoryContextResult;
  readonly debug: RetrievalDebugInfo;
}

export interface RepositoryContextResult {
  readonly workspaceRoot: string;
  readonly query: string;
  readonly results: readonly RetrievalHit[];
  readonly incomplete: boolean;
  readonly notes?: readonly string[];
  readonly debug?: RetrievalDebugInfo;
}

export interface SearchRepositoryContextOptions {
  readonly k?: number;
  readonly pathHint?: string;
  readonly selectedFiles?: readonly string[];
  readonly budgets?: RetrievalBudgets;
  /** Extra lines of surrounding context when expanding ranges (caller preference). */
  readonly expandContextLines?: number;
  readonly preferMemory?: boolean;
  readonly debug?: boolean;
  readonly mode?: string;
  readonly profile?: string;
  /**
   * When true, omit hits whose privacy classification blocks model evidence
   * (never_send_to_model, local_only, metadata_only).
   */
  readonly forModelEvidence?: boolean;
}

export const DEFAULT_RETRIEVAL_BUDGETS: Required<RetrievalBudgets> = {
  maxFiles: 12,
  maxSymbols: 20,
  maxChunks: 24,
  maxDependencyDepth: 2,
  maxChars: 24_000,
  maxTokensApprox: 6_000,
};
