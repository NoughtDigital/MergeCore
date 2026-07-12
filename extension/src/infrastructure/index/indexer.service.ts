import * as fs from 'fs';
import * as path from 'path';
import {
  indexWorkspace,
  RagStore,
  retrieve,
  type EmbeddingPort,
  type IndexProgress,
  type RagHit,
  type RetrieveOptions,
} from '@mergecore/intelligence';
import * as vscode from 'vscode';
import { MergeCoreLogger } from '../logger';
import { getProjectProfileCached } from '../project-profile-cache';

export type IndexStatusListener = (message: string, busy: boolean) => void;

/**
 * Owns per-workspace RagStore instances, full/incremental indexing, and retrieve.
 *
 * Incremental path updates that arrive while a root is already indexing are
 * queued and drained after the active run finishes, so watcher batches are
 * never silently dropped during a full repository index.
 */
export class IndexerService {
  private readonly stores = new Map<string, RagStore>();
  private readonly indexing = new Set<string>();
  private readonly pendingPaths = new Map<string, Set<string>>();
  private listeners = new Set<IndexStatusListener>();
  private embedding: EmbeddingPort | undefined;

  constructor(
    private readonly logger: MergeCoreLogger,
    private readonly extensionPath: string
  ) {}

  setEmbeddingPort(port: EmbeddingPort | undefined): void {
    this.embedding = port;
  }

  onStatus(listener: IndexStatusListener): vscode.Disposable {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  }

  private emit(message: string, busy: boolean): void {
    for (const l of this.listeners) {
      l(message, busy);
    }
  }

  private enqueuePending(workspaceRoot: string, relPaths: readonly string[]): void {
    let set = this.pendingPaths.get(workspaceRoot);
    if (!set) {
      set = new Set();
      this.pendingPaths.set(workspaceRoot, set);
    }
    for (const rel of relPaths) {
      if (rel) {
        set.add(rel);
      }
    }
  }

  /** Take queued paths and schedule an incremental run once the lock is free. */
  private schedulePendingDrain(workspaceRoot: string): void {
    const queued = this.pendingPaths.get(workspaceRoot);
    if (!queued || queued.size === 0) {
      this.pendingPaths.delete(workspaceRoot);
      return;
    }
    this.pendingPaths.delete(workspaceRoot);
    void this.indexPaths(workspaceRoot, [...queued]).catch((err) => {
      this.logger.warn(
        `Pending incremental index failed: ${err instanceof Error ? err.message : String(err)}`
      );
    });
  }

  async getStore(workspaceRoot: string): Promise<RagStore> {
    const existing = this.stores.get(workspaceRoot);
    if (existing) {
      return existing;
    }
    const store = await RagStore.open(workspaceRoot);
    this.stores.set(workspaceRoot, store);
    return store;
  }

  async indexRepository(workspaceRoot: string): Promise<{ chunks: number; filesIndexed: number }> {
    if (this.indexing.has(workspaceRoot)) {
      this.logger.info(`Index already running for ${workspaceRoot}`);
      const store = await this.getStore(workspaceRoot);
      return { chunks: store.chunkCount, filesIndexed: 0 };
    }

    this.indexing.add(workspaceRoot);
    this.emit('Indexing…', true);
    try {
      const profile = await getProjectProfileCached(workspaceRoot);
      const isLaravel =
        profile.signals.includes('laravel') || profile.signals.includes('path:artisan');
      const laravelAgentsPath = isLaravel
        ? resolveLaravelAgentsPath(this.extensionPath, workspaceRoot)
        : undefined;

      const onProgress = (p: IndexProgress): void => {
        this.emit(p.message, p.phase !== 'done');
      };

      const result = await indexWorkspace({
        workspaceRoot,
        store: await this.getStore(workspaceRoot),
        embedding: this.embedding,
        isLaravel,
        laravelAgentsPath,
        onProgress,
      });
      this.stores.set(workspaceRoot, result.store);
      this.logger.info(
        `Indexed ${result.chunks} chunks (${result.filesIndexed} files updated) in ${workspaceRoot}`
      );
      this.emit(`Indexed ${result.chunks} chunks`, false);
      return { chunks: result.chunks, filesIndexed: result.filesIndexed };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Index failed: ${msg}`);
      this.emit('Index failed', false);
      throw err;
    } finally {
      this.indexing.delete(workspaceRoot);
      this.schedulePendingDrain(workspaceRoot);
    }
  }

  async indexPaths(workspaceRoot: string, relPaths: readonly string[]): Promise<void> {
    if (relPaths.length === 0) {
      return;
    }
    if (this.indexing.has(workspaceRoot)) {
      this.enqueuePending(workspaceRoot, relPaths);
      return;
    }
    this.indexing.add(workspaceRoot);
    try {
      const profile = await getProjectProfileCached(workspaceRoot);
      const isLaravel =
        profile.signals.includes('laravel') || profile.signals.includes('path:artisan');
      const result = await indexWorkspace({
        workspaceRoot,
        store: await this.getStore(workspaceRoot),
        embedding: this.embedding,
        isLaravel,
        laravelAgentsPath: isLaravel
          ? resolveLaravelAgentsPath(this.extensionPath, workspaceRoot)
          : undefined,
        onlyPaths: relPaths,
      });
      this.stores.set(workspaceRoot, result.store);
      this.emit(`Indexed ${result.chunks} chunks`, false);
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

  clear(workspaceRoot?: string): void {
    if (workspaceRoot) {
      this.stores.delete(workspaceRoot);
      this.pendingPaths.delete(workspaceRoot);
    } else {
      this.stores.clear();
      this.pendingPaths.clear();
    }
  }
}

function resolveLaravelAgentsPath(extensionPath: string, workspaceRoot: string): string | undefined {
  const candidates = [
    path.join(extensionPath, '..', 'rules', 'packs', 'laravel-core', 'agents.md'),
    path.join(extensionPath, 'rules', 'packs', 'laravel-core', 'agents.md'),
    path.join(workspaceRoot, 'rules', 'packs', 'laravel-core', 'agents.md'),
    path.resolve(workspaceRoot, '..', 'rules', 'packs', 'laravel-core', 'agents.md'),
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
  return candidates[0];
}

export function workspaceRootForDocument(doc: vscode.TextDocument): string | undefined {
  const folder = vscode.workspace.getWorkspaceFolder(doc.uri);
  if (folder) {
    return folder.uri.fsPath;
  }
  const roots = vscode.workspace.workspaceFolders;
  return roots?.[0]?.uri.fsPath;
}
