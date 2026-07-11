import * as fs from 'fs/promises';
import * as path from 'path';
import { chunkFile } from './chunker';
import { sha256 } from './hash';
import { ingestMarkdownMemory } from './markdown-memory';
import { retrieve } from './retrieve';
import { RagStore } from './store';
import type {
  EmbeddingPort,
  IndexProgressCallback,
  RagHit,
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
}

export interface IndexWorkspaceResult {
  readonly store: RagStore;
  readonly filesIndexed: number;
  readonly chunks: number;
}

/**
 * Walk the workspace, chunk files, optionally embed, and persist under
 * `.mergecore/rag/`. Incremental: unchanged file hashes are skipped.
 */
export async function indexWorkspace(opts: IndexWorkspaceOptions): Promise<IndexWorkspaceResult> {
  const store = opts.store ?? (await RagStore.open(opts.workspaceRoot));
  const onProgress = opts.onProgress;

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
    files = await walkIndexableFiles(opts.workspaceRoot, fs, path.join);
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
      content = await fs.readFile(abs, 'utf8');
      mtimeMs = (await fs.stat(abs)).mtimeMs;
    } catch {
      store.removeFile(rel);
      continue;
    }

    // Skip oversized blobs
    if (content.length > 400_000) {
      continue;
    }

    const hash = sha256(content);
    const existing = store.getFile(rel);
    if (existing && existing.hash === hash) {
      continue;
    }

    const chunks = chunkFile(rel, content);
    if (opts.embedding) {
      onProgress?.({
        phase: 'embedding',
        filesDone: i,
        filesTotal: files.length,
        chunks: store.chunkCount,
        message: `Embedding ${rel}`,
      });
      const texts = chunks.map((c) => c.text.slice(0, 2000));
      try {
        const vectors = await opts.embedding.embed(texts);
        if (vectors) {
          const withEmb = chunks.map((c, idx) => {
            const emb = vectors[idx];
            return emb ? { ...c, embedding: emb } : c;
          });
          store.replaceFile(rel, hash, mtimeMs, withEmb);
        } else {
          store.replaceFile(rel, hash, mtimeMs, chunks);
        }
      } catch {
        store.replaceFile(rel, hash, mtimeMs, chunks);
      }
    } else {
      store.replaceFile(rel, hash, mtimeMs, chunks);
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

  return { store, filesIndexed, chunks: store.chunkCount };
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
