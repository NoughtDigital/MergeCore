export type {
  UsageEventKind,
  UsageMetricsSnapshot,
  UsageEvent,
} from './types';

export {
  USAGE_METRICS_SCHEMA_VERSION,
  USAGE_ANALYTICS_CATEGORIES,
  EMPTY_USAGE_METRICS,
} from './types';

export {
  loadUsageMetrics,
  saveUsageMetrics,
  applyUsageEvent,
  recordUsageEvent,
  deleteUsageDiagnostics,
  averageLatencyMs,
} from './store';

export {
  fingerprintQuery,
  hashRelativePath,
  assertDiagnosticsSafe,
  scrubAnalyticsPayload,
} from './scrub';

export {
  buildQueryFingerprint,
  buildNormalisedQuery,
  stageTimer,
  assembleRetrievalDebugInfo,
  saveLastInspection,
  loadLastInspection,
  inspectionFromResult,
  collectParserFailures,
  buildIndexHealth,
} from './inspection';

export {
  setSessionLastInspection,
  getSessionLastInspection,
} from './session';

export type { RetrievalInspectionRecord } from '../retrieve/types';

export {
  saveMissingContextFeedback,
  listMissingContextFeedback,
  missingContextToEvalTasks,
  loadMissingContextEvalTasks,
  MISSING_CONTEXT_SCHEMA_VERSION,
  type MissingContextFeedback,
} from './missing-context';

export {
  buildScrubbedAnalyticsBundle,
  analyticsCategoriesDisclosure,
  type ScrubbedAnalyticsBundle,
} from './analytics';
