/** Chunk kinds stored in the local RAG database. */
export type RagChunkKind = 'source' | 'memory' | 'config';

export type ExplanationMode = 'junior' | 'mid' | 'senior' | 'expert';

/** Future / optional reasoning profiles that bias evaluation. */
export type IntelligenceProfile =
  | 'default'
  | 'startup-mvp'
  | 'enterprise'
  | 'performance'
  | 'security'
  | 'solo-founder'
  | 'rapid-prototyping'
  | 'ai-safety';

export interface RagChunk {
  readonly id: string;
  readonly path: string;
  readonly symbol?: string;
  readonly kind: RagChunkKind;
  readonly text: string;
  readonly startLine: number;
  readonly endLine: number;
  /** Relative weight boost for retrieval (memory > source). */
  readonly weight: number;
  readonly fileHash: string;
  /** Optional embedding vector when a local embed model is available. */
  readonly embedding?: readonly number[];
}

export interface RagFileRecord {
  readonly path: string;
  readonly hash: string;
  readonly mtimeMs: number;
  readonly chunkIds: readonly string[];
  readonly workspaceId?: string;
  readonly language?: string;
  readonly byteLength?: number;
  readonly indexedAt?: number;
  readonly parseStatus?: 'ok' | 'skipped' | 'error' | 'unchanged';
}

export interface ExplanationCacheEntry {
  readonly key: string;
  readonly markdown: string;
  readonly mode: ExplanationMode;
  readonly createdAt: number;
}

/** Stored symbol row (mirrors contracts.SymbolRecord for persistence). */
export interface RagSymbolRecord {
  readonly id: string;
  readonly name: string;
  readonly kind: string;
  readonly path: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly language: string;
  readonly exported?: boolean;
  readonly containerName?: string;
  readonly startColumn?: number;
  readonly endColumn?: number;
  readonly parametersJson?: string;
  readonly returnTypeText?: string;
  readonly jsdocSummary?: string;
  readonly signatureText?: string;
  readonly overloadIndex?: number;
  /** Language adapter that produced this symbol. */
  readonly adapterId?: string;
}

/** Stored dependency edge (mirrors contracts.DependencyEdge). */
export interface RagDependencyEdge {
  readonly id: string;
  readonly fromPath: string;
  readonly toPath: string;
  readonly kind:
    | 'import'
    | 'require'
    | 'export'
    | 'reference'
    | 'call'
    | 'extends'
    | 'implements'
    | 'typeUsage'
    | 'fileDependency'
    | 'likelyTestCoverage';
  readonly specifier: string;
  readonly fromSymbol?: string;
  readonly toSymbol?: string;
  readonly startLine?: number;
  readonly startColumn?: number;
  readonly endLine?: number;
  readonly endColumn?: number;
  readonly confidence?: 'certain' | 'high' | 'medium' | 'low' | 'heuristic';
  readonly resolutionMethod?:
    | 'compiler'
    | 'ast'
    | 'convention'
    | 'typescript-checker'
    | 'typescript-ast'
    | 'path-alias'
    | 'naming-heuristic'
    | 'import-graph'
    | 'unresolved'
    | 'heuristic';
  readonly evidence?: readonly string[];
}

/**
 * On-disk snapshot version. v1–v3 readable; new writes use version 4.
 */
export interface RagStoreSnapshot {
  readonly version: 1 | 2 | 3 | 4;
  readonly workspaceRoot: string;
  readonly workspaceId?: string;
  readonly updatedAt: number;
  readonly files: Record<string, RagFileRecord>;
  readonly chunks: Record<string, RagChunk>;
  readonly explanations: Record<string, ExplanationCacheEntry>;
  readonly symbols?: Record<string, RagSymbolRecord>;
  readonly edges?: readonly RagDependencyEdge[];
}

export interface RagHit {
  readonly chunk: RagChunk;
  readonly score: number;
  readonly source: 'lexical' | 'vector' | 'hybrid' | 'fts';
}

export interface RetrieveOptions {
  readonly k?: number;
  readonly mode?: ExplanationMode;
  readonly profile?: IntelligenceProfile;
  /** Prefer chunks whose path shares a prefix with this path. */
  readonly pathHint?: string;
  /** When true, memory chunks receive an extra score boost. */
  readonly preferMemory?: boolean;
}

export interface IndexProgress {
  readonly phase: 'scanning' | 'chunking' | 'embedding' | 'persisting' | 'done';
  readonly filesDone: number;
  readonly filesTotal: number;
  readonly chunks: number;
  readonly message: string;
}

export type IndexProgressCallback = (progress: IndexProgress) => void;

export interface EmbeddingPort {
  embed(texts: readonly string[]): Promise<readonly (readonly number[])[] | undefined>;
}
