import * as fs from 'fs/promises';
import * as path from 'path';
import type { Database } from 'sql.js';
import type {
  ExplanationCacheEntry,
  ExplanationMode,
  RagChunk,
  RagChunkKind,
  RagDependencyEdge,
  RagFileRecord,
  RagStoreSnapshot,
  RagSymbolRecord,
} from './types';

const STORE_DIR = '.mergecore/rag';
const SQLITE_FILE = 'index.sqlite';
const JSON_MIRROR = 'index.json';
const STORE_VERSION = 2 as const;

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
    symbols: {},
    edges: [],
  };
}

async function loadSql(): Promise<{
  Database: new (data?: ArrayLike<number> | Buffer | null) => Database;
}> {
  const fsSync = await import('fs');
  const pathMod = await import('path');
  const { createRequire } = await import('module');
  const nodeRequire = createRequire(__filename);

  type SqlInit = (cfg?: { wasmBinary?: Buffer }) => Promise<{
    Database: new (data?: ArrayLike<number> | Buffer | null) => Database;
  }>;

  const vendorDir = pathMod.join(__dirname, 'vendor', 'sql.js');
  const vendorWasm = pathMod.join(vendorDir, 'dist', 'sql-wasm.wasm');
  const vendorMain = pathMod.join(vendorDir, 'dist', 'sql-wasm.js');
  const vendorAsm = pathMod.join(vendorDir, 'dist', 'sql-asm.js');

  let initSqlJs: SqlInit | undefined;
  let wasmPath: string | undefined;

  if (fsSync.existsSync(vendorMain)) {
    // Bundled VS Code extension: sql.js is copied next to out/extension.js
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    initSqlJs = nodeRequire(vendorMain) as SqlInit;
    if (fsSync.existsSync(vendorWasm)) {
      wasmPath = vendorWasm;
    }
  } else {
    try {
      initSqlJs = nodeRequire('sql.js') as SqlInit;
      wasmPath = nodeRequire.resolve('sql.js/dist/sql-wasm.wasm');
    } catch {
      initSqlJs = undefined;
    }
  }

  if (!initSqlJs) {
    throw new Error('sql.js could not be loaded');
  }

  try {
    if (wasmPath) {
      const wasmBinary = fsSync.readFileSync(wasmPath);
      return await initSqlJs({ wasmBinary });
    }
    throw new Error('wasm missing');
  } catch {
    // Fall back to asm.js (vendored or from node_modules).
    let asmModule: unknown;
    if (fsSync.existsSync(vendorAsm)) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      asmModule = nodeRequire(vendorAsm);
    } else {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      asmModule = nodeRequire('sql.js/dist/sql-asm.js');
    }
    const asm = asmModule as
      | SqlInit
      | { default: SqlInit };
    const init = typeof asm === 'function' ? asm : asm.default;
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
    CREATE TABLE IF NOT EXISTS symbols (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      kind TEXT NOT NULL,
      path TEXT NOT NULL,
      start_line INTEGER NOT NULL,
      end_line INTEGER NOT NULL,
      language TEXT NOT NULL,
      exported INTEGER,
      container_name TEXT
    );
    CREATE TABLE IF NOT EXISTS edges (
      id TEXT PRIMARY KEY,
      from_path TEXT NOT NULL,
      to_path TEXT NOT NULL,
      kind TEXT NOT NULL,
      specifier TEXT NOT NULL,
      from_symbol TEXT,
      to_symbol TEXT,
      start_line INTEGER
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts4(
      id,
      path,
      symbol,
      kind,
      text
    );
  `);
  db.run(`INSERT OR REPLACE INTO meta(key, value) VALUES ('version', '2')`);
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

  get symbolCount(): number {
    return Object.keys(this.snapshot.symbols ?? {}).length;
  }

  get edgeCount(): number {
    return (this.snapshot.edges ?? []).length;
  }

  get updatedAt(): number {
    return this.snapshot.updatedAt;
  }

  /** True when backed by SQLite FTS. */
  get hasSqlite(): boolean {
    return this.db !== undefined;
  }

  getFile(relPath: string): RagFileRecord | undefined {
    return this.snapshot.files[normalise(relPath)];
  }

  allChunks(): readonly RagChunk[] {
    return Object.values(this.snapshot.chunks);
  }

  allSymbols(): readonly RagSymbolRecord[] {
    return Object.values(this.snapshot.symbols ?? {});
  }

  allEdges(): readonly RagDependencyEdge[] {
    return this.snapshot.edges ?? [];
  }

  findSymbolsByName(name: string): readonly RagSymbolRecord[] {
    const lower = name.toLowerCase();
    return this.allSymbols().filter(
      (s) => s.name.toLowerCase() === lower || s.id.toLowerCase().includes(lower)
    );
  }

  edgesFrom(path: string): readonly RagDependencyEdge[] {
    const key = normalise(path);
    return this.allEdges().filter((e) => e.fromPath === key);
  }

  edgesTo(path: string): readonly RagDependencyEdge[] {
    const key = normalise(path);
    return this.allEdges().filter((e) => e.toPath === key);
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
    this.replaceFileGraph(relPath, hash, mtimeMs, chunks, [], []);
  }

  /**
   * Replace chunks and graph data for a file. Removes prior symbols/edges
   * whose `path` / `fromPath` matches this file.
   */
  replaceFileGraph(
    relPath: string,
    hash: string,
    mtimeMs: number,
    chunks: readonly RagChunk[],
    symbols: readonly RagSymbolRecord[],
    edges: readonly RagDependencyEdge[]
  ): void {
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

    const nextSymbols: Record<string, RagSymbolRecord> = { ...(this.snapshot.symbols ?? {}) };
    for (const [sid, sym] of Object.entries(nextSymbols)) {
      if (sym.path === key) {
        delete nextSymbols[sid];
      }
    }
    for (const sym of symbols) {
      nextSymbols[sym.id] = { ...sym, path: normalise(sym.path) };
    }

    const keptEdges = (this.snapshot.edges ?? []).filter((e) => e.fromPath !== key);
    const nextEdges = [
      ...keptEdges,
      ...edges.map((e) => ({
        ...e,
        fromPath: normalise(e.fromPath),
        toPath: normalise(e.toPath),
      })),
    ];

    this.snapshot = {
      ...this.snapshot,
      version: STORE_VERSION,
      chunks: nextChunks,
      files: {
        ...this.snapshot.files,
        [key]: { path: key, hash, mtimeMs, chunkIds: ids },
      },
      symbols: nextSymbols,
      edges: nextEdges,
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
    const nextSymbols: Record<string, RagSymbolRecord> = { ...(this.snapshot.symbols ?? {}) };
    for (const [sid, sym] of Object.entries(nextSymbols)) {
      if (sym.path === key) {
        delete nextSymbols[sid];
      }
    }
    const nextEdges = (this.snapshot.edges ?? []).filter((e) => e.fromPath !== key);
    this.snapshot = {
      ...this.snapshot,
      version: STORE_VERSION,
      chunks: nextChunks,
      files: nextFiles,
      symbols: nextSymbols,
      edges: nextEdges,
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
    if (
      (parsed.version !== 1 && parsed.version !== 2) ||
      typeof parsed.chunks !== 'object'
    ) {
      return undefined;
    }
    return {
      ...parsed,
      version: STORE_VERSION,
      workspaceRoot,
      files: parsed.files ?? {},
      chunks: parsed.chunks ?? {},
      explanations: parsed.explanations ?? {},
      symbols: parsed.symbols ?? {},
      edges: parsed.edges ?? [],
    };
  } catch {
    return undefined;
  }
}

function hydrateFromDb(workspaceRoot: string, db: Database): RagStoreSnapshot {
  const files: Record<string, RagFileRecord> = {};
  const chunks: Record<string, RagChunk> = {};
  const explanations: Record<string, ExplanationCacheEntry> = {};
  const symbols: Record<string, RagSymbolRecord> = {};
  const edges: RagDependencyEdge[] = [];

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

  try {
    const symRows = db.exec(
      'SELECT id, name, kind, path, start_line, end_line, language, exported, container_name FROM symbols'
    );
    for (const row of symRows[0]?.values ?? []) {
      const id = String(row[0]);
      symbols[id] = {
        id,
        name: String(row[1]),
        kind: String(row[2]),
        path: String(row[3]),
        startLine: Number(row[4]),
        endLine: Number(row[5]),
        language: String(row[6]),
        exported: row[7] == null ? undefined : Number(row[7]) === 1,
        containerName: row[8] != null ? String(row[8]) : undefined,
      };
    }
  } catch {
    // symbols table may be missing on legacy DBs — schema() creates it on open
  }

  try {
    const edgeRows = db.exec(
      'SELECT id, from_path, to_path, kind, specifier, from_symbol, to_symbol, start_line FROM edges'
    );
    for (const row of edgeRows[0]?.values ?? []) {
      edges.push({
        id: String(row[0]),
        fromPath: String(row[1]),
        toPath: String(row[2]),
        kind: String(row[3]) as RagDependencyEdge['kind'],
        specifier: String(row[4]),
        fromSymbol: row[5] != null ? String(row[5]) : undefined,
        toSymbol: row[6] != null ? String(row[6]) : undefined,
        startLine: row[7] != null ? Number(row[7]) : undefined,
      });
    }
  } catch {
    // edges table may be missing on legacy DBs
  }

  return {
    version: STORE_VERSION,
    workspaceRoot,
    updatedAt: Date.now(),
    files,
    chunks,
    explanations,
    symbols,
    edges,
  };
}

function syncDbFromSnapshot(db: Database, snapshot: RagStoreSnapshot): void {
  db.run('DELETE FROM explanations');
  db.run('DELETE FROM chunks');
  db.run('DELETE FROM files');
  try {
    db.run('DELETE FROM symbols');
  } catch {
    // ignore
  }
  try {
    db.run('DELETE FROM edges');
  } catch {
    // ignore
  }
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
  // Ensure graph tables exist on legacy DBs
  db.run(`
    CREATE TABLE IF NOT EXISTS symbols (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      kind TEXT NOT NULL,
      path TEXT NOT NULL,
      start_line INTEGER NOT NULL,
      end_line INTEGER NOT NULL,
      language TEXT NOT NULL,
      exported INTEGER,
      container_name TEXT
    );
    CREATE TABLE IF NOT EXISTS edges (
      id TEXT PRIMARY KEY,
      from_path TEXT NOT NULL,
      to_path TEXT NOT NULL,
      kind TEXT NOT NULL,
      specifier TEXT NOT NULL,
      from_symbol TEXT,
      to_symbol TEXT,
      start_line INTEGER
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

  for (const sym of Object.values(snapshot.symbols ?? {})) {
    db.run(
      `INSERT INTO symbols(id, name, kind, path, start_line, end_line, language, exported, container_name)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        sym.id,
        sym.name,
        sym.kind,
        sym.path,
        sym.startLine,
        sym.endLine,
        sym.language,
        sym.exported === undefined ? null : sym.exported ? 1 : 0,
        sym.containerName ?? null,
      ]
    );
  }

  for (const edge of snapshot.edges ?? []) {
    db.run(
      `INSERT INTO edges(id, from_path, to_path, kind, specifier, from_symbol, to_symbol, start_line)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        edge.id,
        edge.fromPath,
        edge.toPath,
        edge.kind,
        edge.specifier,
        edge.fromSymbol ?? null,
        edge.toSymbol ?? null,
        edge.startLine ?? null,
      ]
    );
  }

  db.run(`INSERT OR REPLACE INTO meta(key, value) VALUES ('version', '2')`);
}
