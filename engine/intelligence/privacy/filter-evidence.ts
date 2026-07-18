import type {
  PrivacyClassification,
  PrivacyDecision,
} from '../contracts/types';
import { blocksModelEvidence } from './types';
import { evaluatePathPrivacy } from './rule-engine';

export function classificationAllowsModelEvidence(
  c: PrivacyClassification | undefined
): boolean {
  if (!c) {
    return true;
  }
  return !blocksModelEvidence(c);
}

export function assertPathAllowedForModelEvidence(decision: PrivacyDecision): void {
  if (!decision.allowsModelEvidence) {
    throw new Error(
      `Path blocked for model evidence: ${decision.path} (${decision.classification})`
    );
  }
}

/**
 * Filter evidence paths so never_send_to_model / local_only / metadata_only
 * content cannot leave the machine.
 */
export function filterPathsForModelEvidence(
  paths: readonly string[],
  decisions: ReadonlyMap<string, PrivacyDecision>
): readonly string[] {
  return paths.filter((p) => {
    const key = p.replace(/\\/g, '/');
    const d = decisions.get(key);
    if (!d) {
      return true;
    }
    return d.allowsModelEvidence;
  });
}

export function filterItemsForModelEvidence<T extends { path: string }>(
  items: readonly T[],
  decisions: ReadonlyMap<string, PrivacyDecision>
): readonly T[] {
  return items.filter((item) => {
    const key = item.path.replace(/\\/g, '/');
    const d = decisions.get(key);
    if (!d) {
      return true;
    }
    return d.allowsModelEvidence;
  });
}

export async function loadPrivacyDecisionsForPaths(
  workspaceRoot: string,
  paths: readonly string[],
  options?: {
    readonly vscodeExtraExclusions?: readonly string[];
    readonly skipGlobalFile?: boolean;
  }
): Promise<Map<string, PrivacyDecision>> {
  const map = new Map<string, PrivacyDecision>();
  const unique = [...new Set(paths.map((p) => p.replace(/\\/g, '/')))];
  for (const p of unique) {
    const decision = await evaluatePathPrivacy({
      workspaceRoot,
      relPath: p,
      ...options,
    });
    map.set(p, decision);
  }
  return map;
}

export function redactChunkTextForPrivacy(
  text: string,
  classification: PrivacyClassification | undefined
): string {
  if (!classification || classification === 'normal') {
    return text;
  }
  if (classification === 'metadata_only') {
    return '[content omitted: metadata_only]';
  }
  if (classification === 'never_send_to_model' || classification === 'local_only') {
    return '[content omitted: never_send_to_model]';
  }
  return '[content omitted]';
}
