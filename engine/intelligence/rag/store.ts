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
export const STORE_SCHEMA_VERSION = 4 as const;
const STORE_VERSION = STORE_SCHEMA_VERSION;

export function defaultRagStoreDir(workspaceRoot: string): string {
  return path.join(workspaceRoot, STORE_DIR);
}

export function ragStoreDir(workspaceRoot: string, storageDir?: string): string {
  if (storageDir) {
    return path.resolve(storageDir);
  }
  const env = process.env.MERGECORE_STORAGE_DIR;
  if (env && env.trim()) {
    return path.resolve(env.trim());
  }
  return defaultRagStoreDir(workspaceRoot);
}

export function ragStorePath(workspaceRoot: string, storageDir?: string): string {
  return path.join(ragStoreDir(workspaceRoot, storageDir), SQLITE_FILE);
}

export function ragJsonMirrorPath(workspaceRoot: string, storageDir?: string): string {
  return path.join(ragStoreDir(workspaceRoot, storageDir), JSON_MIRROR);
}

export function emptySnapshot(
  workspaceRoot: string,
  workspaceId?: string
): RagStoreSnapshot {
  return {
    version: STORE_VERSION,
    workspaceRoot,
    workspaceId,
    updatedAt: Date.now(),
    files: {},
    chunks: {},
    explanations: {},
    symbols: {},
    edges: [],
  };
}

