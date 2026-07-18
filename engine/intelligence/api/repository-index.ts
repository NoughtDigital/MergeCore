import * as path from 'path';
import type {
  ChangeImpactReport,
  ChangeImpactTarget,
  ContextPack,
  ContextResult,
  IndexStatus,
  LanguageAdapter,
  ModelProvider,
  RetrieveQueryOptions,
  TraverseBudget,
  WorkspaceDescriptor,
} from '../contracts';
import { noopModelProvider } from '../contracts';
import { defaultLanguageAdapters } from '../adapters';
import { collectProjectProfile } from '../collect';
import {
  analyseChangeImpact as analyseChangeImpactEngine,
  traverseRelationshipPaths,
} from '../graph/paths';
import {
  createRepositoryFileIndexer,
  type RepositoryFileIndexer,
} from '../indexer/repository-file-indexer';
import { discoverInstructionDocuments } from '../memory/discover-instructions';
import { classificationAllowsModelEvidence } from '../privacy/filter-evidence';
import type { EmbeddingPort, IndexProgressCallback } from '../rag/types';
import { sha256 } from '../rag/hash';
import { LexicalRepositoryRetriever } from '../retrieve/lexical-retriever';
import {
  createRepositorySearchEngine,
  type RepositoryContextResult,
  type RepositorySearchEngine,
  type RetrievalHit,
  type SearchRepositoryContextOptions,
} from '../retrieve';
import { SqlJsIndexStore } from '../store/sqljs-index-store';

export interface CreateRepositoryIndexOptions {
  readonly languageAdapters?: readonly LanguageAdapter[];
  readonly modelProvider?: ModelProvider;
  readonly embedding?: EmbeddingPort;
  readonly isLaravel?: boolean;
  readonly laravelAgentsPath?: string;
  readonly storageDir?: string;
  readonly debugExclusions?: boolean;
}

export interface IndexOptions {
  readonly onlyPaths?: readonly string[];
  readonly onProgress?: IndexProgressCallback;
  readonly respectIgnoreFiles?: boolean;
  readonly signal?: AbortSignal;
}

export interface ContextPackOptions extends RetrieveQueryOptions {
  readonly includeInstructions?: boolean;
  /** Strip never_send_to_model / local_only / metadata_only evidence from the pack. */
  readonly forModelEvidence?: boolean;
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
  searchRepositoryContext(
    query: string,
    options?: SearchRepositoryContextOptions
  ): Promise<RepositoryContextResult>;
  findRelevantFiles(
    task: string,
    options?: SearchRepositoryContextOptions
  ): Promise<readonly RetrievalHit[]>;
  findRelevantSymbols(
    task: string,
    options?: SearchRepositoryContextOptions
  ): Promise<readonly RetrievalHit[]>;
  getContextForFile(file: string): Promise<RepositoryContextResult>;
  getContextForSymbol(symbolId: string): Promise<RepositoryContextResult>;
  buildContextPack(query: string, options?: ContextPackOptions): Promise<ContextPack>;
  analyseChangeImpact(
    target: ChangeImpactTarget,
    options?: TraverseBudget
  ): Promise<ChangeImpactReport>;
  close(): Promise<void>;
}

class RepositoryIndexImpl implements RepositoryIndex {
  private closed = false;
  private searchEngine: RepositorySearchEngine | undefined;

  constructor(
    readonly workspaceRoot: string,
    private readonly fileIndexer: RepositoryFileIndexer,
    private readonly options: CreateRepositoryIndexOptions
  ) {}

  private ensureOpen(): void {
    if (this.closed) {
      throw new Error('RepositoryIndex is closed');
    }
  }

  private async getSearchEngine(): Promise<RepositorySearchEngine> {
    if (!this.searchEngine) {
      this.searchEngine = await createRepositorySearchEngine({
        store: this.fileIndexer.getRagStore(),
      });
    }
    return this.searchEngine;
  }

