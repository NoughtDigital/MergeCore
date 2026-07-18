import type { ContextDocument } from '../instructions/types';
import { PRECEDENCE } from '../instructions/resolver';
import { parseMemoryDocument } from './frontmatter-memory';
import { isGeneratedMemoryPath, isSelfReinforcingClaim } from './provenance';
import { MEMORY_AUTHORITY, type MemoryStatus } from './types';
import { isUnderGeneratedDir } from './paths';

/**
 * Whether a memory status may influence retrieval / answers.
 * Rejected and stale are excluded; regenerate stale before reuse.
 */
export function memoryStatusInfluencesAnswers(status: MemoryStatus | undefined): boolean {
  if (!status) return true; // human docs without status
  return status !== 'rejected' && status !== 'stale';
}

/** Precedence bump for generated memory by lifecycle status. */
export function precedenceForMemoryStatus(status: MemoryStatus): number {
  switch (status) {
    case 'approved':
      return MEMORY_AUTHORITY.APPROVED;
    case 'reviewed':
      return MEMORY_AUTHORITY.REVIEWED;
    case 'generated':
      return MEMORY_AUTHORITY.GENERATED;
    case 'rejected':
    case 'stale':
      return MEMORY_AUTHORITY.EXCLUDED;
    default:
      return MEMORY_AUTHORITY.GENERATED;
  }
}

/**
 * Filter context documents: drop rejected/stale generated memory and
 * documents whose sole evidence would be self-citation.
 */
export function filterDocumentsForRetrieval(
  documents: readonly ContextDocument[],
  contentByPath?: ReadonlyMap<string, string>
): ContextDocument[] {
  return documents.filter((doc) => {
    if (!isUnderGeneratedDir(doc.path) && doc.documentType !== 'generated_memory') {
      return true;
    }
    const content = contentByPath?.get(doc.path);
    const status = resolveStatus(doc, content);
    if (!memoryStatusInfluencesAnswers(status)) {
      return false;
    }
    if (content) {
      const parsed = parseMemoryDocument(content);
      if (parsed.frontmatter && isSelfReinforcingClaim(parsed.frontmatter.sources)) {
        return false;
      }
    }
    return true;
  });
}

export function resolveStatus(
  doc: ContextDocument,
  content?: string
): MemoryStatus | undefined {
  if (content) {
    const parsed = parseMemoryDocument(content);
    if (parsed.frontmatter?.status) return parsed.frontmatter.status;
  }
  const field = doc.frontmatter?.fields?.status;
  if (typeof field === 'string') {
    return field as MemoryStatus;
  }
  if (doc.documentType === 'generated_memory' || doc.authored === 'generated') {
    return 'generated';
  }
  return undefined;
}

/**
 * Effective instruction precedence: approved generated memory is stronger than
 * raw generated, but always below human binding / contextual floor.
 */
export function effectiveMemoryPrecedence(
  doc: ContextDocument,
  content?: string
): number {
  const status = resolveStatus(doc, content);
  if (status && (doc.documentType === 'generated_memory' || doc.authored === 'generated')) {
    const band = precedenceForMemoryStatus(status);
    // Never exceed human contextual floor
    return Math.min(band, MEMORY_AUTHORITY.HUMAN_FLOOR - 1);
  }
  return PRECEDENCE.GENERATED_MEMORY;
}

/**
 * Strip claims that only cite generated memory (anti self-reinforcing loop).
 */
export function stripSelfCitingClaims<T extends { sources: readonly { path: string }[] }>(
  claims: readonly T[]
): T[] {
  return claims.filter((c) => {
    if (!c.sources.length) return false;
    return !c.sources.every((s) => isGeneratedMemoryPath(s.path));
  });
}

export { MEMORY_AUTHORITY };
