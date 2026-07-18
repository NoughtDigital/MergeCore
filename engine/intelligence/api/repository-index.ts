import * as path from 'path';
import type {
  ContextPack,
  ContextResult,
  IndexStatus,
  LanguageAdapter,
  ModelProvider,
  RetrieveQueryOptions,
  WorkspaceDescriptor,
} from '../contracts';
import { noopModelProvider } from '../contracts';
import { defaultLanguageAdapters } from '../adapters';
import { collectProjectProfile } from '../collect';
import { discoverInstructionDocuments } from '../memory/discover-instructions';
import type { EmbeddingPort, IndexProgressCallback } from '../rag/types';
import { indexWorkspace } from '../rag/index-workspace';
import { sha256 } from '../rag/hash';
import { LexicalRepositoryRetriever } from '../retrieve/lexical-retriever';
import { SqlJsIndexStore } from '../store/sqljs-index-store';

export interface CreateRepositoryIndexOptions {
  readonly languageAdapters?: readonly LanguageAdapter[];
  readonly modelProvider?: ModelProvider;
  readonly embedding?: EmbeddingPort;
  readonly isLaravel?: boolean;
  readonly laravelAgentsPath?: string;
}

export interface IndexOptions {
  readonly onlyPaths?: readonly string[];
  readonly onProgress?: IndexProgressCallback;
  readonly respectIgnoreFiles?: boolean;
}

export interface ContextPackOptions extends RetrieveQueryOptions {
  readonly includeInstructions?: boolean;
}

/**
 * Public handle for creating and querying a local repository index.
 * Extension and MCP hosts should prefer this API over lower-level RAG helpers.
 */
export interface RepositoryIndex {
  readonly workspaceRoot: string;
  getDescriptor(): Promise<WorkspaceDescriptor>;
  getStatus(): Promise<IndexStatus>;
  index(options?: IndexOptions): Promise<IndexStatus>;
  retrieve(query: string, options?: RetrieveQueryOptions): Promise<ContextResult>;
  buildContextPack(query: string, options?: ContextPackOptions): Promise<ContextPack>;
  close(): Promise<void>;
}

class RepositoryIndexImpl implements RepositoryIndex {
  private closed = false;

  constructor(
    readonly workspaceRoot: string,
    private indexStore: SqlJsIndexStore,
    private readonly options: CreateRepositoryIndexOptions
  ) {}

  private ensureOpen(): void {
    if (this.closed) {
      throw new Error('RepositoryIndex is closed');
    }
  }

  async getDescriptor(): Promise<WorkspaceDescriptor> {
    this.ensureOpen();
    const status = this.indexStore.getStatus();
    let languages: string[] = [];
    let fingerprint = sha256(this.workspaceRoot).slice(0, 16);
    try {
      const profile = await collectProjectProfile(this.workspaceRoot);
      languages = profile.signals.filter((s) =>
        /^(typescript|javascript|php|python|go|swift|rust|vue|react)$/i.test(s)
      );
      fingerprint = profile.fingerprint;
    } catch {
      // profile optional for descriptor
    }
    return {
      rootPath: this.workspaceRoot,
      displayName: path.basename(this.workspaceRoot) || this.workspaceRoot,
      fingerprint,
      indexedAt: status.updatedAt,
      languages,
    };
  }

  async getStatus(): Promise<IndexStatus> {
    this.ensureOpen();
    const status = this.indexStore.getStatus();
    try {
      const profile = await collectProjectProfile(this.workspaceRoot);
      return { ...status, fingerprint: profile.fingerprint };
    } catch {
      return status;
    }
  }

  async index(options: IndexOptions = {}): Promise<IndexStatus> {
    this.ensureOpen();
    let isLaravel = this.options.isLaravel;
    if (isLaravel === undefined) {
      try {
        const profile = await collectProjectProfile(this.workspaceRoot);
        isLaravel =
          profile.signals.includes('laravel') || profile.signals.includes('path:artisan');
      } catch {
        isLaravel = false;
      }
    }

    const embedding =
      this.options.embedding ??
      (this.options.modelProvider?.embed
        ? {
            embed: (texts: readonly string[]) => this.options.modelProvider!.embed!(texts),
          }
        : undefined);

    await indexWorkspace({
      workspaceRoot: this.workspaceRoot,
      store: this.indexStore.ragStore,
      embedding,
      isLaravel,
      laravelAgentsPath: this.options.laravelAgentsPath,
      onProgress: options.onProgress,
      onlyPaths: options.onlyPaths,
      languageAdapters: this.options.languageAdapters ?? defaultLanguageAdapters(),
      respectIgnoreFiles: options.respectIgnoreFiles,
    });

    // Re-open status from same store after persist
    return this.getStatus();
  }

  async retrieve(query: string, options: RetrieveQueryOptions = {}): Promise<ContextResult> {
    this.ensureOpen();
    const retriever = new LexicalRepositoryRetriever(this.indexStore);
    const result = await retriever.retrieve(query, options);
    return {
      workspaceRoot: this.workspaceRoot,
      query,
      claims: result.claims,
      references: result.references,
      incomplete: result.incomplete,
      notes: result.notes,
    };
  }

  async buildContextPack(
    query: string,
    options: ContextPackOptions = {}
  ): Promise<ContextPack> {
    this.ensureOpen();
    const result = await this.retrieve(query, options);
    const includeInstructions = options.includeInstructions !== false;
    const instructions = includeInstructions
      ? await discoverInstructionDocuments(this.workspaceRoot)
      : [];

    const packId = sha256(`${this.workspaceRoot}|${query}|${Date.now()}`).slice(0, 20);
    return {
      id: `pack:${packId}`,
      workspaceRoot: this.workspaceRoot,
      query,
      createdAt: Date.now(),
      claims: result.claims,
      instructions,
      references: result.references,
      incomplete: result.incomplete,
    };
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}

/**
 * @public
 * Create a local repository index handle for the given workspace root.
 * Indexing, parsing, and retrieval are deterministic and do not require an LLM.
 */
export async function createRepositoryIndex(
  workspaceRoot: string,
  options: CreateRepositoryIndexOptions = {}
): Promise<RepositoryIndex> {
  const root = path.resolve(workspaceRoot);
  const indexStore = await SqlJsIndexStore.open(root);
  return new RepositoryIndexImpl(root, indexStore, {
    ...options,
    modelProvider: options.modelProvider ?? noopModelProvider,
  });
}
