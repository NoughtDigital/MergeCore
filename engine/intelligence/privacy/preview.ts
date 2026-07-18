import * as fs from 'fs/promises';
import * as path from 'path';
import type { PrivacyDecision } from '../contracts/types';
import { NestedIgnoreResolver } from '../ignore/resolve-ignore';
import {
  isBinaryExtension,
  isSupportedIndexPath,
  isTempPath,
} from '../indexer/workspace-scanner';
import { RAG_WALK_EXCLUDE } from '../rag/walk';
import {
  createPrivacyRuleEngine,
  type CreatePrivacyEngineOptions,
} from './rule-engine';
import { decisionFromClassification } from './types';

export interface IndexRulePreviewRow {
  readonly path: string;
  readonly included: boolean;
  readonly classification: PrivacyDecision['classification'];
  readonly matchedPattern?: string;
  readonly ruleSource: PrivacyDecision['ruleSource'];
  readonly rulePath?: string;
  readonly allowsRetrieval: boolean;
  readonly allowsModelEvidence: boolean;
  readonly allowsContentStorage: boolean;
  readonly allowsSymbolIndex: boolean;
  readonly detail?: string;
}

export interface PreviewIndexRulesResult {
  readonly workspaceRoot: string;
  readonly included: readonly IndexRulePreviewRow[];
  readonly excluded: readonly IndexRulePreviewRow[];
  readonly restricted: readonly IndexRulePreviewRow[];
}

export interface PreviewIndexRulesOptions extends CreatePrivacyEngineOptions {
  readonly maxFiles?: number;
  readonly signal?: AbortSignal;
}

function toRow(decision: PrivacyDecision): IndexRulePreviewRow {
  return {
    path: decision.path,
    included: decision.included,
    classification: decision.classification,
    matchedPattern: decision.matchedPattern,
    ruleSource: decision.ruleSource,
    rulePath: decision.rulePath,
    allowsRetrieval: decision.allowsRetrieval,
    allowsModelEvidence: decision.allowsModelEvidence,
    allowsContentStorage: decision.allowsContentStorage,
    allowsSymbolIndex: decision.allowsSymbolIndex,
    detail: decision.detail,
  };
}

/**
 * Dry-run walk: classify every candidate path without writing to the index.
 */
export async function previewIndexRules(
  options: PreviewIndexRulesOptions
): Promise<PreviewIndexRulesResult> {
  const workspaceRoot = path.resolve(options.workspaceRoot);
  const maxFiles = options.maxFiles ?? 8_000;
  const engine = createPrivacyRuleEngine(options);
  const ignoreResolver =
    options.ignoreResolver ?? new NestedIgnoreResolver(workspaceRoot);

  const included: IndexRulePreviewRow[] = [];
  const excluded: IndexRulePreviewRow[] = [];
  const restricted: IndexRulePreviewRow[] = [];

  let rootReal = workspaceRoot;
  try {
    rootReal = await fs.realpath(workspaceRoot);
  } catch {
    rootReal = workspaceRoot;
  }

  async function outside(abs: string): Promise<boolean> {
    try {
      const real = await fs.realpath(abs);
      const rel = path.relative(rootReal, real);
      return rel.startsWith('..') || path.isAbsolute(rel);
    } catch {
      return true;
    }
  }

  let seen = 0;

  async function recurse(dirRel: string): Promise<void> {
    if (options.signal?.aborted || seen >= maxFiles) {
      return;
    }
    const absDir = dirRel ? path.join(workspaceRoot, dirRel) : workspaceRoot;
    let entries: Array<{
      name: string;
      isDirectory(): boolean;
      isFile(): boolean;
    }>;
    try {
      entries = (await fs.readdir(absDir, { withFileTypes: true })) as Array<{
        name: string;
        isDirectory(): boolean;
        isFile(): boolean;
      }>;
    } catch {
      return;
    }

    for (const entry of entries) {
      if (options.signal?.aborted || seen >= maxFiles) {
        return;
      }
      const name = entry.name;
      const rel = dirRel ? `${dirRel}/${name}` : name;
      const normalised = rel.replace(/\\/g, '/');

      if (entry.isDirectory()) {
        if (name === '.git' || RAG_WALK_EXCLUDE.has(name)) {
          excluded.push(
            toRow(
              decisionFromClassification(normalised + '/', 'never_index', {
                matchedPattern: name,
                ruleSource: 'default',
                detail: `default-exclude:${name}`,
              })
            )
          );
          continue;
        }
        if (name.startsWith('.') && name !== '.mergecore') {
          excluded.push(
            toRow(
              decisionFromClassification(normalised + '/', 'never_index', {
                matchedPattern: name,
                ruleSource: 'default',
                detail: 'hidden-directory',
              })
            )
          );
          continue;
        }
        const abs = path.join(workspaceRoot, normalised);
        if (await outside(abs)) {
          continue;
        }
        await ignoreResolver.ensureDir(normalised);
        const dirIgnore = await ignoreResolver.decide(normalised, true);
        if (dirIgnore.ignored) {
          excluded.push(
            toRow(
              decisionFromClassification(normalised + '/', 'never_index', {
                matchedPattern: dirIgnore.detail,
                ruleSource:
                  dirIgnore.reason === 'mergecoreignore'
                    ? 'mergecoreignore'
                    : 'gitignore',
                detail: dirIgnore.detail,
              })
            )
          );
          continue;
        }
        await recurse(normalised);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }
      seen++;

      if (isTempPath(normalised) || isBinaryExtension(normalised)) {
        excluded.push(
          toRow(
            decisionFromClassification(normalised, 'never_index', {
              matchedPattern: 'temp-or-binary',
              ruleSource: 'default',
              detail: isTempPath(normalised) ? 'temp-file' : 'binary',
            })
          )
        );
        continue;
      }
      if (!isSupportedIndexPath(normalised)) {
        excluded.push(
          toRow(
            decisionFromClassification(normalised, 'never_index', {
              matchedPattern: 'unsupported',
              ruleSource: 'default',
              detail: 'unsupported',
            })
          )
        );
        continue;
      }

      const abs = path.join(workspaceRoot, normalised);
      if (await outside(abs)) {
        excluded.push(
          toRow(
            decisionFromClassification(normalised, 'never_index', {
              matchedPattern: 'symlink-escape',
              ruleSource: 'default',
              detail: 'symlink-escape',
            })
          )
        );
        continue;
      }

      const decision = await engine.evaluate(normalised);
      const row = toRow(decision);
      if (!decision.included) {
        excluded.push(row);
      } else if (!decision.allowsModelEvidence) {
        restricted.push(row);
        included.push(row);
      } else {
        included.push(row);
      }
    }
  }

  await recurse('');

  const byPath = (a: IndexRulePreviewRow, b: IndexRulePreviewRow) =>
    a.path.localeCompare(b.path);
  return {
    workspaceRoot,
    included: included.sort(byPath),
    excluded: excluded.sort(byPath),
    restricted: restricted.sort(byPath),
  };
}
