import * as fs from 'fs/promises';
import * as path from 'path';
import type { Database } from 'sql.js';
import type {
  ExplanationCacheEntry,
  ExplanationMode,
  RagChunk,
  RagChunkKind,
  RagFileRecord,
  RagStoreSnapshot,
} from './types';

const STORE_DIR = '.mergecore/rag';
const SQLITE_FILE = 'index.sqlite';
const JSON_MIRROR = 'index.json';
const STORE_VERSION = 1 as const;

export function ragStoreDir(workspaceRoot: string): string {
  return path.join(workspaceRoot, STORE_DIR);
}

export function ragStorePath(workspaceRoot: string): string {
  return path.join(ragStoreDir(workspaceRoot), SQLITE_FILE);
}

export function ragJsonMirrorPath(workspaceRoot: string): string {
  return path.join(ragStoreDir(workspaceRoot), JSON_MIRROR);
}

export function emptySnapshot(workspaceRoot: string): RagStoreSnapshot {
  return {
    version: STORE_VERSION,
    workspaceRoot,
    updatedAt: Date.now(),
    files: {},
    chunks: {},
    explanations: {},
  };
}

async function loadSql(): Promise<{
  Database: new (data?: ArrayLike<number> | Buffer | null) => Database;
}> {
  const fs = await import('fs');
  const pathMod = await import('path');
  // Prefer WASM binary (includes FTS4). Fall back to asm.js.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const initSqlJs = require('sql.js') as (cfg?: {
    wasmBinary?: Buffer;
  }) => Promise<{ Database: new (data?: ArrayLike<number> | Buffer | null) => Database }>;
  try {
    const wasmPath = require.resolve('sql.js/dist/sql-wasm.wasm');
    const wasmBinary = fs.readFileSync(wasmPath);
    return await initSqlJs({ wasmBinary });
  } catch {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const asm = require('sql.js/dist/sql-asm.js') as
      | ((cfg?: object) => Promise<{ Database: new (data?: ArrayLike<number> | Buffer | null) => Database }>)
      | {
          default: (cfg?: object) => Promise<{
            Database: new (data?: ArrayLike<number> | Buffer | null) => Database;
          }>;
        };
    const init = typeof asm === 'function' ? asm : asm.default;
    void pathMod;
    return init({});
  }
}

