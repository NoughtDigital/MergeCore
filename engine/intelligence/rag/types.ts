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
}

export interface ExplanationCacheEntry {
  readonly key: string;
  readonly markdown: string;
  readonly mode: ExplanationMode;
  readonly createdAt: number;
}

export interface RagStoreSnapshot {
  readonly version: 1;
  readonly workspaceRoot: string;
  readonly updatedAt: number;
  readonly files: Record<string, RagFileRecord>;
  readonly chunks: Record<string, RagChunk>;
  readonly explanations: Record<string, ExplanationCacheEntry>;
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
