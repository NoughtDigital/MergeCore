import * as fs from 'fs/promises';
import * as path from 'path';
import { defaultLanguageAdapters, resolveLanguageAdapter } from '../adapters';
import type {
  DependencyEdge,
  ExclusionRecord,
  IndexPhase,
  IndexStatus,
  LanguageAdapter,
  SymbolRecord,
} from '../contracts';
import {
  createTsJsCodeGraphService,
  GraphReconcileScheduler,
  isTsJsPath,
  type TsJsCodeGraphService,
} from '../graph';
import { sha256 } from '../rag/hash';
import { RagStore, STORE_SCHEMA_VERSION } from '../rag/store';
import type { RagDependencyEdge, RagSymbolRecord } from '../rag/types';
import {
  DEFAULT_MAX_FILE_BYTES,
  evaluatePathForIndex,
  languageForPath,
  scanWorkspace,
} from './workspace-scanner';

const BATCH_SIZE = 25;
const RECONCILE_DELAY_MS = 400;

export type FileChange =
  | { readonly type: 'create' | 'update'; readonly path: string }
  | { readonly type: 'delete'; readonly path: string }
  | { readonly type: 'rename'; readonly fromPath: string; readonly toPath: string };

export interface CreateRepositoryFileIndexerOptions {
  readonly workspaceRoot: string;
  readonly workspaceId?: string;
  readonly storageDir?: string;
  readonly maxFileBytes?: number;
  readonly debugExclusions?: boolean;
  readonly languageAdapters?: readonly LanguageAdapter[];
  readonly onStatus?: (status: IndexStatus) => void;
  /** When false, skip compiler graph and use heuristic adapters only. Default true. */
  readonly useCompilerGraph?: boolean;
}

export interface RepositoryFileIndexer {
  readonly workspaceRoot: string;
  readonly workspaceId: string;
  startInitialIndex(signal?: AbortSignal): Promise<IndexStatus>;
  applyFileChanges(changes: readonly FileChange[], signal?: AbortSignal): Promise<IndexStatus>;
  getIndexStatus(): Promise<IndexStatus>;
  rebuildIndex(signal?: AbortSignal): Promise<IndexStatus>;
  dispose(): Promise<void>;
  getRagStore(): RagStore;
  getCodeGraphService(): TsJsCodeGraphService | undefined;
}

function yieldEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    const err = new Error('Indexing cancelled');
    err.name = 'AbortError';
    throw err;
  }
}

function toRagSymbol(s: SymbolRecord): RagSymbolRecord {
  return {
    id: s.id,
    name: s.name,
    kind: s.kind,
    path: s.location.path,
    startLine: s.location.startLine,
    endLine: s.location.endLine,
    startColumn: s.location.startColumn,
    endColumn: s.location.endColumn,
    language: s.language,
    exported: s.exported,
    containerName: s.containerName,
    parametersJson: s.parameters ? JSON.stringify(s.parameters) : undefined,
    returnTypeText: s.returnTypeText,
    jsdocSummary: s.jsdocSummary,
    signatureText: s.signatureText,
    overloadIndex: s.overloadIndex,
  };
}

/**
 * @public
 * Create a local repository file indexer for discovery, fingerprinting, and
 * incremental updates (no semantic explanations).
 */
export async function createRepositoryFileIndexer(
  options: CreateRepositoryFileIndexerOptions
): Promise<RepositoryFileIndexer> {
  const workspaceRoot = path.resolve(options.workspaceRoot);
  const workspaceId =
    options.workspaceId ?? sha256(workspaceRoot).slice(0, 16);
  const store = await RagStore.open(workspaceRoot, {
    storageDir: options.storageDir,
    workspaceId,
  });
  store.setWorkspaceId(workspaceId);
  return new RepositoryFileIndexerImpl(workspaceRoot, workspaceId, store, options);
}

class RepositoryFileIndexerImpl implements RepositoryFileIndexer {
  private busy = false;
  private phase: IndexPhase = 'idle';
  private filesIndexed = 0;
  private filesSkipped = 0;
  private filesPending = 0;
  private lastError: string | undefined;
  private exclusions: ExclusionRecord[] = [];
  private disposed = false;
  private readonly adapters: readonly LanguageAdapter[];
  private readonly maxFileBytes: number;
  private readonly debugExclusions: boolean;
  private graph: TsJsCodeGraphService | undefined;
  private readonly reconcile: GraphReconcileScheduler | undefined;
  private graphBootstrapped = false;

  constructor(
    readonly workspaceRoot: string,
    readonly workspaceId: string,
    private store: RagStore,
    private readonly options: CreateRepositoryFileIndexerOptions
  ) {
    this.adapters = options.languageAdapters ?? defaultLanguageAdapters();
    this.maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
    this.debugExclusions = options.debugExclusions === true;
    if (options.useCompilerGraph !== false) {
      this.graph = createTsJsCodeGraphService(workspaceRoot);
      this.reconcile = new GraphReconcileScheduler(RECONCILE_DELAY_MS, (paths) =>
        this.reconcileDependents(paths)
      );
    }
  }

