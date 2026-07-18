/**
 * Shared data contracts for MergeCore V0.1+.
 * Pure TypeScript types — no runtime dependencies.
 */

/** How a source reference was obtained. */
export type SourceType =
  | 'source'
  | 'symbol'
  | 'dependency'
  | 'memory'
  | 'config'
  | 'instruction'
  | 'lexical';

/** Why a path was excluded from indexing. */
export type ExclusionReason =
  | 'gitignore'
  | 'mergecoreignore'
  | 'default-exclude'
  | 'binary'
  | 'oversized'
  | 'symlink-escape'
  | 'unsupported'
  | 'temp-file'
  | 'cancelled';

export interface ExclusionRecord {
  readonly path: string;
  readonly reason: ExclusionReason;
  readonly detail?: string;
}

/** High-level workspace identity used by hosts and the public API. */
export interface WorkspaceDescriptor {
  readonly rootPath: string;
  readonly displayName: string;
  readonly fingerprint: string;
  readonly indexedAt?: number;
  readonly languages: readonly string[];
}

/** Content fingerprint for a single file. */
export interface FileFingerprint {
  readonly path: string;
  readonly contentHash: string;
  readonly mtimeMs: number;
  readonly byteLength?: number;
}

export type ParseStatus = 'ok' | 'skipped' | 'error' | 'unchanged';

/** Indexed file metadata. */
export interface FileRecord {
  readonly workspaceId: string;
  readonly path: string;
  readonly fingerprint: FileFingerprint;
  readonly language: string;
  readonly byteLength: number;
  readonly mtimeMs: number;
  readonly contentHash: string;
  readonly indexedAt: number;
  readonly parseStatus: ParseStatus;
  readonly chunkIds: readonly string[];
  readonly symbolIds?: readonly string[];
}

/** Location of a symbol within a file (1-based lines). */
export interface SymbolLocation {
  readonly path: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly startColumn?: number;
  readonly endColumn?: number;
}

/** First-class symbol extracted by a language adapter. */
export interface SymbolRecord {
  readonly id: string;
  readonly name: string;
  readonly kind: string;
  readonly location: SymbolLocation;
  readonly exported?: boolean;
  readonly containerName?: string;
  readonly language: string;
}

/** Import / require / dependency relationship between files or symbols. */
export interface DependencyEdge {
  readonly id: string;
  readonly fromPath: string;
  readonly toPath: string;
  readonly kind: 'import' | 'require' | 'export' | 'reference';
  readonly specifier: string;
  readonly fromSymbol?: string;
  readonly toSymbol?: string;
  readonly startLine?: number;
}

/** Indexed text chunk used for lexical retrieval. */
export interface DocumentChunk {
  readonly id: string;
  readonly path: string;
  readonly text: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly kind: 'source' | 'memory' | 'config';
  readonly symbol?: string;
  readonly weight: number;
  readonly fileHash: string;
}

/** Discovered instruction / memory document (README, AGENTS.md, etc.). */
export interface InstructionDocument {
  readonly id: string;
  readonly path: string;
  readonly title: string;
  readonly kind: 'readme' | 'agents' | 'rules' | 'architecture' | 'other';
  readonly rules: readonly InstructionRule[];
  readonly source: SourceReference;
}

/** A single guidance rule extracted from an instruction document. */
export interface InstructionRule {
  readonly id: string;
  readonly text: string;
  readonly source: SourceReference;
}

/** Evidence pointer for a factual claim about the repository. */
export interface SourceReference {
  readonly path: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly sourceType: SourceType;
  readonly symbol?: string;
  readonly excerpt?: string;
}

/** One evidence-backed claim returned by retrieval. */
export interface ContextClaim {
  readonly id: string;
  readonly text: string;
  readonly confidence: 'high' | 'medium' | 'low' | 'uncertain';
  readonly references: readonly SourceReference[];
  readonly score?: number;
}

/** Result of a retrieve query. */
export interface ContextResult {
  readonly workspaceRoot: string;
  readonly query: string;
  readonly claims: readonly ContextClaim[];
  readonly references: readonly SourceReference[];
  readonly incomplete: boolean;
  readonly notes?: readonly string[];
}

/** Assembled pack of claims and instruction context for agents/UI. */
export interface ContextPack {
  readonly id: string;
  readonly workspaceRoot: string;
  readonly query: string;
  readonly createdAt: number;
  readonly claims: readonly ContextClaim[];
  readonly instructions: readonly InstructionDocument[];
  readonly references: readonly SourceReference[];
  readonly incomplete: boolean;
}

/** Progress phases emitted during indexing. */
export type IndexPhase =
  | 'idle'
  | 'scanning'
  | 'chunking'
  | 'embedding'
  | 'persisting'
  | 'done'
  | 'cancelled'
  | 'error';

/** Status of the local repository index. */
export interface IndexStatus {
  readonly workspaceRoot: string;
  readonly workspaceId: string;
  readonly ready: boolean;
  readonly busy: boolean;
  readonly phase: IndexPhase;
  readonly fileCount: number;
  readonly chunkCount: number;
  readonly symbolCount: number;
  readonly edgeCount: number;
  readonly filesIndexed: number;
  readonly filesSkipped: number;
  readonly filesPending: number;
  readonly storeDir: string;
  readonly hasSqlite: boolean;
  readonly schemaVersion: number;
  readonly cancellable: boolean;
  readonly updatedAt?: number;
  readonly fingerprint?: string;
  readonly lastError?: string;
  readonly exclusions?: readonly ExclusionRecord[];
}
