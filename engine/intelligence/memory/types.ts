/**
 * Engineering memory lifecycle and provenance contracts.
 */

export type MemoryStatus =
  | 'generated'
  | 'reviewed'
  | 'approved'
  | 'rejected'
  | 'stale';

export const MEMORY_STATUSES: readonly MemoryStatus[] = [
  'generated',
  'reviewed',
  'approved',
  'rejected',
  'stale',
] as const;

export const MEMORY_SCHEMA_VERSION = 1;

export interface MemorySourceRef {
  readonly path: string;
  readonly startLine: number;
  readonly endLine: number;
  /** Content fingerprint of the source file when the claim was written. */
  readonly fingerprint?: string;
}

export interface MemoryFrontmatter {
  readonly generatedBy?: 'mergecore' | string;
  readonly generatedAt?: string;
  readonly schemaVersion: number;
  readonly status: MemoryStatus;
  readonly confidence?: number;
  readonly sources: readonly MemorySourceRef[];
  /** Extra fields preserved from YAML. */
  readonly fields: Readonly<Record<string, unknown>>;
}

export interface MemoryClaim {
  readonly id: string;
  readonly text: string;
  readonly startLine?: number;
  readonly endLine?: number;
  readonly sources: readonly MemorySourceRef[];
}

export interface ProvenanceDocumentNode {
  readonly path: string;
  readonly status: MemoryStatus;
  readonly confidence?: number;
  readonly generatedAt?: string;
  readonly claims: readonly MemoryClaim[];
}

export interface ProvenanceGraph {
  readonly schemaVersion: number;
  readonly updatedAt: string;
  readonly documents: readonly ProvenanceDocumentNode[];
}

export interface MergeCoreConfig {
  readonly schemaVersion: number;
  readonly index: {
    readonly relativeDir: string;
  };
  readonly memory: {
    readonly shareableDir: string;
    readonly generatedDir: string;
  };
}

export const DEFAULT_MERGECORE_CONFIG: MergeCoreConfig = {
  schemaVersion: 1,
  index: { relativeDir: '.mergecore/rag' },
  memory: {
    shareableDir: '.mergecore/memory',
    generatedDir: '.mergecore/generated',
  },
};

/** Retrieval authority bands for memory status (higher = stronger). */
export const MEMORY_AUTHORITY = {
  /** Human AGENTS / Cursor / shareable memory docs — never overridden by generated. */
  HUMAN_FLOOR: 400,
  APPROVED: 250,
  REVIEWED: 150,
  GENERATED: 100,
  /** Stale / rejected must not influence answers. */
  EXCLUDED: 0,
} as const;