export interface RagStoreOpenOptions {
  readonly storageDir?: string;
  readonly workspaceId?: string;
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
      mtime_ms REAL NOT NULL,
      workspace_id TEXT,
      language TEXT,
      byte_length INTEGER,
      indexed_at REAL,
      parse_status TEXT
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
      container_name TEXT,
      start_column INTEGER,
      end_column INTEGER,
      parameters_json TEXT,
      return_type_text TEXT,
      jsdoc_summary TEXT,
      signature_text TEXT,
      overload_index INTEGER
    );
    CREATE TABLE IF NOT EXISTS edges (
      id TEXT PRIMARY KEY,
      from_path TEXT NOT NULL,
      to_path TEXT NOT NULL,
      kind TEXT NOT NULL,
      specifier TEXT NOT NULL,
      from_symbol TEXT,
      to_symbol TEXT,
      start_line INTEGER,
      start_column INTEGER,
      end_line INTEGER,
      end_column INTEGER,
      confidence TEXT,
      resolution_method TEXT,
      evidence_json TEXT
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts4(
      id,
      path,
      symbol,
      kind,
      text
    );
  `);
  db.run(`INSERT OR REPLACE INTO meta(key, value) VALUES ('version', '4')`);
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
  private readonly storageDirResolved: string;
  private closed = false;

  private constructor(
    snapshot: RagStoreSnapshot,
    storageDirResolved: string,
    db?: Database
  ) {
    this.snapshot = snapshot;
    this.storageDirResolved = storageDirResolved;
    this.db = db;
  }

  static async open(
    workspaceRoot: string,
    options: RagStoreOpenOptions = {}
  ): Promise<RagStore> {
    const root = path.resolve(workspaceRoot);
    const dir = ragStoreDir(root, options.storageDir);
    await fs.mkdir(dir, { recursive: true });
    const sqlitePath = path.join(dir, SQLITE_FILE);
    const jsonPath = path.join(dir, JSON_MIRROR);

    try {
      const SQL = await loadSql();
      let db: Database;
      try {
        const buf = await fs.readFile(sqlitePath);
        db = new SQL.Database(buf);
      } catch {
        // Prefer recovering from a leftover tmp if primary missing
        try {
          const tmpBuf = await fs.readFile(sqlitePath + '.tmp');
          db = new SQL.Database(tmpBuf);
        } catch {
          db = new SQL.Database();
        }
      }
      schema(db);
      migrateFilesTable(db);
      migrateGraphTables(db);

      const countRow = db.exec('SELECT COUNT(*) AS c FROM chunks');
      const count = Number(countRow[0]?.values[0]?.[0] ?? 0);
      if (count === 0) {
        const migrated = await tryLoadJsonMirror(root, jsonPath);
        if (migrated && Object.keys(migrated.chunks).length > 0) {
          const store = new RagStore(
            { ...migrated, workspaceRoot: root, workspaceId: options.workspaceId ?? migrated.workspaceId },
            dir,
            db
          );
          store.dirty = true;
          await store.persist();
          return store;
        }
      }

      const snapshot = hydrateFromDb(root, db);
      return new RagStore(
        {
          ...snapshot,
          workspaceId: options.workspaceId ?? snapshot.workspaceId,
        },
        dir,
        db
      );
    } catch {
      const migrated = await tryLoadJsonMirror(root, jsonPath);
      return new RagStore(
        migrated
          ? {
              ...migrated,
              workspaceRoot: root,
              workspaceId: options.workspaceId ?? migrated.workspaceId,
            }
          : emptySnapshot(root, options.workspaceId),
        dir
      );
    }
  }

  get storeDirectory(): string {
    return this.storageDirResolved;
  }

  get schemaVersion(): number {
    return STORE_VERSION;
  }

  get workspaceId(): string | undefined {
    return this.snapshot.workspaceId;
  }

  setWorkspaceId(id: string): void {
    this.snapshot = { ...this.snapshot, workspaceId: id, version: STORE_VERSION };
    this.dirty = true;
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

  getSymbol(symbolId: string): RagSymbolRecord | undefined {
    return (this.snapshot.symbols ?? {})[symbolId];
  }

  edgesFrom(path: string): readonly RagDependencyEdge[] {
    const key = normalise(path);
    return this.allEdges().filter((e) => e.fromPath === key);
  }

  edgesTo(path: string): readonly RagDependencyEdge[] {
    const key = normalise(path);
    return this.allEdges().filter((e) => e.toPath === key);
  }

  /** Files that import / depend on `relPath` (reverse file dependency). */
  importersOf(relPath: string): readonly string[] {
    const key = normalise(relPath);
    const out = new Set<string>();
    for (const e of this.allEdges()) {
      if (
        e.toPath === key &&
        (e.kind === 'import' ||
          e.kind === 'require' ||
          e.kind === 'fileDependency' ||
          e.kind === 'export')
      ) {
        out.add(e.fromPath);
      }
    }
    return [...out];
  }

  edgesForSymbol(symbolId: string): readonly RagDependencyEdge[] {
    return this.allEdges().filter(
      (e) => e.fromSymbol === symbolId || e.toSymbol === symbolId
    );
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
    edges: readonly RagDependencyEdge[],
    meta?: {
      readonly workspaceId?: string;
      readonly language?: string;
      readonly byteLength?: number;
      readonly indexedAt?: number;
      readonly parseStatus?: RagFileRecord['parseStatus'];
    }
  ): void {
    this.ensureOpen();
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
    const removedSymbolIds = new Set<string>();
    for (const [sid, sym] of Object.entries(nextSymbols)) {
      if (sym.path === key) {
        removedSymbolIds.add(sid);
        delete nextSymbols[sid];
      }
    }
    for (const sym of symbols) {
      nextSymbols[sym.id] = { ...sym, path: normalise(sym.path) };
      removedSymbolIds.delete(sym.id);
    }

    const keptEdges = (this.snapshot.edges ?? []).filter((e) => {
      if (e.fromPath === key) {
        return false;
      }
      if (e.toSymbol && removedSymbolIds.has(e.toSymbol)) {
        return false;
      }
      if (e.fromSymbol && removedSymbolIds.has(e.fromSymbol) && e.fromPath !== key) {
        return false;
      }
      return true;
    });
    const seenIds = new Set(keptEdges.map((e) => e.id));
    const appended: RagDependencyEdge[] = [];
    for (const e of edges) {
      const normalised = {
        ...e,
        fromPath: normalise(e.fromPath),
        toPath: normalise(e.toPath),
      };
      if (seenIds.has(normalised.id)) {
        continue;
      }
      seenIds.add(normalised.id);
      appended.push(normalised);
    }
    const nextEdges = [...keptEdges, ...appended];

    this.snapshot = {
      ...this.snapshot,
      version: STORE_VERSION,
      chunks: nextChunks,
      files: {
        ...this.snapshot.files,
        [key]: {
          path: key,
          hash,
          mtimeMs,
          chunkIds: ids,
          workspaceId: meta?.workspaceId ?? this.snapshot.workspaceId,
          language: meta?.language,
          byteLength: meta?.byteLength,
          indexedAt: meta?.indexedAt ?? Date.now(),
          parseStatus: meta?.parseStatus ?? 'ok',
        },
      },
      symbols: nextSymbols,
      edges: nextEdges,
      updatedAt: Date.now(),
    };
    this.dirty = true;
  }

  removeFile(relPath: string): void {
    this.ensureOpen();
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
    const removedSymbolIds = new Set<string>();
    for (const [sid, sym] of Object.entries(nextSymbols)) {
      if (sym.path === key) {
        removedSymbolIds.add(sid);
        delete nextSymbols[sid];
      }
    }
    const nextEdges = (this.snapshot.edges ?? []).filter((e) => {
      if (e.fromPath === key || e.toPath === key) {
        return false;
      }
      if (e.toSymbol && removedSymbolIds.has(e.toSymbol)) {
        return false;
      }
      if (e.fromSymbol && removedSymbolIds.has(e.fromSymbol)) {
        return false;
      }
      return true;
    });
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

  /** Remove indexed files whose paths are not in `keepPaths`. */
  pruneMissing(keepPaths: ReadonlySet<string>): number {
    this.ensureOpen();
    let removed = 0;
    for (const p of Object.keys(this.snapshot.files)) {
      if (!keepPaths.has(p)) {
        this.removeFile(p);
        removed++;
      }
    }
    return removed;
  }

  /** Clear all indexed content (for rebuild). */
  wipe(): void {
    this.ensureOpen();
    this.snapshot = emptySnapshot(this.snapshot.workspaceRoot, this.snapshot.workspaceId);
    this.dirty = true;
  }

  allFilePaths(): readonly string[] {
    return Object.keys(this.snapshot.files);
  }

  private ensureOpen(): void {
    if (this.closed) {
      throw new Error('RagStore is closed');
    }
  }

  async close(): Promise<void> {
    if (this.closed) {
      return;
    }
    if (this.dirty) {
      await this.persist();
    }
    if (this.db) {
      this.db.close();
      this.db = undefined;
    }
    this.closed = true;
  }

  setChunkEmbedding(chunkId: string, embedding: readonly number[]): void {
    this.ensureOpen();
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
    this.ensureOpen();
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
    if (this.closed) {
      return;
    }
    if (!this.dirty) {
      return;
    }
    const dir = this.storageDirResolved;
    await fs.mkdir(dir, { recursive: true });
    const gitignore = path.join(dir, '.gitignore');
    try {
      await fs.access(gitignore);
    } catch {
      await fs.writeFile(gitignore, '*\n!.gitignore\n', 'utf8');
    }

    const payload: RagStoreSnapshot = {
      ...this.snapshot,
      version: STORE_VERSION,
      updatedAt: Date.now(),
    };

    const jsonPath = path.join(dir, JSON_MIRROR);
    const jsonTmp = jsonPath + '.tmp';
    await fs.writeFile(jsonTmp, JSON.stringify(payload), 'utf8');
    await fs.rename(jsonTmp, jsonPath);

    const sqlitePath = path.join(dir, SQLITE_FILE);
    if (this.db) {
      syncDbFromSnapshot(this.db, payload);
      const data = this.db.export();
      const sqliteTmp = sqlitePath + '.tmp';
      await fs.writeFile(sqliteTmp, Buffer.from(data));
      await fs.rename(sqliteTmp, sqlitePath);
    } else {
      try {
        const SQL = await loadSql();
        const db = new SQL.Database();
        schema(db);
        migrateFilesTable(db);
      migrateGraphTables(db);
        syncDbFromSnapshot(db, payload);
        this.db = db;
        const data = db.export();
        const sqliteTmp = sqlitePath + '.tmp';
        await fs.writeFile(sqliteTmp, Buffer.from(data));
        await fs.rename(sqliteTmp, sqlitePath);
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

async function tryLoadJsonMirror(
  workspaceRoot: string,
  jsonPath?: string
): Promise<RagStoreSnapshot | undefined> {
  try {
    const raw = await fs.readFile(jsonPath ?? ragJsonMirrorPath(workspaceRoot), 'utf8');
    const parsed = JSON.parse(raw) as RagStoreSnapshot;
    if (
      (parsed.version !== 1 &&
        parsed.version !== 2 &&
        parsed.version !== 3 &&
        parsed.version !== 4) ||
      typeof parsed.chunks !== 'object'
    ) {
      return undefined;
    }
    return {
      ...parsed,
      version: STORE_VERSION,
      workspaceRoot,
      workspaceId: parsed.workspaceId,
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

function migrateFilesTable(db: Database): void {
  const cols = new Set<string>();
  try {
    const info = db.exec('PRAGMA table_info(files)');
    for (const row of info[0]?.values ?? []) {
      cols.add(String(row[1]));
    }
  } catch {
    return;
  }
  const add = (name: string, ddl: string): void => {
    if (!cols.has(name)) {
      try {
        db.run(`ALTER TABLE files ADD COLUMN ${ddl}`);
      } catch {
        // ignore
      }
    }
  };
  add('workspace_id', 'workspace_id TEXT');
  add('language', 'language TEXT');
  add('byte_length', 'byte_length INTEGER');
  add('indexed_at', 'indexed_at REAL');
  add('parse_status', 'parse_status TEXT');
}

function migrateGraphTables(db: Database): void {
  const addCols = (table: string, columns: ReadonlyArray<[string, string]>): void => {
    const cols = new Set<string>();
    try {
      const info = db.exec(`PRAGMA table_info(${table})`);
      for (const row of info[0]?.values ?? []) {
        cols.add(String(row[1]));
      }
    } catch {
      return;
    }
    for (const [name, ddl] of columns) {
      if (!cols.has(name)) {
        try {
          db.run(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
        } catch {
          // ignore
        }
      }
    }
  };
  addCols('symbols', [
    ['start_column', 'start_column INTEGER'],
    ['end_column', 'end_column INTEGER'],
    ['parameters_json', 'parameters_json TEXT'],
    ['return_type_text', 'return_type_text TEXT'],
    ['jsdoc_summary', 'jsdoc_summary TEXT'],
    ['signature_text', 'signature_text TEXT'],
    ['overload_index', 'overload_index INTEGER'],
  ]);
  addCols('edges', [
    ['start_column', 'start_column INTEGER'],
    ['end_line', 'end_line INTEGER'],
    ['end_column', 'end_column INTEGER'],
    ['confidence', 'confidence TEXT'],
    ['resolution_method', 'resolution_method TEXT'],
    ['evidence_json', 'evidence_json TEXT'],
  ]);
}

function hydrateFromDb(workspaceRoot: string, db: Database): RagStoreSnapshot {
  const files: Record<string, RagFileRecord> = {};
  const chunks: Record<string, RagChunk> = {};
  const explanations: Record<string, ExplanationCacheEntry> = {};
  const symbols: Record<string, RagSymbolRecord> = {};
  const edges: RagDependencyEdge[] = [];

  const fileRows = db.exec(
    'SELECT path, hash, mtime_ms, workspace_id, language, byte_length, indexed_at, parse_status FROM files'
  );
  for (const row of fileRows[0]?.values ?? []) {
    const p = String(row[0]);
    files[p] = {
      path: p,
      hash: String(row[1]),
      mtimeMs: Number(row[2]),
      chunkIds: [],
      workspaceId: row[3] != null ? String(row[3]) : undefined,
      language: row[4] != null ? String(row[4]) : undefined,
      byteLength: row[5] != null ? Number(row[5]) : undefined,
      indexedAt: row[6] != null ? Number(row[6]) : undefined,
      parseStatus:
        row[7] != null ? (String(row[7]) as RagFileRecord['parseStatus']) : undefined,
    };
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
      `SELECT id, name, kind, path, start_line, end_line, language, exported, container_name,
              start_column, end_column, parameters_json, return_type_text, jsdoc_summary,
              signature_text, overload_index FROM symbols`
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
        startColumn: row[9] != null ? Number(row[9]) : undefined,
        endColumn: row[10] != null ? Number(row[10]) : undefined,
        parametersJson: row[11] != null ? String(row[11]) : undefined,
        returnTypeText: row[12] != null ? String(row[12]) : undefined,
        jsdocSummary: row[13] != null ? String(row[13]) : undefined,
        signatureText: row[14] != null ? String(row[14]) : undefined,
        overloadIndex: row[15] != null ? Number(row[15]) : undefined,
      };
    }
  } catch {
    // Fallback for legacy symbol table without v4 columns
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
      // symbols table may be missing on legacy DBs
    }
  }

  try {
    const edgeRows = db.exec(
      `SELECT id, from_path, to_path, kind, specifier, from_symbol, to_symbol, start_line,
              start_column, end_line, end_column, confidence, resolution_method, evidence_json
       FROM edges`
    );
    for (const row of edgeRows[0]?.values ?? []) {
      let evidence: string[] | undefined;
      if (row[13] != null) {
        try {
          const parsed = JSON.parse(String(row[13])) as unknown;
          if (Array.isArray(parsed) && parsed.every((e) => typeof e === 'string')) {
            evidence = parsed as string[];
          }
        } catch {
          evidence = undefined;
        }
      }
      edges.push({
        id: String(row[0]),
        fromPath: String(row[1]),
        toPath: String(row[2]),
        kind: String(row[3]) as RagDependencyEdge['kind'],
        specifier: String(row[4]),
        fromSymbol: row[5] != null ? String(row[5]) : undefined,
        toSymbol: row[6] != null ? String(row[6]) : undefined,
        startLine: row[7] != null ? Number(row[7]) : undefined,
        startColumn: row[8] != null ? Number(row[8]) : undefined,
        endLine: row[9] != null ? Number(row[9]) : undefined,
        endColumn: row[10] != null ? Number(row[10]) : undefined,
        confidence: row[11] != null ? (String(row[11]) as RagDependencyEdge['confidence']) : undefined,
        resolutionMethod:
          row[12] != null
            ? (String(row[12]) as RagDependencyEdge['resolutionMethod'])
            : undefined,
        evidence,
      });
    }
  } catch {
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
      container_name TEXT,
      start_column INTEGER,
      end_column INTEGER,
      parameters_json TEXT,
      return_type_text TEXT,
      jsdoc_summary TEXT,
      signature_text TEXT,
      overload_index INTEGER
    );
    CREATE TABLE IF NOT EXISTS edges (
      id TEXT PRIMARY KEY,
      from_path TEXT NOT NULL,
      to_path TEXT NOT NULL,
      kind TEXT NOT NULL,
      specifier TEXT NOT NULL,
      from_symbol TEXT,
      to_symbol TEXT,
      start_line INTEGER,
      start_column INTEGER,
      end_line INTEGER,
      end_column INTEGER,
      confidence TEXT,
      resolution_method TEXT,
      evidence_json TEXT
    );
  `);
  migrateGraphTables(db);

  for (const file of Object.values(snapshot.files)) {
    db.run(
      `INSERT INTO files(path, hash, mtime_ms, workspace_id, language, byte_length, indexed_at, parse_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        file.path,
        file.hash,
        file.mtimeMs,
        file.workspaceId ?? snapshot.workspaceId ?? null,
        file.language ?? null,
        file.byteLength ?? null,
        file.indexedAt ?? null,
        file.parseStatus ?? null,
      ]
    );
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
      `INSERT OR REPLACE INTO symbols(id, name, kind, path, start_line, end_line, language, exported, container_name,
        start_column, end_column, parameters_json, return_type_text, jsdoc_summary, signature_text, overload_index)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        sym.startColumn ?? null,
        sym.endColumn ?? null,
        sym.parametersJson ?? null,
        sym.returnTypeText ?? null,
        sym.jsdocSummary ?? null,
        sym.signatureText ?? null,
        sym.overloadIndex ?? null,
      ]
    );
  }

  for (const edge of snapshot.edges ?? []) {
    db.run(
      `INSERT OR REPLACE INTO edges(id, from_path, to_path, kind, specifier, from_symbol, to_symbol, start_line,
        start_column, end_line, end_column, confidence, resolution_method, evidence_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        edge.id,
        edge.fromPath,
        edge.toPath,
        edge.kind,
        edge.specifier,
        edge.fromSymbol ?? null,
        edge.toSymbol ?? null,
        edge.startLine ?? null,
        edge.startColumn ?? null,
        edge.endLine ?? null,
        edge.endColumn ?? null,
        edge.confidence ?? null,
        edge.resolutionMethod ?? null,
        edge.evidence ? JSON.stringify(edge.evidence) : null,
      ]
    );
  }

  db.run(`INSERT OR REPLACE INTO meta(key, value) VALUES ('version', '4')`);
}
