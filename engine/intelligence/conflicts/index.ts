export type {
  ConflictDetectorKind,
  ConflictConfidence,
  ExtractedRuleStatus,
  ConflictRuleSource,
  ConflictRule,
  ExtractedConflictRule,
  ConflictCodeEvidence,
  ContextConflictFinding,
  ContextConflictScanResult,
  ConflictIgnoreEntry,
} from './types';

export {
  conflictRulesPath,
  extractedConflictRulesPath,
  conflictIgnoresPath,
  parseConflictRule,
  loadConflictRulesFile,
  loadExtractedConflictRules,
  saveExtractedConflictRules,
  updateExtractedRuleStatus,
  loadConflictIgnores,
  saveConflictIgnore,
  extractedToConflictRule,
  type ConflictRulesFile,
  type ExtractedConflictRulesFile,
  type ConflictIgnoresFile,
} from './load-config';

export {
  mapInstructionTextToRule,
  makeExtractedRuleId,
  type InstructionMapResult,
} from './map-instruction';

export {
  extractConflictRuleCandidates,
  type ExtractConflictRulesOptions,
  type ExtractConflictRulesResult,
} from './extract-rules';

export {
  runConflictDetectors,
  type DetectorHit,
  type RunDetectorsOptions,
} from './detectors';

export {
  scanContextConflicts,
  type ScanContextConflictsOptions,
} from './scan';

export {
  formatContextConflictsMarkdown,
  formatFindingMarkdown,
  formatExtractedRulesMarkdown,
} from './report';
