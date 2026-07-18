import type {
  DependencyEdge,
  DocumentChunk,
  FileRecord,
  IndexStatus,
  IndexStore,
  SymbolRecord,
} from '../contracts';
import { STORE_SCHEMA_VERSION, RagStore } from '../rag/store';
import type { RagChunk, RagDependencyEdge, RagSymbolRecord } from '../rag/types';
import { sha256 } from '../rag/hash';

function toDocumentChunk(chunk: RagChunk): DocumentChunk {
  return {
    id: chunk.id,
    path: chunk.path,
    text: chunk.text,
    startLine: chunk.startLine,
    endLine: chunk.endLine,
    kind: chunk.kind,
    symbol: chunk.symbol,
    weight: chunk.weight,
    fileHash: chunk.fileHash,
  };
}

function toSymbolRecord(sym: RagSymbolRecord): SymbolRecord {
  let parameters: SymbolRecord['parameters'];
  if (sym.parametersJson) {
    try {
      const parsed = JSON.parse(sym.parametersJson) as unknown;
      if (Array.isArray(parsed)) {
        parameters = parsed as SymbolRecord['parameters'];
      }
    } catch {
      parameters = undefined;
    }
  }
  return {
    id: sym.id,
    name: sym.name,
    kind: sym.kind,
    location: {
      path: sym.path,
      startLine: sym.startLine,
      endLine: sym.endLine,
      startColumn: sym.startColumn,
      endColumn: sym.endColumn,
    },
    exported: sym.exported,
    containerName: sym.containerName,
    language: sym.language,
    parameters,
    returnTypeText: sym.returnTypeText,
    jsdocSummary: sym.jsdocSummary,
    signatureText: sym.signatureText,
    overloadIndex: sym.overloadIndex,
  };
}

function toEdge(edge: RagDependencyEdge): DependencyEdge {
  return { ...edge };
}

function fromDocumentChunk(chunk: DocumentChunk): RagChunk {
  return {
    id: chunk.id,
    path: chunk.path,
    symbol: chunk.symbol,
    kind: chunk.kind,
    text: chunk.text,
    startLine: chunk.startLine,
    endLine: chunk.endLine,
    weight: chunk.weight,
    fileHash: chunk.fileHash,
  };
}

function fromSymbol(sym: SymbolRecord): RagSymbolRecord {
  return {
    id: sym.id,
    name: sym.name,
    kind: sym.kind,
    path: sym.location.path,
    startLine: sym.location.startLine,
    endLine: sym.location.endLine,
    startColumn: sym.location.startColumn,
    endColumn: sym.location.endColumn,
    language: sym.language,
    exported: sym.exported,
    containerName: sym.containerName,
    parametersJson: sym.parameters ? JSON.stringify(sym.parameters) : undefined,
    returnTypeText: sym.returnTypeText,
    jsdocSummary: sym.jsdocSummary,
    signatureText: sym.signatureText,
    overloadIndex: sym.overloadIndex,
  };
}

/**
 * IndexStore backed by the existing sql.js RagStore.
 */
export class SqlJsIndexStore implements IndexStore {
  constructor(private readonly store: RagStore) {}

  static async open(workspaceRoot: string): Promise<SqlJsIndexStore> {
    const store = await RagStore.open(workspaceRoot);
    return new SqlJsIndexStore(store);
  }

  static fromRagStore(store: RagStore): SqlJsIndexStore {
    return new SqlJsIndexStore(store);
  }

  get ragStore(): RagStore {
    return this.store;
  }

  get workspaceRoot(): string {
    return this.store.root;
  }

  get fileCount(): number {
    return this.store.fileCount;
  }

  get chunkCount(): number {
    return this.store.chunkCount;
  }

  get symbolCount(): number {
    return this.store.symbolCount;
  }

  get edgeCount(): number {
    return this.store.edgeCount;
  }

  get hasSqlite(): boolean {
    return this.store.hasSqlite;
  }

  get updatedAt(): number {
    return this.store.updatedAt;
  }

  getFile(filePath: string): FileRecord | undefined {
    const f = this.store.getFile(filePath);
    if (!f) {
      return undefined;
    }
    const symbols = this.store.allSymbols().filter((s) => s.path === f.path);
    const workspaceId = f.workspaceId ?? this.store.workspaceId ?? sha256(this.store.root).slice(0, 16);
    return {
      workspaceId,
      path: f.path,
      fingerprint: {
        path: f.path,
        contentHash: f.hash,
        mtimeMs: f.mtimeMs,
        byteLength: f.byteLength,
      },
      language: f.language ?? 'generic',
      byteLength: f.byteLength ?? 0,
      mtimeMs: f.mtimeMs,
      contentHash: f.hash,
      indexedAt: f.indexedAt ?? this.store.updatedAt,
      parseStatus: f.parseStatus ?? 'ok',
      chunkIds: f.chunkIds,
      symbolIds: symbols.map((s) => s.id),
    };
  }

  allChunks(): readonly DocumentChunk[] {
    return this.store.allChunks().map(toDocumentChunk);
  }

  allSymbols(): readonly SymbolRecord[] {
    return this.store.allSymbols().map(toSymbolRecord);
  }

  allEdges(): readonly DependencyEdge[] {
    return this.store.allEdges().map(toEdge);
  }

  replaceFile(input: {
    readonly path: string;
    readonly contentHash: string;
    readonly mtimeMs: number;
    readonly language?: string;
    readonly chunks: readonly DocumentChunk[];
    readonly symbols: readonly SymbolRecord[];
    readonly edges: readonly DependencyEdge[];
  }): void {
    this.store.replaceFileGraph(
      input.path,
      input.contentHash,
      input.mtimeMs,
      input.chunks.map(fromDocumentChunk),
      input.symbols.map(fromSymbol),
      input.edges,
      {
        language: input.language,
        parseStatus: 'ok',
        indexedAt: Date.now(),
      }
    );
  }

  removeFile(filePath: string): void {
    this.store.removeFile(filePath);
  }

  async persist(): Promise<void> {
    await this.store.persist();
  }

  getStatus(): IndexStatus {
    const workspaceId =
      this.store.workspaceId ?? sha256(this.store.root).slice(0, 16);
    return {
      workspaceRoot: this.store.root,
      workspaceId,
      ready: this.store.chunkCount > 0 || this.store.fileCount > 0,
      busy: false,
      phase: 'idle',
      fileCount: this.store.fileCount,
      chunkCount: this.store.chunkCount,
      symbolCount: this.store.symbolCount,
      edgeCount: this.store.edgeCount,
      filesIndexed: 0,
      filesSkipped: 0,
      filesPending: 0,
      storeDir: this.store.storeDirectory,
      hasSqlite: this.store.hasSqlite,
      schemaVersion: STORE_SCHEMA_VERSION,
      cancellable: true,
      updatedAt: this.store.updatedAt,
    };
  }
}