function schema(db: Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS files (
      path TEXT PRIMARY KEY,
      hash TEXT NOT NULL,
      mtime_ms REAL NOT NULL
    );
    CREATE TABLE IF NOT EXISTS chunks (
      id TEXT PRIMARY KEY,
      path TEXT NOT NULL,
      symbol TEXT,
      kind TEXT NOT NULL,
      text TEXT NOT NULL,
      start_line INTEGER NOT NULL,
      end_line INTEGER NOT NULL,
      weight REAL NOT NULL,
      file_hash TEXT NOT NULL,
      embedding BLOB
    );
    CREATE TABLE IF NOT EXISTS explanations (
      key TEXT PRIMARY KEY,
      markdown TEXT NOT NULL,
      mode TEXT NOT NULL,
      created_at REAL NOT NULL
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts4(
      id,
      path,
      symbol,
      kind,
      text
    );
  `);
  db.run(`INSERT OR REPLACE INTO meta(key, value) VALUES ('version', '1')`);
}

/**
 * Local RAG persistence under `.mergecore/rag/index.sqlite` with FTS4
 * (sql.js includes FTS4; FTS5 is unavailable in the stock build).
 * Keeps an in-memory snapshot for fast access and mirrors JSON for migration.
 */
export class RagStore {
  private snapshot: RagStoreSnapshot;
  private dirty = false;
  private db: Database | undefined;

  private constructor(snapshot: RagStoreSnapshot, db?: Database) {
    this.snapshot = snapshot;
    this.db = db;
  }

  static async open(workspaceRoot: string): Promise<RagStore> {
    const dir = ragStoreDir(workspaceRoot);
    await fs.mkdir(dir, { recursive: true });
    const sqlitePath = ragStorePath(workspaceRoot);

    try {
      const SQL = await loadSql();
      let db: Database;
      try {
        const buf = await fs.readFile(sqlitePath);
        db = new SQL.Database(buf);
      } catch {
        db = new SQL.Database();
      }
      schema(db);

      // Migrate from legacy JSON mirror if sqlite empty
      const countRow = db.exec('SELECT COUNT(*) AS c FROM chunks');
      const count = Number(countRow[0]?.values[0]?.[0] ?? 0);
      if (count === 0) {
        const migrated = await tryLoadJsonMirror(workspaceRoot);
        if (migrated && Object.keys(migrated.chunks).length > 0) {
          const store = new RagStore(migrated, db);
          store.dirty = true;
          await store.persist();
          return store;
        }
      }

      const snapshot = hydrateFromDb(workspaceRoot, db);
      return new RagStore(snapshot, db);
    } catch {
      // Fallback: JSON-only if sql.js fails to load
      const migrated = await tryLoadJsonMirror(workspaceRoot);
      return new RagStore(migrated ?? emptySnapshot(workspaceRoot));
    }
  }

  get root(): string {
    return this.snapshot.workspaceRoot;
  }

  get chunkCount(): number {
    return Object.keys(this.snapshot.chunks).length;
  }

  get fileCount(): number {
    return Object.keys(this.snapshot.files).length;
  }

  /** True when backed by SQLite FTS5. */
  get hasSqlite(): boolean {
    return this.db !== undefined;
  }

  getFile(relPath: string): RagFileRecord | undefined {
    return this.snapshot.files[normalise(relPath)];
  }

  allChunks(): readonly RagChunk[] {
    return Object.values(this.snapshot.chunks);
  }

  /**
   * FTS5 lexical search. Returns chunk ids with rank scores (higher better).
   * Falls back to empty when SQLite is unavailable.
   */
  ftsSearch(query: string, limit = 20): ReadonlyArray<{ id: string; rank: number }> {
    if (!this.db || !query.trim()) {
      return [];
    }
    const terms = query
      .toLowerCase()
      .split(/[^a-z0-9_]+/g)
      .filter((t) => t.length > 1)
      .slice(0, 12);
    if (terms.length === 0) {
      return [];
    }
    const match = terms.join(' OR ');
    try {
      const stmt = this.db.prepare(
        `SELECT id FROM chunks_fts WHERE chunks_fts MATCH ? LIMIT ?`
      );
      stmt.bind([match, limit]);
      const out: Array<{ id: string; rank: number }> = [];
      let i = 0;
      while (stmt.step()) {
        const row = stmt.getAsObject() as { id: string };
        out.push({ id: row.id, rank: limit - i });
        i++;
      }
      stmt.free();
      return out;
    } catch {
      return [];
    }
  }

  replaceFile(relPath: string, hash: string, mtimeMs: number, chunks: readonly RagChunk[]): void {
    const key = normalise(relPath);
    const existing = this.snapshot.files[key];
    if (existing) {
      for (const id of existing.chunkIds) {
        delete this.snapshot.chunks[id];
      }
    }
    const nextChunks: Record<string, RagChunk> = { ...this.snapshot.chunks };
    const ids: string[] = [];
    for (const chunk of chunks) {
      nextChunks[chunk.id] = chunk;
      ids.push(chunk.id);
    }
    this.snapshot = {
      ...this.snapshot,
      chunks: nextChunks,
      files: {
        ...this.snapshot.files,
        [key]: { path: key, hash, mtimeMs, chunkIds: ids },
      },
      updatedAt: Date.now(),
    };
    this.dirty = true;
  }

  removeFile(relPath: string): void {
    const key = normalise(relPath);
    const existing = this.snapshot.files[key];
    if (!existing) {
      return;
    }
    const nextChunks = { ...this.snapshot.chunks };
    for (const id of existing.chunkIds) {
      delete nextChunks[id];
    }
    const nextFiles = { ...this.snapshot.files };
    delete nextFiles[key];
    this.snapshot = {
      ...this.snapshot,
      chunks: nextChunks,
      files: nextFiles,
      updatedAt: Date.now(),
    };
    this.dirty = true;
  }

  setChunkEmbedding(chunkId: string, embedding: readonly number[]): void {
    const chunk = this.snapshot.chunks[chunkId];
    if (!chunk) {
      return;
    }
    this.snapshot = {
      ...this.snapshot,
      chunks: {
        ...this.snapshot.chunks,
        [chunkId]: { ...chunk, embedding },
      },
      updatedAt: Date.now(),
    };
    this.dirty = true;
  }

  getExplanation(key: string): ExplanationCacheEntry | undefined {
    return this.snapshot.explanations[key];
  }

  setExplanation(entry: ExplanationCacheEntry): void {
    this.snapshot = {
      ...this.snapshot,
      explanations: {
        ...this.snapshot.explanations,
        [entry.key]: entry,
      },
      updatedAt: Date.now(),
    };
    this.dirty = true;
  }

  explanationKey(fileHash: string, symbol: string, mode: ExplanationMode): string {
    return `${fileHash}|${symbol}|${mode}`;
  }

  async persist(): Promise<void> {
    if (!this.dirty) {
      return;
    }
    const dir = ragStoreDir(this.snapshot.workspaceRoot);
    await fs.mkdir(dir, { recursive: true });
    const gitignore = path.join(dir, '.gitignore');
    try {
      await fs.access(gitignore);
    } catch {
      await fs.writeFile(gitignore, '*\n!.gitignore\n', 'utf8');
    }

    const payload: RagStoreSnapshot = {
      ...this.snapshot,
      updatedAt: Date.now(),
    };

    // Always write JSON mirror for debugging / migration
    const jsonTmp = ragJsonMirrorPath(this.snapshot.workspaceRoot) + '.tmp';
    await fs.writeFile(jsonTmp, JSON.stringify(payload), 'utf8');
    await fs.rename(jsonTmp, ragJsonMirrorPath(this.snapshot.workspaceRoot));

    if (this.db) {
      syncDbFromSnapshot(this.db, payload);
      const data = this.db.export();
      const sqliteTmp = ragStorePath(this.snapshot.workspaceRoot) + '.tmp';
      await fs.writeFile(sqliteTmp, Buffer.from(data));
      await fs.rename(sqliteTmp, ragStorePath(this.snapshot.workspaceRoot));
    } else {
      // Attempt to create sqlite on first successful sql.js load
      try {
        const SQL = await loadSql();
        const db = new SQL.Database();
        schema(db);
        syncDbFromSnapshot(db, payload);
        this.db = db;
        const data = db.export();
        await fs.writeFile(ragStorePath(this.snapshot.workspaceRoot), Buffer.from(data));
      } catch {
        // JSON mirror is enough
      }
    }

    this.snapshot = payload;
    this.dirty = false;
  }
}

function normalise(relPath: string): string {
  return relPath.replace(/\\/g, '/').replace(/^\.\//, '');
}

async function tryLoadJsonMirror(workspaceRoot: string): Promise<RagStoreSnapshot | undefined> {
  try {
    const raw = await fs.readFile(ragJsonMirrorPath(workspaceRoot), 'utf8');
    const parsed = JSON.parse(raw) as RagStoreSnapshot;
    if (parsed.version !== STORE_VERSION || typeof parsed.chunks !== 'object') {
      return undefined;
    }
    return {
      ...parsed,
      workspaceRoot,
      files: parsed.files ?? {},
      chunks: parsed.chunks ?? {},
      explanations: parsed.explanations ?? {},
    };
  } catch {
    return undefined;
  }
}

function hydrateFromDb(workspaceRoot: string, db: Database): RagStoreSnapshot {
  const files: Record<string, RagFileRecord> = {};
  const chunks: Record<string, RagChunk> = {};
  const explanations: Record<string, ExplanationCacheEntry> = {};

  const fileRows = db.exec('SELECT path, hash, mtime_ms FROM files');
  for (const row of fileRows[0]?.values ?? []) {
    const p = String(row[0]);
    files[p] = { path: p, hash: String(row[1]), mtimeMs: Number(row[2]), chunkIds: [] };
  }

  const chunkRows = db.exec(
    'SELECT id, path, symbol, kind, text, start_line, end_line, weight, file_hash, embedding FROM chunks'
  );
  for (const row of chunkRows[0]?.values ?? []) {
    const id = String(row[0]);
    const p = String(row[1]);
    const embeddingBlob = row[9];
    let embedding: number[] | undefined;
    if (embeddingBlob instanceof Uint8Array && embeddingBlob.byteLength > 0) {
      const view = new Float32Array(
        embeddingBlob.buffer,
        embeddingBlob.byteOffset,
        embeddingBlob.byteLength / 4
      );
      embedding = Array.from(view);
    }
    const chunk: RagChunk = {
      id,
      path: p,
      symbol: row[2] != null ? String(row[2]) : undefined,
      kind: String(row[3]) as RagChunkKind,
      text: String(row[4]),
      startLine: Number(row[5]),
      endLine: Number(row[6]),
      weight: Number(row[7]),
      fileHash: String(row[8]),
      embedding,
    };
    chunks[id] = chunk;
    const file = files[p];
    if (file) {
      files[p] = { ...file, chunkIds: [...file.chunkIds, id] };
    } else {
      files[p] = { path: p, hash: chunk.fileHash, mtimeMs: 0, chunkIds: [id] };
    }
  }

  const explRows = db.exec('SELECT key, markdown, mode, created_at FROM explanations');
  for (const row of explRows[0]?.values ?? []) {
    const key = String(row[0]);
    explanations[key] = {
      key,
      markdown: String(row[1]),
      mode: String(row[2]) as ExplanationMode,
      createdAt: Number(row[3]),
    };
  }

  return {
    version: STORE_VERSION,
    workspaceRoot,
    updatedAt: Date.now(),
    files,
    chunks,
    explanations,
  };
}

function syncDbFromSnapshot(db: Database, snapshot: RagStoreSnapshot): void {
  db.run('DELETE FROM explanations');
  db.run('DELETE FROM chunks');
  db.run('DELETE FROM files');
  try {
    db.run('DROP TABLE IF EXISTS chunks_fts');
  } catch {
    // ignore
  }
  db.run(`
    CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts4(
      id,
      path,
      symbol,
      kind,
      text
    );
  `);

  for (const file of Object.values(snapshot.files)) {
    db.run('INSERT INTO files(path, hash, mtime_ms) VALUES (?, ?, ?)', [
      file.path,
      file.hash,
      file.mtimeMs,
    ]);
  }

  for (const chunk of Object.values(snapshot.chunks)) {
    let emb: Uint8Array | null = null;
    if (chunk.embedding && chunk.embedding.length > 0) {
      emb = new Uint8Array(new Float32Array(chunk.embedding).buffer);
    }
    db.run(
      `INSERT INTO chunks(id, path, symbol, kind, text, start_line, end_line, weight, file_hash, embedding)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        chunk.id,
        chunk.path,
        chunk.symbol ?? null,
        chunk.kind,
        chunk.text,
        chunk.startLine,
        chunk.endLine,
        chunk.weight,
        chunk.fileHash,
        emb,
      ]
    );
    db.run(
      `INSERT INTO chunks_fts(id, path, symbol, kind, text) VALUES (?, ?, ?, ?, ?)`,
      [chunk.id, chunk.path, chunk.symbol ?? '', chunk.kind, chunk.text]
    );
  }

  for (const expl of Object.values(snapshot.explanations)) {
    db.run(
      `INSERT INTO explanations(key, markdown, mode, created_at) VALUES (?, ?, ?, ?)`,
      [expl.key, expl.markdown, expl.mode, expl.createdAt]
    );
  }
}
