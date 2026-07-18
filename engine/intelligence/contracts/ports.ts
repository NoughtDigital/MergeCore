import type {
  ContextClaim,
  DependencyEdge,
  DocumentChunk,
  FileRecord,
  IndexStatus,
  SourceReference,
  SymbolRecord,
} from './types';

/** Parse / chunk a source file for a given language. */
export interface LanguageAdapter {
  readonly languageId: string;
  readonly extensions: readonly string[];
  supports(path: string): boolean;
  chunk(path: string, content: string): DocumentChunk[];
  extractSymbols(path: string, content: string): SymbolRecord[];
  extractDependencies(path: string, content: string): DependencyEdge[];
}

/** Persistence port for the local repository graph + chunks. */
export interface IndexStore {
  readonly workspaceRoot: string;
  readonly fileCount: number;
  readonly chunkCount: number;
  readonly symbolCount: number;
  readonly edgeCount: number;
  readonly hasSqlite: boolean;
  readonly updatedAt: number;

  getFile(path: string): FileRecord | undefined;
  allChunks(): readonly DocumentChunk[];
  allSymbols(): readonly SymbolRecord[];
  allEdges(): readonly DependencyEdge[];

  replaceFile(input: {
    readonly path: string;
    readonly contentHash: string;
    readonly mtimeMs: number;
    readonly language?: string;
    readonly chunks: readonly DocumentChunk[];
    readonly symbols: readonly SymbolRecord[];
    readonly edges: readonly DependencyEdge[];
  }): void;

  removeFile(path: string): void;
  persist(): Promise<void>;
  getStatus(): IndexStatus;
}

/** Options for repository retrieval. */
export interface RetrieveQueryOptions {
  readonly k?: number;
  readonly pathHint?: string;
  readonly preferMemory?: boolean;
  readonly mode?: string;
  readonly profile?: string;
}

/** Retrieval port over the local index. */
export interface RepositoryRetriever {
  retrieve(
    query: string,
    options?: RetrieveQueryOptions
  ): Promise<{
    readonly claims: readonly ContextClaim[];
    readonly references: readonly SourceReference[];
    readonly incomplete: boolean;
    readonly notes?: readonly string[];
  }>;
}

/**
 * Optional model provider. V0.1 does not require embeddings or LLM calls;
 * hosts may supply a local provider (e.g. Ollama) later.
 */
export interface ModelProvider {
  readonly id: string;
  embed?(texts: readonly string[]): Promise<readonly (readonly number[])[] | undefined>;
  complete?(prompt: string): Promise<string | undefined>;
}

/** No-op model provider used when no local model is configured. */
export const noopModelProvider: ModelProvider = {
  id: 'noop',
};
