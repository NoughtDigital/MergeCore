export type {
  ContextDocumentType,
  AuthoredBy,
  ClassificationConfidence,
  InstructionBinding,
  ContextDocumentFrontmatter,
  ContextDocument,
  MarkdownSection,
  ApplicableInstruction,
  InstructionConflict,
  InstructionPrecedenceExplanation,
  InstructionResolverOptions,
} from './types';

export { discoverContextDocuments, type DiscoverContextOptions } from './discover';
export { classifyContextPath, isAdrPath, isAgentsOrClaude, isCursorRulesPath } from './classify';
export {
  parseFrontmatter,
  pathMatchesGlob,
  normalisePath,
} from './frontmatter';
export {
  chunkMarkdownByHeadings,
  extractInstructionTexts,
  looksLikeInstruction,
} from './markdown-sections';
export {
  createInstructionResolver,
  PRECEDENCE,
  type InstructionResolver,
} from './resolver';
