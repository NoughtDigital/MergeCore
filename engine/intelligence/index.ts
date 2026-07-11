export { collectProjectProfile } from './collect';
export type { DetectorContext } from './context';
export type {
  ProjectProfile,
  ProjectConvention,
  PhpStackInfo,
  JavascriptStackInfo,
} from './types';
export { PROJECT_DETECTORS, type ProjectDetector } from './registry';
export {
  CONVENTION_DETECTORS,
  type ConventionDetector,
} from './conventions/registry';
export {
  scanProdRisks,
  BUILTIN_PROD_RISK_RULES,
  loadPackProdRiskRules,
  PROD_RISK_CATEGORIES,
  isKnownProdRiskCategory,
  type ProdRiskCategory,
  type ProdRiskCategorySummary,
  type ProdRiskFinding,
  type ProdRiskLanguage,
  type ProdRiskRequiredSignal,
  type ProdRiskRule,
  type ProdRiskScanProgress,
  type ProdRiskScanResult,
  type ProdRiskScannerOptions,
  type ProdRiskSeverity,
} from './prod-risks';
export {
  RagStore,
  ragStoreDir,
  ragStorePath,
  ragJsonMirrorPath,
  indexWorkspace,
  retrieveFromWorkspace,
  retrieve,
  tokenize,
  chunkFile,
  chunkPhp,
  chunkMarkdown,
  ingestMarkdownMemory,
  PRIORITY_MEMORY_BASENAMES,
  sha256,
  type EmbeddingPort,
  type ExplanationCacheEntry,
  type ExplanationMode,
  type IntelligenceProfile,
  type IndexProgress,
  type IndexProgressCallback,
  type RagChunk,
  type RagHit,
  type RetrieveOptions,
} from './rag';
