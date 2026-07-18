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

export type {
  SourceType,
  ExclusionReason,
  ExclusionRecord,
  WorkspaceDescriptor,
  FileFingerprint,
  ParseStatus,
  FileRecord,
  SymbolLocation,
  SymbolRecord,
  DependencyEdge,
  DocumentChunk,
  InstructionDocument,
  InstructionRule,
  SourceReference,
  ContextClaim,
  ContextResult,
  ContextPack,
  IndexStatus,
  IndexPhase,
  LanguageAdapter,
  IndexStore,
  RetrieveQueryOptions,
  RepositoryRetriever,
  ModelProvider,
} from './contracts';
export {
  noopModelProvider,
  serializeWorkspaceDescriptor,
  parseWorkspaceDescriptor,
  serializeFileFingerprint,
  parseFileFingerprint,
  serializeFileRecord,
  parseFileRecord,
  serializeSymbolLocation,
  parseSymbolLocation,
  serializeSymbolRecord,
  parseSymbolRecord,
  serializeDependencyEdge,
  parseDependencyEdge,
  serializeDocumentChunk,
  parseDocumentChunk,
  serializeSourceReference,
  parseSourceReference,
  serializeContextClaim,
  parseContextClaim,
  serializeContextResult,
  parseContextResult,
  serializeInstructionRule,
  parseInstructionRule,
  serializeInstructionDocument,
  parseInstructionDocument,
  serializeContextPack,
  parseContextPack,
  serializeIndexStatus,
  parseIndexStatus,
} from './contracts';

export {
  createRepositoryIndex,
  type CreateRepositoryIndexOptions,
  type RepositoryIndex,
  type IndexOptions,
  type ContextPackOptions,
} from './api/repository-index';

export {
  createRepositoryFileIndexer,
  type CreateRepositoryFileIndexerOptions,
  type RepositoryFileIndexer,
  type FileChange,
  scanWorkspace,
  evaluatePathForIndex,
  isTempPath,
  isSupportedIndexPath,
  languageForPath,
} from './indexer';

export {
  defaultLanguageAdapters,
  resolveLanguageAdapter,
  TypeScriptLanguageAdapter,
  JavaScriptLanguageAdapter,
  MarkdownLanguageAdapter,
  PhpLanguageAdapter,
} from './adapters';

export { createIgnoreMatcher, resolveInsideWorkspace, NestedIgnoreResolver } from './ignore';
export { SqlJsIndexStore } from './store/sqljs-index-store';
export { LexicalRepositoryRetriever } from './retrieve/lexical-retriever';
export { discoverInstructionDocuments } from './memory/discover-instructions';
export { STORE_SCHEMA_VERSION } from './rag/store';

export {
  createInstructionResolver,
  discoverContextDocuments,
  classifyContextPath,
  chunkMarkdownByHeadings,
  extractInstructionTexts,
  parseFrontmatter,
  pathMatchesGlob,
  PRECEDENCE,
  type InstructionResolver,
  type ContextDocument,
  type ContextDocumentType,
  type ApplicableInstruction,
  type InstructionConflict,
  type InstructionPrecedenceExplanation,
  type MarkdownSection,
  type InstructionResolverOptions,
} from './instructions';
