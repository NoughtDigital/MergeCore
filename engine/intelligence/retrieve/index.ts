export type {
  FilteringDecision,
  RepositoryContextResult,
  RetrievalAnalysis,
  RetrievalBudgets,
  RetrievalBudgetUsage,
  RetrievalCandidateSummary,
  RetrievalDebugInfo,
  RetrievalDependencyPathSummary,
  RetrievalHit,
  RetrievalIndexHealth,
  RetrievalInspectionRecord,
  RetrievalParserFailure,
  RetrievalResultType,
  RetrievalSourceFreshness,
  RetrievalStageTiming,
  ScoreBreakdown,
  SearchRepositoryContextOptions,
  SourceFreshnessStatus,
} from './types';
export { DEFAULT_RETRIEVAL_BUDGETS } from './types';

export {
  createRepositorySearchEngine,
  searchRepositoryContext,
  repositoryContextToClaims,
  type RepositorySearchEngine,
  type CreateRepositorySearchEngineOptions,
} from './search';

export {
  hybridSearchRepositoryContext,
  hitsToClaims,
} from './hybrid-ranker';

export {
  evaluateRetrievalTasks,
  precisionAtK,
  recallAtK,
  meanReciprocalRank,
  type EvalTask,
  type EvalTaskResult,
  type EvalSummary,
} from './eval';

export { LexicalRepositoryRetriever } from './lexical-retriever';
