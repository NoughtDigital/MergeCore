import * as fs from 'fs';
import * as path from 'path';
import {
  createRepositoryFileIndexer,
  retrieve,
  type FileChange,
  type IndexStatus,
  type RagHit,
  type RagStore,
  type RetrieveOptions,
  type RepositoryFileIndexer,
  type TsJsCodeGraphService,
} from '@mergecore/intelligence';
import * as vscode from 'vscode';
import { MergeCoreLogger } from '../logger';

export type IndexStatusListener = (message: string, busy: boolean) => void;
export type IndexStatusDetailListener = (status: IndexStatus) => void;

/**
 * Owns per-workspace file indexers, full/incremental indexing, and retrieve.
 *
 * Incremental path updates that arrive while a root is already indexing are
 * queued and drained after the active run finishes, so watcher batches are
 * never silently dropped during a full repository index.
 */
export class IndexerService {
  private readonly indexers = new Map<string, RepositoryFileIndexer>();
  private readonly indexing = new Set<string>();
  private readonly pendingChanges = new Map<string, FileChange[]>();
  private listeners = new Set<IndexStatusListener>();
  private detailListeners = new Set<IndexStatusDetailListener>();
  private readonly abortByRoot = new Map<string, AbortController>();

  constructor(
    private readonly logger: MergeCoreLogger,
    extensionPath: string
  ) {
    void extensionPath;
  }

  /** Embeddings remain optional; file indexing does not require them. */
  setEmbeddingPort(_port: { embed: (texts: readonly string[]) => Promise<unknown> }): void {
    void _port;
  }

  onStatus(listener: IndexStatusListener): vscode.Disposable {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  }

  onStatusDetail(listener: IndexStatusDetailListener): vscode.Disposable {
    this.detailListeners.add(listener);
    return { dispose: () => this.detailListeners.delete(listener) };
  }

  private emit(message: string, busy: boolean): void {
    for (const l of this.listeners) {
      l(message, busy);
    }
  }

  private emitDetail(status: IndexStatus): void {
    for (const l of this.detailListeners) {
      l(status);
    }
  }

  private enqueuePending(workspaceRoot: string, changes: readonly FileChange[]): void {
    let list = this.pendingChanges.get(workspaceRoot);
    if (!list) {
      list = [];
      this.pendingChanges.set(workspaceRoot, list);
    }
    list.push(...changes);
  }

  private schedulePendingDrain(workspaceRoot: string): void {
    const queued = this.pendingChanges.get(workspaceRoot);
    if (!queued || queued.length === 0) {
      this.pendingChanges.delete(workspaceRoot);
      return;
    }
    this.pendingChanges.delete(workspaceRoot);
    void this.applyChanges(workspaceRoot, queued).catch((err) => {
      this.logger.warn(
        `Pending incremental index failed: ${err instanceof Error ? err.message : String(err)}`
      );
    });
  }

  async getIndexer(workspaceRoot: string): Promise<RepositoryFileIndexer> {
    const existing = this.indexers.get(workspaceRoot);
    if (existing) {
      return existing;
    }
    const indexer = await createRepositoryFileIndexer({
      workspaceRoot,
      onStatus: (s) => {
        this.emit(s.phase === 'done' ? `Indexed ${s.chunkCount} chunks` : s.phase, s.busy);
        this.emitDetail(s);
      },
    });
    this.indexers.set(workspaceRoot, indexer);
    return indexer;
  }

  async getStore(workspaceRoot: string): Promise<RagStore> {
    const indexer = await this.getIndexer(workspaceRoot);
    return indexer.getRagStore();
  }

  /** Live TS/JS code-graph service when the compiler host is enabled. */
  getCodeGraphService(workspaceRoot: string): TsJsCodeGraphService | undefined {
    return this.indexers.get(workspaceRoot)?.getCodeGraphService();
  }

  async getIndexStatus(workspaceRoot: string): Promise<IndexStatus> {
    const indexer = await this.getIndexer(workspaceRoot);
    return indexer.getIndexStatus();
  }

  cancel(workspaceRoot: string): void {
    this.abortByRoot.get(workspaceRoot)?.abort();
  }

