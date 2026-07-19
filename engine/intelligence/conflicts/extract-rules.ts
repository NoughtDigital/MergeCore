import * as fs from 'fs/promises';
import * as path from 'path';
import { discoverContextDocuments } from '../instructions/discover';
import {
  chunkMarkdownByHeadings,
  extractInstructionTexts,
  looksLikeInstruction,
} from '../instructions/markdown-sections';
import {
  loadExtractedConflictRules,
  saveExtractedConflictRules,
} from './load-config';
import {
  makeExtractedRuleId,
  mapInstructionTextToRule,
} from './map-instruction';
import type { ExtractedConflictRule } from './types';

export interface ExtractConflictRulesOptions {
  readonly workspaceRoot: string;
  /** Merge with existing extracted file (preserve confirmed/disabled). Default true. */
  readonly mergeExisting?: boolean;
  readonly signal?: AbortSignal;
}

export interface ExtractConflictRulesResult {
  readonly candidates: readonly ExtractedConflictRule[];
  readonly newlyFound: number;
  readonly preserved: number;
  readonly skippedVague: number;
  readonly skippedGenerated: number;
}

/**
 * Extract candidate rules from binding instruction documents only.
 * Never promotes generated memory or ordinary README prose to mandatory rules.
 */
export async function extractConflictRuleCandidates(
  options: ExtractConflictRulesOptions
): Promise<ExtractConflictRulesResult> {
  const root = path.resolve(options.workspaceRoot);
  const docs = await discoverContextDocuments({
    workspaceRoot: root,
    signal: options.signal,
  });

  const candidates: ExtractedConflictRule[] = [];
  let skippedVague = 0;
  let skippedGenerated = 0;

  for (const doc of docs) {
    if (options.signal?.aborted) break;

    // Only binding, human-authored instruction documents
    if (doc.binding !== 'binding') {
      continue;
    }
    if (doc.authored === 'generated' || doc.documentType === 'generated_memory') {
      skippedGenerated++;
      continue;
    }
    if (
      doc.documentType === 'general_documentation' ||
      doc.documentType === 'glossary'
    ) {
      continue;
    }

    const abs = path.join(root, doc.path);
    let content: string;
    try {
      content = await fs.readFile(abs, 'utf8');
    } catch {
      continue;
    }

    const sections = chunkMarkdownByHeadings(doc.path, content);
    for (const section of sections) {
      const items = extractInstructionTexts(section);
      for (const item of items) {
        if (!looksLikeInstruction(item.text)) {
          skippedVague++;
          continue;
        }
        const mapped = mapInstructionTextToRule(item.text);
        if (!mapped) {
          skippedVague++;
          continue;
        }

        // Mapped but ambiguous → still surface for review, never auto-scan
        const id = makeExtractedRuleId(doc.path, item.startLine, item.text);
        candidates.push({
          id,
          status: 'pending',
          originalText: item.text,
          description: mapped.description,
          source: {
            path: doc.path.replace(/\\/g, '/'),
            startLine: item.startLine,
            endLine: item.endLine,
            line: item.startLine,
          },
          appliesTo: mapped.appliesTo,
          suggestedDetector: mapped.ambiguous ? undefined : mapped.suggestedDetector,
          suggestedFields: mapped.ambiguous ? undefined : mapped.suggestedFields,
          ambiguous: mapped.ambiguous,
          fromGeneratedMemory: false,
        });
      }
    }
  }

  const merge = options.mergeExisting !== false;
  const existing = merge ? loadExtractedConflictRules(root) : { schemaVersion: 1, rules: [] };
  const byId = new Map(existing.rules.map((r) => [r.id, r]));

  let newlyFound = 0;
  let preserved = 0;
  const merged: ExtractedConflictRule[] = [];

  for (const c of candidates) {
    const prev = byId.get(c.id);
    if (prev) {
      preserved++;
      merged.push({
        ...c,
        status: prev.status,
        // Keep user edits to appliesTo / fields when edited
        appliesTo:
          prev.status === 'edited' && prev.appliesTo.length > 0
            ? prev.appliesTo
            : c.appliesTo,
        suggestedDetector:
          prev.status === 'edited' && prev.suggestedDetector
            ? prev.suggestedDetector
            : c.suggestedDetector,
        suggestedFields:
          prev.status === 'edited' && prev.suggestedFields
            ? prev.suggestedFields
            : c.suggestedFields,
        description: prev.status === 'edited' ? prev.description : c.description,
      });
      byId.delete(c.id);
    } else {
      newlyFound++;
      merged.push(c);
    }
  }

  // Preserve disabled/confirmed that disappeared from docs? Keep disabled/confirmed orphans.
  for (const leftover of byId.values()) {
    if (leftover.status === 'confirmed' || leftover.status === 'disabled' || leftover.status === 'edited') {
      preserved++;
      merged.push(leftover);
    }
  }

  saveExtractedConflictRules(root, { schemaVersion: 1, rules: merged });

  return {
    candidates: merged,
    newlyFound,
    preserved,
    skippedVague,
    skippedGenerated,
  };
}
