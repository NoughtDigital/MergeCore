export {
  PRIVACY_STRENGTH,
  PRIVACY_SOURCE_RANK,
  allowsRetrieval,
  allowsModelEvidence,
  allowsContentStorage,
  allowsSymbolIndex,
  isIncluded,
  decisionFromClassification,
  compareRulePriority,
  wouldWeaken,
  blocksModelEvidence,
} from './types';

export {
  DEFAULT_PRIVACY_PATTERNS,
  globalPrivacyConfigPath,
  workspacePrivacyConfigPath,
  workspacePrivacyOverridesPath,
  parsePrivacyRulesFile,
  loadPrivacyRulesFile,
  loadPrivacyOverrides,
  savePrivacyOverride,
  defaultPrivacyRules,
  vscodeExtraExclusionRules,
  loadAllPrivacyRules,
  type PrivacyRulesFile,
  type PrivacyOverridesFile,
  type LoadAllPrivacyRulesOptions,
} from './load-rules';

export {
  evaluatePathPrivacy,
  createPrivacyRuleEngine,
  type EvaluatePrivacyOptions,
  type PrivacyRuleEngine,
  type CreatePrivacyEngineOptions,
} from './rule-engine';

export {
  previewIndexRules,
  type IndexRulePreviewRow,
  type PreviewIndexRulesResult,
  type PreviewIndexRulesOptions,
} from './preview';

export {
  classificationAllowsModelEvidence,
  filterPathsForModelEvidence,
  filterItemsForModelEvidence,
  loadPrivacyDecisionsForPaths,
  redactChunkTextForPrivacy,
  assertPathAllowedForModelEvidence,
} from './filter-evidence';
