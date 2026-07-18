/**
 * Bounded relationship path traversal — re-exports contracts and implements the engine.
 */
export type {
  RelationshipPathNode,
  RelationshipPathStep,
  RelationshipPath,
  TraverseDirection,
  TraverseWeightProfile,
  TraverseStopWhen,
  TraverseBudget,
  ChangeImpactTarget,
  ChangeImpactNode,
  ChangeImpactReport,
  ApplicableInstructionRef,
} from '../../contracts/types';

export {
  DEFAULT_TRAVERSE_BUDGET,
  confidenceRank,
  mergeTraverseBudget,
} from './budget';

export {
  traverseRelationshipPaths,
  type TraverseStart,
  type TraverseRelationshipPathsOptions,
} from './traverse';

export {
  scoreRelationshipPath,
  formatRelationshipPathLabel,
  isEntryPointPath,
  isTestPath,
  isIntegrationSpecifier,
} from './rank';

export {
  analyseChangeImpact,
  type AnalyseChangeImpactOptions,
} from './impact';
