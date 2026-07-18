import * as fs from 'fs/promises';
import * as path from 'path';
import { resolveLanguageAdapter, defaultLanguageAdapters } from '../adapters';
import type { LanguageAdapter } from '../contracts';
import { createIgnoreMatcher } from '../ignore';
import { sha256 } from './hash';
import { ingestMarkdownMemory } from './markdown-memory';
import { retrieve } from './retrieve';
import { RagStore } from './store';
import type {
  EmbeddingPort,
  IndexProgressCallback,
  RagDependencyEdge,
  RagHit,
  RagSymbolRecord,
  RetrieveOptions,
} from './types';
import { walkIndexableFiles } from './walk';

export interface IndexWorkspaceOptions {
  readonly workspaceRoot: string;
  readonly store?: RagStore;
  readonly embedding?: EmbeddingPort;
  readonly isLaravel?: boolean;
  readonly laravelAgentsPath?: string;
  readonly onProgress?: IndexProgressCallback;
  /** Re-index only these relative paths when set. */
  readonly onlyPaths?: readonly string[];
  readonly languageAdapters?: readonly LanguageAdapter[];
  /** When false, skip .gitignore / .mergecoreignore (default true). */
  readonly respectIgnoreFiles?: boolean;
}

export interface IndexWorkspaceResult {
  readonly store: RagStore;
  readonly filesIndexed: number;
  readonly chunks: number;
  readonly symbols: number;
  readonly edges: number;
}

/**
 * Walk the workspace, chunk files, extract symbols/edges, optionally embed,
 * and persist under `.mergecore/rag/`. Incremental: unchanged file hashes are skipped.
 */
export async function indexWorkspace(opts: IndexWorkspaceOptions): Promise<IndexWorkspaceResult> {
  const store = opts.store ?? (await RagStore.open(opts.workspaceRoot));
  const onProgress = opts.onProgress;
  const adapters = opts.languageAdapters ?? defaultLanguageAdapters();
  const respectIgnore = opts.respectIgnoreFiles !== false;

  let files: string[];
  if (opts.onlyPaths && opts.onlyPaths.length > 0) {
    files = [...opts.onlyPaths];
  } else {
    onProgress?.({
      phase: 'scanning',
      filesDone: 0,
      filesTotal: 0,
      chunks: store.chunkCount,
      message: 'Scanning repository…',
    });
    const ignoreMatcher = respectIgnore
      ? await createIgnoreMatcher(opts.workspaceRoot)
      : undefined;
    files = await walkIndexableFiles(opts.workspaceRoot, fs, path.join, {
      ignoreMatcher,
    });
  }

  let filesIndexed = 0;
  for (let i = 0; i < files.length; i++) {
    const rel = files[i]!;
    onProgress?.({
      phase: 'chunking',
      filesDone: i,
      filesTotal: files.length,
      chunks: store.chunkCount,
      message: `Indexing ${rel}`,
    });

    const abs = path.join(opts.workspaceRoot, rel);
    let content: string;
    let mtimeMs: number;
    try {
      // Refuse symlink escape
      try {
        const real = await fs.realpath(abs);
        const rootReal = await fs.realpath(opts.workspaceRoot);
        const relCheck = path.relative(rootReal, real);
        if (relCheck.startsWith('..') || path.isAbsolute(relCheck)) {
          continue;
        }
      } catch {
        // missing / dangling — handled below
      }
      content = await fs.readFile(abs, 'utf8');
      mtimeMs = (await fs.stat(abs)).mtimeMs;
    } catch {
      store.removeFile(rel);
      continue;
    }

    // Skip oversized blobs and obvious binary (NUL)
    if (content.length > 400_000 || content.includes('\u0000')) {
      continue;
    }

    const hash = sha256(content);
    const existing = store.getFile(rel);
    if (existing && existing.hash === hash) {
      continue;
    }

    const adapter = resolveLanguageAdapter(rel, adapters);
    const docChunks = adapter.chunk(rel, content);
    const symbols = adapter.extractSymbols(rel, content);
    const edges = adapter.extractDependencies(rel, content);

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

    const ragSymbols: RagSymbolRecord[] = symbols.map((s) => ({
      id: s.id,
      name: s.name,
      kind: s.kind,
      path: s.location.path,
      startLine: s.location.startLine,
      endLine: s.location.endLine,
      language: s.language,
      exported: s.exported,
      containerName: s.containerName,
    }));

    const ragEdges: RagDependencyEdge[] = edges.map((e) => ({ ...e }));

    if (opts.embedding) {
      onProgress?.({
        phase: 'embedding',
        filesDone: i,
        filesTotal: files.length,
        chunks: store.chunkCount,
        message: `Embedding ${rel}`,
      });
      const texts = ragChunks.map((c) => c.text.slice(0, 2000));
      try {
        const vectors = await opts.embedding.embed(texts);
        if (vectors) {
          const withEmb = ragChunks.map((c, idx) => {
            const emb = vectors[idx];
            return emb ? { ...c, embedding: emb } : c;
          });
          store.replaceFileGraph(rel, hash, mtimeMs, withEmb, ragSymbols, ragEdges);
        } else {
          store.replaceFileGraph(rel, hash, mtimeMs, ragChunks, ragSymbols, ragEdges);
        }
      } catch {
        store.replaceFileGraph(rel, hash, mtimeMs, ragChunks, ragSymbols, ragEdges);
      }
    } else {
      store.replaceFileGraph(rel, hash, mtimeMs, ragChunks, ragSymbols, ragEdges);
    }
    filesIndexed++;
  }

  await ingestMarkdownMemory({
    workspaceRoot: opts.workspaceRoot,
    store,
    isLaravel: opts.isLaravel,
    laravelAgentsPath: opts.laravelAgentsPath,
  });

  onProgress?.({
    phase: 'persisting',
    filesDone: files.length,
    filesTotal: files.length,
    chunks: store.chunkCount,
    message: 'Saving index…',
  });
  await store.persist();

  onProgress?.({
    phase: 'done',
    filesDone: files.length,
    filesTotal: files.length,
    chunks: store.chunkCount,
    message: `Indexed ${store.chunkCount} chunks`,
  });

  return {
    store,
    filesIndexed,
    chunks: store.chunkCount,
    symbols: store.symbolCount,
    edges: store.edgeCount,
  };
}

export async function retrieveFromWorkspace(
  workspaceRoot: string,
  query: string,
  opts: RetrieveOptions = {},
  queryEmbedding?: readonly number[]
): Promise<RagHit[]> {
  const store = await RagStore.open(workspaceRoot);
  return retrieve(store, query, opts, queryEmbedding);
}
