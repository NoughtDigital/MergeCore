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
  /** Paths only — never full file bodies. */
  readonly notes: readonly string[];
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
}

export const DEFAULT_RETRIEVAL_BUDGETS: Required<RetrievalBudgets> = {
  maxFiles: 12,
  maxSymbols: 20,
  maxChunks: 24,
  maxDependencyDepth: 2,
  maxChars: 24_000,
  maxTokensApprox: 6_000,
};
