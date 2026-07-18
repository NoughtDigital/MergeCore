import {
  DEFAULT_RETRIEVAL_BUDGETS,
  type RetrievalBudgets,
} from '../retrieve/types';
import type { TaskContextDepth } from './task-context-types';

const PRESETS: Record<TaskContextDepth, Required<RetrievalBudgets> & { k: number }> = {
  shallow: {
    maxFiles: 6,
    maxSymbols: 10,
    maxChunks: 10,
    maxDependencyDepth: 1,
    maxChars: 10_000,
    maxTokensApprox: 2_500,
    k: 8,
  },
  standard: {
    ...DEFAULT_RETRIEVAL_BUDGETS,
    k: 16,
  },
  deep: {
    maxFiles: 20,
    maxSymbols: 36,
    maxChunks: 40,
    maxDependencyDepth: 3,
    maxChars: 40_000,
    maxTokensApprox: 10_000,
    k: 28,
  },
};

export function budgetsForDepth(depth: TaskContextDepth): {
  readonly budgets: Required<RetrievalBudgets>;
  readonly k: number;
} {
  const p = PRESETS[depth] ?? PRESETS.standard;
  const { k, ...budgets } = p;
  return { budgets, k };
}

export function parseTaskContextDepth(raw: string | undefined): TaskContextDepth {
  if (raw === 'shallow' || raw === 'deep' || raw === 'standard') return raw;
  return 'standard';
}
