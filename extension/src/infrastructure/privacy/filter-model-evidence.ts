import {
  evaluatePathPrivacy,
  filterItemsForModelEvidence,
  loadPrivacyDecisionsForPaths,
  type PrivacyDecision,
} from '@mergecore/intelligence';
import * as vscode from 'vscode';
import { PrivacyGateError } from './privacy-gate-core';

export function readVscodeExtraExclusions(): readonly string[] {
  const cfg = vscode.workspace.getConfiguration('mergecore');
  const raw = cfg.get<unknown>('privacy.extraExclusions');
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
}

/**
 * Load privacy decisions and strip items that must not leave as model evidence.
 * Throws PrivacyGateError when nothing remains after filtering.
 */
export async function filterOutboundEvidenceItems<T extends { path: string }>(
  workspaceRoot: string,
  items: readonly T[],
  options?: { readonly purpose?: string; readonly allowEmpty?: boolean }
): Promise<{
  readonly allowed: readonly T[];
  readonly blocked: readonly T[];
  readonly decisions: ReadonlyMap<string, PrivacyDecision>;
}> {
  const paths = items.map((i) => i.path);
  const decisions = await loadPrivacyDecisionsForPaths(workspaceRoot, paths, {
    vscodeExtraExclusions: readVscodeExtraExclusions(),
  });
  const allowed = filterItemsForModelEvidence(items, decisions);
  const blocked = items.filter((i) => !allowed.includes(i));
  if (allowed.length === 0 && items.length > 0 && !options?.allowEmpty) {
    throw new PrivacyGateError(
      `All evidence paths are blocked for model transmission` +
        (options?.purpose ? ` (${options.purpose})` : '') +
        `. Classifications: never_send_to_model / local_only / metadata_only.`,
      'privacy_blocked'
    );
  }
  return { allowed, blocked, decisions };
}

export async function assertPathMaySendToModel(
  workspaceRoot: string,
  relPath: string,
  purpose: string
): Promise<PrivacyDecision> {
  const decision = await evaluatePathPrivacy({
    workspaceRoot,
    relPath,
    vscodeExtraExclusions: readVscodeExtraExclusions(),
  });
  if (!decision.allowsModelEvidence) {
    throw new PrivacyGateError(
      `Cannot send \`${relPath}\` to a model for ${purpose}: classified as ${decision.classification}` +
        (decision.matchedPattern ? ` (matched ${decision.matchedPattern})` : ''),
      'privacy_blocked'
    );
  }
  return decision;
}