  getCodeGraphService(): TsJsCodeGraphService | undefined {
    return this.graph;
  }

  async getIndexStatus(): Promise<IndexStatus> {
    this.ensureAlive();
    return this.buildStatus();
  }

  async startInitialIndex(signal?: AbortSignal): Promise<IndexStatus> {
    this.ensureAlive();
    if (this.busy) {
      return this.buildStatus();
    }
    this.busy = true;
    this.phase = 'scanning';
    this.filesIndexed = 0;
    this.filesSkipped = 0;
    this.lastError = undefined;
    this.exclusions = [];
    this.emit();

    try {
      throwIfAborted(signal);
      const scan = await scanWorkspace({
        workspaceRoot: this.workspaceRoot,
        debugExclusions: this.debugExclusions,
        signal,
      });
      this.exclusions = [...scan.exclusions];
      this.filesPending = scan.files.length;
      this.phase = 'chunking';
      this.emit();

      await this.indexPathList([...scan.files], signal, /* prune */ true);
      this.phase = signal?.aborted ? 'cancelled' : 'done';
      return this.buildStatus();
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        this.phase = 'cancelled';
        this.exclusions.push({ path: '*', reason: 'cancelled' });
      } else {
        this.phase = 'error';
        this.lastError = err instanceof Error ? err.message : String(err);
      }
      return this.buildStatus();
    } finally {
      this.busy = false;
      this.filesPending = 0;
      this.emit();
    }
  }

  async applyFileChanges(
    changes: readonly FileChange[],
    signal?: AbortSignal
  ): Promise<IndexStatus> {
    this.ensureAlive();
    this.busy = true;
    this.phase = 'chunking';
    this.filesIndexed = 0;
    this.filesSkipped = 0;
    this.lastError = undefined;
    if (this.debugExclusions) {
      this.exclusions = [];
    }
    this.filesPending = changes.length;
    this.emit();

    try {
      const toIndex: string[] = [];
      const changedTsJs: string[] = [];
      for (const change of changes) {
        throwIfAborted(signal);
        if (change.type === 'delete') {
          const p = change.path.replace(/\\/g, '/');
          this.graph?.removeFile(p);
          this.store.removeFile(p);
          this.filesIndexed++;
          if (isTsJsPath(p)) {
            changedTsJs.push(p);
          }
          continue;
        }
        if (change.type === 'rename') {
          const from = change.fromPath.replace(/\\/g, '/');
          const to = change.toPath.replace(/\\/g, '/');
          this.graph?.removeFile(from);
          this.store.removeFile(from);
          toIndex.push(to);
          if (isTsJsPath(from) || isTsJsPath(to)) {
            changedTsJs.push(from, to);
          }
          continue;
        }
        const p = change.path.replace(/\\/g, '/');
        toIndex.push(p);
        if (isTsJsPath(p)) {
          changedTsJs.push(p);
        }
      }

      await this.indexPathList(toIndex, signal, /* prune */ false);

      if (this.reconcile && changedTsJs.length > 0) {
        const dependents = new Set<string>();
        for (const p of changedTsJs) {
          for (const imp of this.store.importersOf(p)) {
            if (!toIndex.includes(imp)) {
              dependents.add(imp);
            }
          }
        }
        if (dependents.size > 0) {
          this.reconcile.schedule([...dependents]);
        }
      }

      this.phase = 'done';
      return this.buildStatus();
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        this.phase = 'cancelled';
      } else {
        this.phase = 'error';
        this.lastError = err instanceof Error ? err.message : String(err);
      }
      return this.buildStatus();
    } finally {
      this.busy = false;
      this.filesPending = 0;
      this.emit();
    }
  }

  async rebuildIndex(signal?: AbortSignal): Promise<IndexStatus> {
    this.ensureAlive();
    this.store.wipe();
    await this.store.persist();
    this.graph?.dispose();
    this.graphBootstrapped = false;
    if (this.options.useCompilerGraph !== false) {
      this.graph = createTsJsCodeGraphService(this.workspaceRoot);
    }
    return this.startInitialIndex(signal);
  }

  async dispose(): Promise<void> {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.reconcile?.dispose();
    this.graph?.dispose();
    await this.store.close();
  }

  getRagStore(): RagStore {
    this.ensureAlive();
    return this.store;
  }

  private ensureAlive(): void {
    if (this.disposed) {
      throw new Error('RepositoryFileIndexer is disposed');
    }
  }

  private emit(): void {
    this.options.onStatus?.(this.buildStatus());
  }

  private buildStatus(): IndexStatus {
    return {
      workspaceRoot: this.workspaceRoot,
      workspaceId: this.workspaceId,
      ready: this.store.fileCount > 0 || this.store.chunkCount > 0,
      busy: this.busy,
      phase: this.phase,
      fileCount: this.store.fileCount,
      chunkCount: this.store.chunkCount,
      symbolCount: this.store.symbolCount,
      edgeCount: this.store.edgeCount,
      filesIndexed: this.filesIndexed,
      filesSkipped: this.filesSkipped,
      filesPending: this.filesPending,
      storeDir: this.store.storeDirectory,
      hasSqlite: this.store.hasSqlite,
      schemaVersion: STORE_SCHEMA_VERSION,
      cancellable: true,
      updatedAt: this.store.updatedAt,
      lastError: this.lastError,
      exclusions: this.debugExclusions ? this.exclusions.slice(-200) : undefined,
    };
  }

  private ensureGraphBootstrapped(): void {
    if (!this.graph || this.graphBootstrapped) {
      return;
    }
    this.graph.bootstrap();
    this.graphBootstrapped = true;
  }

  private async reconcileDependents(paths: readonly string[]): Promise<void> {
    if (this.disposed || !this.graph) {
      return;
    }
    const keep = new Set<string>();
    for (const rel of paths) {
      try {
        await this.indexOne(rel, keep, /* force */ true);
      } catch {
        // ignore per-file reconcile errors
      }
    }
    await this.store.persist();
  }

  private async indexPathList(
    paths: readonly string[],
    signal: AbortSignal | undefined,
    prune: boolean
  ): Promise<void> {
    this.ensureGraphBootstrapped();
    const keep = new Set<string>();
    for (let i = 0; i < paths.length; i++) {
      throwIfAborted(signal);
      const rel = paths[i]!;
      this.filesPending = paths.length - i;
      await this.indexOne(rel, keep);
      if ((i + 1) % BATCH_SIZE === 0) {
        await yieldEventLoop();
        this.emit();
      }
    }

    if (prune) {
      this.store.pruneMissing(keep);
    }

    this.phase = 'persisting';
    this.emit();
    await this.store.persist();
  }

  private async indexOne(
    relPath: string,
    keep: Set<string>,
    force = false
  ): Promise<void> {
    const evalResult = await evaluatePathForIndex(this.workspaceRoot, relPath, {
      debugExclusions: this.debugExclusions,
      maxFileBytes: this.maxFileBytes,
    });
    if (!evalResult.include) {
      this.filesSkipped++;
      if (evalResult.exclusion) {
        this.exclusions.push(evalResult.exclusion);
      }
      if (this.store.getFile(relPath)) {
        this.graph?.removeFile(relPath);
        this.store.removeFile(relPath);
      }
      return;
    }

    const abs = path.join(this.workspaceRoot, relPath);
    let content: Buffer;
    let mtimeMs: number;
    try {
      content = await fs.readFile(abs);
      mtimeMs = (await fs.stat(abs)).mtimeMs;
    } catch {
      this.graph?.removeFile(relPath);
      this.store.removeFile(relPath);
      this.filesSkipped++;
      return;
    }

    if (content.byteLength > this.maxFileBytes) {
      this.filesSkipped++;
      if (this.debugExclusions) {
        this.exclusions.push({
          path: relPath,
          reason: 'oversized',
          detail: `${content.byteLength}>${this.maxFileBytes}`,
        });
      }
      return;
    }

    if (content.includes(0)) {
      this.filesSkipped++;
      if (this.debugExclusions) {
        this.exclusions.push({ path: relPath, reason: 'binary', detail: 'nul-byte' });
      }
      return;
    }

    const text = content.toString('utf8');
    const hash = sha256(text);
    const existing = this.store.getFile(relPath);
    keep.add(relPath);

    if (!force && existing && existing.hash === hash) {
      this.filesSkipped++;
      return;
    }

    const adapter = resolveLanguageAdapter(relPath, this.adapters);
    const docChunks = adapter.chunk(relPath, text);

    let symbols: readonly SymbolRecord[];
    let edges: readonly DependencyEdge[];
    if (this.graph && isTsJsPath(relPath)) {
      const extracted = this.graph.extractFile(relPath, text);
      symbols = extracted.symbols;
      edges = extracted.edges;
    } else {
      symbols = adapter.extractSymbols(relPath, text);
      edges = adapter.extractDependencies(relPath, text);
    }

    const ragChunks = docChunks.map((c) => ({
      id: c.id,
      path: c.path,
      symbol: c.symbol,
      kind: c.kind,
      text: c.text,
      startLine: c.startLine,
      endLine: c.endLine,
      weight: c.weight,
      fileHash: c.fileHash,
    }));

    const ragSymbols: RagSymbolRecord[] = symbols.map(toRagSymbol);
    const ragEdges: RagDependencyEdge[] = edges.map((e) => ({ ...e }));

    this.store.replaceFileGraph(relPath, hash, mtimeMs, ragChunks, ragSymbols, ragEdges, {
      workspaceId: this.workspaceId,
      language: languageForPath(relPath),
      byteLength: content.byteLength,
      indexedAt: Date.now(),
      parseStatus: 'ok',
    });
    this.filesIndexed++;
  }
}