  async getDescriptor(): Promise<WorkspaceDescriptor> {
    this.ensureOpen();
    const status = await this.fileIndexer.getIndexStatus();
    let languages: string[] = [];
    let fingerprint = sha256(this.workspaceRoot).slice(0, 16);
    try {
      const profile = await collectProjectProfile(this.workspaceRoot);
      languages = profile.signals.filter((s) =>
        /^(typescript|javascript|php|python|go|swift|rust|vue|react)$/i.test(s)
      );
      fingerprint = profile.fingerprint;
    } catch {
      // profile optional
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
    const status = await this.fileIndexer.getIndexStatus();
    try {
      const profile = await collectProjectProfile(this.workspaceRoot);
      return { ...status, fingerprint: profile.fingerprint };
    } catch {
      return status;
    }
  }

  async index(options: IndexOptions = {}): Promise<IndexStatus> {
    this.ensureOpen();
    this.searchEngine = undefined;
    if (options.onlyPaths && options.onlyPaths.length > 0) {
      return this.fileIndexer.applyFileChanges(
        options.onlyPaths.map((p) => ({ type: 'update' as const, path: p })),
        options.signal
      );
    }
    const status = await this.fileIndexer.startInitialIndex(options.signal);
    void this.options.isLaravel;
    void this.options.embedding;
    void options.onProgress;
    return status;
  }

  async retrieve(query: string, options: RetrieveQueryOptions = {}): Promise<ContextResult> {
    this.ensureOpen();
    const indexStore = SqlJsIndexStore.fromRagStore(this.fileIndexer.getRagStore());
    const retriever = new LexicalRepositoryRetriever(indexStore);
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

  async searchRepositoryContext(
    query: string,
    options: SearchRepositoryContextOptions = {}
  ): Promise<RepositoryContextResult> {
    this.ensureOpen();
    const engine = await this.getSearchEngine();
    return engine.searchRepositoryContext(query, options);
  }

  async findRelevantFiles(
    task: string,
    options?: SearchRepositoryContextOptions
  ): Promise<readonly RetrievalHit[]> {
    this.ensureOpen();
    const engine = await this.getSearchEngine();
    return engine.findRelevantFiles(task, options);
  }

  async findRelevantSymbols(
    task: string,
    options?: SearchRepositoryContextOptions
  ): Promise<readonly RetrievalHit[]> {
    this.ensureOpen();
    const engine = await this.getSearchEngine();
    return engine.findRelevantSymbols(task, options);
  }

  async getContextForFile(file: string): Promise<RepositoryContextResult> {
    this.ensureOpen();
    const engine = await this.getSearchEngine();
    return engine.getContextForFile(file);
  }

  async getContextForSymbol(symbolId: string): Promise<RepositoryContextResult> {
    this.ensureOpen();
    const engine = await this.getSearchEngine();
    return engine.getContextForSymbol(symbolId);
  }

  async buildContextPack(
    query: string,
    options: ContextPackOptions = {}
  ): Promise<ContextPack> {
    this.ensureOpen();
    const result = await this.retrieve(query, options);
    const includeInstructions = includeInstructionsFlag(options);
    const instructions = includeInstructions
      ? await discoverInstructionDocuments(this.workspaceRoot)
      : [];

    let claims = result.claims;
    let references = result.references;
    let incomplete = result.incomplete;
    const store = this.fileIndexer.getRagStore();
    if (options.forModelEvidence) {
      claims = claims.filter((c) => {
        const refPath = c.references[0]?.path;
        if (!refPath) {
          return true;
        }
        return classificationAllowsModelEvidence(store.getFile(refPath)?.privacy);
      });
      references = references.filter((r) =>
        classificationAllowsModelEvidence(store.getFile(r.path)?.privacy)
      );
      incomplete = incomplete || claims.length === 0;
    }

    const pathHint =
      options.pathHint?.replace(/\\/g, '/') ??
      claims[0]?.references[0]?.path ??
      references[0]?.path;
    const relationshipPaths = pathHint
      ? traverseRelationshipPaths({
          store,
          start: { path: pathHint },
          budget: {
            maxDepth: 3,
            maxNodes: 40,
            maxPaths: 8,
            maxFanOutPerNode: 8,
            direction: 'both',
            weightProfile: 'default',
          },
          workspaceId: store.workspaceId ?? 'local',
        })
      : undefined;

    const packId = sha256(`${this.workspaceRoot}|${query}|${Date.now()}`).slice(0, 20);
    return {
      id: `pack:${packId}`,
      workspaceRoot: this.workspaceRoot,
      query,
      createdAt: Date.now(),
      claims,
      instructions,
      references,
      incomplete,
      ...(relationshipPaths && relationshipPaths.length > 0
        ? { relationshipPaths }
        : {}),
    };
  }

  async analyseChangeImpact(
    target: ChangeImpactTarget,
    options?: TraverseBudget
  ): Promise<ChangeImpactReport> {
    this.ensureOpen();
    return analyseChangeImpactEngine({
      store: this.fileIndexer.getRagStore(),
      workspaceRoot: this.workspaceRoot,
      target,
      budget: options,
    });
  }

  async close(): Promise<void> {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.searchEngine = undefined;
    await this.fileIndexer.dispose();
  }
}

function includeInstructionsFlag(options: ContextPackOptions): boolean {
  return options.includeInstructions !== false;
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
  const fileIndexer = await createRepositoryFileIndexer({
    workspaceRoot: root,
    storageDir: options.storageDir,
    debugExclusions: options.debugExclusions,
    languageAdapters: options.languageAdapters ?? defaultLanguageAdapters({
      workspaceRoot: root,
    }),
  });
  return new RepositoryIndexImpl(root, fileIndexer, {
    ...options,
    modelProvider: options.modelProvider ?? noopModelProvider,
  });
}
