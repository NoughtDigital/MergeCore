import type { RetrievalBudgets } from '../retrieve/types';

export type TaskContextDepth = 'shallow' | 'standard' | 'deep';

export const TASK_CONTEXT_SCHEMA_VERSION = 1;

export interface TaskContextSourceRef {
  readonly path: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly label?: string;
  readonly fingerprint?: string;
}

export interface TaskContextSection {
  readonly title: string;
  readonly bullets: readonly string[];
}

export interface TaskContextMeta {
  readonly task: string;
  readonly generatedAt: string;
  readonly indexRevision: string;
  readonly depth: TaskContextDepth;
  readonly budgets: Required<RetrievalBudgets>;
  readonly k: number;
  readonly selectedFiles: readonly string[];
  readonly selectedSymbols: readonly string[];
  readonly confidence: number;
  readonly sources: readonly TaskContextSourceRef[];
  readonly modelProvider: string;
  readonly dataLeftMachine: boolean;
  readonly incomplete: boolean;
}

export interface TaskContextPack {
  readonly meta: TaskContextMeta;
  readonly sections: readonly TaskContextSection[];
  readonly markdown: string;
  readonly evidenceRefs: readonly TaskContextSourceRef[];
}

export interface TaskContextInput {
  readonly workspaceRoot: string;
  readonly store: import('../rag/store').RagStore;
  readonly task: string;
  readonly depth?: TaskContextDepth;
  readonly selectedFiles?: readonly string[];
  readonly selectedSymbols?: readonly string[];
  readonly pathHint?: string;
  readonly k?: number;
  readonly graphService?: import('../graph/ts/service').TsJsCodeGraphService;
  /** When true, skip writing; assembler only. */
  readonly dryRun?: boolean;
}

export const REQUIRED_TASK_CONTEXT_SECTIONS = [
  'Task',
  'Repository understanding',
  'Applicable instructions',
  'Relevant components',
  'Related types and dependencies',
  'Existing implementation patterns',
  'Tests likely affected',
  'Risks and edge cases',
  'Suggested inspection order',
  'Uncertainty',
  'Sources',
] as const;
