import type {
  ContextClaim,
  DependencyEdge,
  DocumentChunk,
  FileRecord,
  IndexStatus,
  SourceReference,
  SymbolRecord,
} from './types';

/**
 * Strength of a language-adapter capability.
 * - none: unsupported (hosts must not pretend otherwise)
 * - heuristic: pattern / convention based; not compiler-certain
 * - deterministic: parser, type-checker, or other authoritative analysis
 */
export type AdapterCapabilityLevel = 'none' | 'heuristic' | 'deterministic';

/**
 * Declares what a LanguageAdapter can and cannot do.
 * Unsupported features must remain `none` rather than silently empty.
 */
export interface LanguageAdapterCapabilities {
  readonly fileExtensionDetection: true;
  readonly projectDetection: AdapterCapabilityLevel;
  readonly parsing: AdapterCapabilityLevel;
  readonly symbolExtraction: AdapterCapabilityLevel;
  readonly importsAndDependencies: AdapterCapabilityLevel;
  readonly callersOrReferences: AdapterCapabilityLevel;
  readonly typeRelationships: AdapterCapabilityLevel;
  readonly testRelationships: AdapterCapabilityLevel;
  readonly diagnostics: AdapterCapabilityLevel;
  readonly incrementalInvalidation: AdapterCapabilityLevel;
  /**
   * When true, the indexer may prefer an external compiler / language-service
   * graph for this adapter's files when one is available.
   */
  readonly prefersCompilerGraph?: boolean;
}

/** Lightweight project detection result from an adapter. */
export interface LanguageProjectHint {
  readonly languageId: string;
  readonly adapterId: string;
  readonly confidence: 'high' | 'medium' | 'low';
  readonly signals: readonly string[];
  readonly frameworkHints?: readonly string[];
}

/** Parse / analysis diagnostic produced by an adapter (not a linter). */
export interface AdapterDiagnostic {
  readonly path: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly severity: 'error' | 'warning' | 'info';
  readonly message: string;
  readonly code?: string;
}

/** Parse / chunk a source file for a given language. */
export interface LanguageAdapter {
  /** Stable adapter identity recorded on every SymbolRecord it creates. */
  readonly adapterId: string;
  readonly languageId: string;
  readonly extensions: readonly string[];
  readonly capabilities: LanguageAdapterCapabilities;

  /** File-extension (and path) detection. */
  supports(path: string): boolean;

  /** Optional project-root detection (composer.json, tsconfig, etc.). */
  detectProject?(
    workspaceRoot: string,
    topLevelNames: readonly string[]
  ): LanguageProjectHint | undefined;

  chunk(path: string, content: string): DocumentChunk[];
  extractSymbols(path: string, content: string): SymbolRecord[];

  /** Imports, requires, and other dependency edges. */
  extractDependencies(path: string, content: string): DependencyEdge[];

  /** Callers / references where resolvable (may be heuristic). */
  extractCallersOrReferences?(
    path: string,
    content: string
  ): DependencyEdge[];

  /** Inheritance, implements, trait use, type usage. */
  extractTypeRelationships?(
    path: string,
    content: string
  ): DependencyEdge[];

  /** Test ↔ production relationships. */
  extractTestRelationships?(
    path: string,
    content: string
  ): DependencyEdge[];

  /** Adapter-level diagnostics (parse issues, unsupported constructs). */
  extractDiagnostics?(path: string, content: string): AdapterDiagnostic[];

  /**
   * Paths that should be re-indexed when `changedPath` changes, given the
   * current edge set (importers, dependents, related tests).
   */
  collectInvalidationTargets?(
    changedPath: string,
    edges: readonly DependencyEdge[]
  ): readonly string[];
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
