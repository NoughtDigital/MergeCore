import type {
  EdgeConfidence,
  TraverseBudget,
} from '../../contracts/types';

export const DEFAULT_TRAVERSE_BUDGET: Required<
  Omit<TraverseBudget, 'kinds' | 'stopWhen'>
> &
  Pick<TraverseBudget, 'kinds' | 'stopWhen'> = {
  maxDepth: 3,
  maxNodes: 80,
  maxPaths: 12,
  maxFanOutPerNode: 12,
  hubDegreeTruncate: 40,
  direction: 'both',
  minConfidence: 'heuristic',
  weightProfile: 'default',
  kinds: undefined,
  stopWhen: undefined,
};

const CONFIDENCE_ORDER: Readonly<Record<EdgeConfidence, number>> = {
  certain: 5,
  high: 4,
  medium: 3,
  low: 2,
  heuristic: 1,
};

export function confidenceRank(c: EdgeConfidence | undefined): number {
  if (!c) return CONFIDENCE_ORDER.medium;
  return CONFIDENCE_ORDER[c] ?? CONFIDENCE_ORDER.medium;
}

export function meetsMinConfidence(
  edgeConfidence: EdgeConfidence | undefined,
  min: EdgeConfidence | undefined
): boolean {
  if (!min) return true;
  return confidenceRank(edgeConfidence) >= confidenceRank(min);
}

export function mergeTraverseBudget(
  partial?: TraverseBudget
): Required<Omit<TraverseBudget, 'kinds' | 'stopWhen'>> &
  Pick<TraverseBudget, 'kinds' | 'stopWhen'> {
  return {
    ...DEFAULT_TRAVERSE_BUDGET,
    ...partial,
    stopWhen: partial?.stopWhen ?? DEFAULT_TRAVERSE_BUDGET.stopWhen,
    kinds: partial?.kinds ?? DEFAULT_TRAVERSE_BUDGET.kinds,
  };
}
