export {
  MERGECORE_DIR,
  MEMORY_DIR,
  GENERATED_DIR,
  GENERATED_MEMORY_DIR,
  CONTEXT_PACKS_DIR,
  EXPLANATIONS_DIR,
  PROVENANCE_PATH,
  CONFIG_PATH,
  RAG_DIR,
  SHAREABLE_MEMORY_FILES,
  isUnderGeneratedDir,
  isUnderShareableMemoryDir,
  isUnderRagDir,
  type ShareableMemoryBasename,
} from './paths';

export type {
  MemoryStatus,
  MemorySourceRef,
  MemoryFrontmatter,
  MemoryClaim,
  ProvenanceDocumentNode,
  ProvenanceGraph,
  MergeCoreConfig,
} from './types';

export {
  MEMORY_STATUSES,
  MEMORY_SCHEMA_VERSION,
  DEFAULT_MERGECORE_CONFIG,
  MEMORY_AUTHORITY,
} from './types';

export {
  parseMemoryDocument,
  serialiseMemoryDocument,
  isGeneratedMemoryFrontmatter,
  parseSimpleYaml,
  type ParsedMemoryDocument,
} from './frontmatter-memory';

export {
  emptyProvenanceGraph,
  loadProvenanceGraph,
  saveProvenanceGraph,
  upsertProvenanceDocument,
  removeProvenanceDocument,
  validateProvenanceDocument,
  validateProvenanceGraph,
  isGeneratedMemoryPath,
  isSelfReinforcingClaim,
  fingerprintFile,
  attachFingerprints,
  buildClaimId,
  claimsFromSources,
  setDocumentStatus,
  type ProvenanceValidationResult,
} from './provenance';

export {
  detectStaleDocument,
  detectAllStale,
  scanGeneratedMemoryForStale,
  type StaleCheckResult,
} from './stale';

export {
  memoryStatusInfluencesAnswers,
  precedenceForMemoryStatus,
  filterDocumentsForRetrieval,
  resolveStatus,
  effectiveMemoryPrecedence,
  stripSelfCitingClaims,
} from './authority';

export {
  initialiseMergeCoreMemory,
  loadMergeCoreConfig,
  type InitMemoryResult,
} from './lifecycle';

export {
  writeGeneratedMemoryDocument,
  mergePreservingHumanSections,
  updateMemoryStatusOnDisk,
  deleteMemoryDocument,
  refreshStaleMemory,
  listGeneratedMemoryFiles,
  type WriteGeneratedMemoryInput,
  type WriteGeneratedMemoryResult,
} from './write-generated';

export { discoverInstructionDocuments } from './discover-instructions';
