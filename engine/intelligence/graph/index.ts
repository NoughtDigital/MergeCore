export {
  createCodeGraphQuery,
  type CodeGraphQuery,
  type FindSymbolOptions,
  type RelatedTestResult,
  type SymbolPosition,
  type TraverseNode,
  type TraverseOptions,
} from './query';

export {
  createTsJsCodeGraphService,
  type FileGraphExtract,
  type TsJsCodeGraphService,
} from './ts/service';

export { TsProgramHost, discoverTsConfigs } from './ts/program-host';
export { extractFileWithCompiler, symbolAtPosition } from './ts/extract';
export { isLikelyTestPath, detectTestCoverageEdges } from './ts/test-relations';
export { GraphReconcileScheduler } from './ts/reconcile';
export { buildSymbolId } from './ts/symbol-id';
export { isTsJsPath, languageForTsJs, normaliseRel } from './ts/paths';

export {
  traverseRelationshipPaths,
  analyseChangeImpact,
  DEFAULT_TRAVERSE_BUDGET,
  mergeTraverseBudget,
  scoreRelationshipPath,
  formatRelationshipPathLabel,
  confidenceRank,
  type TraverseStart,
  type TraverseRelationshipPathsOptions,
  type AnalyseChangeImpactOptions,
} from './paths';