  async indexRepository(
    workspaceRoot: string,
    token?: vscode.CancellationToken
  ): Promise<{ chunks: number; filesIndexed: number }> {
    if (this.indexing.has(workspaceRoot)) {
      this.logger.info(`Index already running for ${workspaceRoot}`);
      const status = await this.getIndexStatus(workspaceRoot);
      return { chunks: status.chunkCount, filesIndexed: 0 };
    }

    this.indexing.add(workspaceRoot);
    this.emit('Indexing…', true);
    const ac = new AbortController();
    this.abortByRoot.set(workspaceRoot, ac);
    const sub = token?.onCancellationRequested(() => ac.abort());

    try {
      const indexer = await this.getIndexer(workspaceRoot);
      const status = await indexer.startInitialIndex(ac.signal);
      this.emitDetail(status);
      this.logger.info(
        `Indexed ${status.chunkCount} chunks (${status.filesIndexed} files updated) in ${workspaceRoot}`
      );
      this.emit(`Indexed ${status.chunkCount} chunks`, false);
      return { chunks: status.chunkCount, filesIndexed: status.filesIndexed };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Index failed: ${msg}`);
      this.emit('Index failed', false);
      throw err;
    } finally {
      sub?.dispose();
      this.abortByRoot.delete(workspaceRoot);
      this.indexing.delete(workspaceRoot);
      this.schedulePendingDrain(workspaceRoot);
    }
  }

  async rebuildRepository(
    workspaceRoot: string,
    token?: vscode.CancellationToken
  ): Promise<IndexStatus> {
    const ac = new AbortController();
    const sub = token?.onCancellationRequested(() => ac.abort());
    try {
      const indexer = await this.getIndexer(workspaceRoot);
      const status = await indexer.rebuildIndex(ac.signal);
      this.emitDetail(status);
      return status;
    } finally {
      sub?.dispose();
    }
  }

  async indexPaths(workspaceRoot: string, relPaths: readonly string[]): Promise<void> {
    const changes: FileChange[] = relPaths.map((p) => ({ type: 'update', path: p }));
    await this.applyChanges(workspaceRoot, changes);
  }

  async applyChanges(workspaceRoot: string, changes: readonly FileChange[]): Promise<void> {
    if (changes.length === 0) {
      return;
    }
    if (this.indexing.has(workspaceRoot)) {
      this.enqueuePending(workspaceRoot, changes);
      return;
    }
    this.indexing.add(workspaceRoot);
    try {
      const indexer = await this.getIndexer(workspaceRoot);
      const status = await indexer.applyFileChanges(changes);
      this.emitDetail(status);
      this.emit(`Indexed ${status.chunkCount} chunks`, false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Incremental index failed: ${msg}`);
    } finally {
      this.indexing.delete(workspaceRoot);
      this.schedulePendingDrain(workspaceRoot);
    }
  }

  async retrieve(
    workspaceRoot: string,
    query: string,
    opts: RetrieveOptions = {},
    queryEmbedding?: readonly number[]
  ): Promise<readonly RagHit[]> {
    const store = await this.getStore(workspaceRoot);
    return retrieve(store, query, opts, queryEmbedding);
  }

  async dispose(): Promise<void> {
    for (const indexer of this.indexers.values()) {
      await indexer.dispose();
    }
    this.indexers.clear();
    this.pendingChanges.clear();
    this.abortByRoot.clear();
  }

  clear(workspaceRoot?: string): void {
    if (workspaceRoot) {
      const indexer = this.indexers.get(workspaceRoot);
      if (indexer) {
        void indexer.dispose();
        this.indexers.delete(workspaceRoot);
      }
      this.pendingChanges.delete(workspaceRoot);
    } else {
      void this.dispose();
    }
  }
}

export function workspaceRootForDocument(doc: vscode.TextDocument): string | undefined {
  const folder = vscode.workspace.getWorkspaceFolder(doc.uri);
  if (folder) {
    return folder.uri.fsPath;
  }
  const roots = vscode.workspace.workspaceFolders;
  return roots?.[0]?.uri.fsPath;
}

/** @deprecated kept for tests that referenced Laravel agents path helper */
export function resolveLaravelAgentsPath(
  extensionPath: string,
  workspaceRoot: string
): string | undefined {
  const candidates = [
    path.join(extensionPath, '..', 'rules', 'packs', 'laravel-core', 'agents.md'),
    path.join(extensionPath, 'rules', 'packs', 'laravel-core', 'agents.md'),
    path.join(workspaceRoot, 'rules', 'packs', 'laravel-core', 'agents.md'),
  ];
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    } catch {
      // continue
    }
  }
  return undefined;
}
