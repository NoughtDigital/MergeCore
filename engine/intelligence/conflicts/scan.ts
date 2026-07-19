import * as fs from 'fs/promises';
import * as path from 'path';
import { sha256 } from '../rag/hash';
import type { RagStore } from '../rag/store';
import { runConflictDetectors } from './detectors';
import { extractConflictRuleCandidates } from './extract-rules';
import {
  extractedToConflictRule,
  loadConflictIgnores,
  loadConflictRulesFile,
  loadExtractedConflictRules,
} from './load-config';
import type {
  ConflictRule,
  ContextConflictFinding,
  ContextConflictScanResult,
} from './types';

export interface ScanContextConflictsOptions {
  readonly workspaceRoot: string;
  readonly store?: RagStore;
  /** Re-run extraction before scan (default true). */
  readonly refreshExtraction?: boolean;
  /** Include ignored findings marked ignored:true (default false omit). */
  readonly includeIgnored?: boolean;
  readonly signal?: AbortSignal;
  readonly maxFiles?: number;
}

async function listCandidatePaths(
  workspaceRoot: string,
  maxFiles: number,
  signal?: AbortSignal
): Promise<string[]> {
  const out: string[] = [];
  const skip = new Set([
    'node_modules',
    '.git',
    'dist',
    'out',
    'coverage',
    'vendor',
    '.mergecore',
  ]);

  async function walk(dirRel: string): Promise<void> {
    if (signal?.aborted || out.length >= maxFiles) return;
    const abs = dirRel ? path.join(workspaceRoot, dirRel) : workspaceRoot;
    let entries: Array<{
      name: string;
      isDirectory(): boolean;
      isFile(): boolean;
    }>;
    try {
      entries = (await fs.readdir(abs, { withFileTypes: true })) as Array<{
        name: string;
        isDirectory(): boolean;
        isFile(): boolean;
      }>;
    } catch {
      return;
    }
    for (const ent of entries) {
      if (signal?.aborted || out.length >= maxFiles) return;
      const name = ent.name;
      if (skip.has(name)) continue;
      if (name.startsWith('.') && name !== '.env.example') continue;
      const rel = dirRel ? `${dirRel}/${name}` : name;
      const normalised = rel.replace(/\\/g, '/');
      if (ent.isDirectory()) {
        await walk(normalised);
        continue;
      }
      if (!ent.isFile()) continue;
      if (!/\.(ts|tsx|js|jsx|mjs|cjs|php)$/i.test(name)) continue;
      out.push(normalised);
    }
  }

  await walk('');
  return out;
}

function documentedEvidence(rule: ConflictRule): ContextConflictFinding['documentedRule'] {
  const start =
    rule.source?.startLine ?? rule.source?.line ?? 1;
  const end = rule.source?.endLine ?? start;
  return {
    text: rule.description,
    path: rule.source?.path ?? '.mergecore/conflict-rules.json',
    startLine: start,
    endLine: end,
  };
}

function findingId(ruleId: string, paths: readonly string[]): string {
  return `conflict:${sha256(`${ruleId}|${[...paths].sort().join(',')}`).slice(0, 20)}`;
}

/**
 * Scan for documented-rule vs observed-implementation conflicts.
 * Only configured rules and user-confirmed extractions are enforced.
 */
export async function scanContextConflicts(
  options: ScanContextConflictsOptions
): Promise<ContextConflictScanResult> {
  const root = path.resolve(options.workspaceRoot);
  const notes: string[] = [];

  let extractedPending = 0;
  if (options.refreshExtraction !== false) {
    const extracted = await extractConflictRuleCandidates({
      workspaceRoot: root,
      signal: options.signal,
    });
    extractedPending = extracted.candidates.filter((c) => c.status === 'pending').length;
    notes.push(
      `Extracted ${extracted.candidates.length} candidate rule(s); ${extracted.newlyFound} new; ${extracted.skippedVague} vague skipped.`
    );
  } else {
    extractedPending = loadExtractedConflictRules(root).rules.filter(
      (c) => c.status === 'pending'
    ).length;
  }

  const configured = loadConflictRulesFile(root).rules.filter((r) => r.enabled);
  const confirmed = loadExtractedConflictRules(root)
    .rules.map(extractedToConflictRule)
    .filter((r): r is ConflictRule => Boolean(r?.enabled));

  const rules: ConflictRule[] = [];
  const seen = new Set<string>();
  for (const r of [...configured, ...confirmed]) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    rules.push(r);
  }

  if (rules.length === 0) {
    notes.push(
      'No active conflict rules. Add `.mergecore/conflict-rules.json` or confirm extracted rules.'
    );
    return {
      workspaceRoot: root,
      findings: [],
      rulesScanned: 0,
      extractedPending,
      notes,
    };
  }

  let candidatePaths: string[];
  if (options.store) {
    const fromFiles = new Set<string>();
    for (const c of options.store.allChunks()) {
      fromFiles.add(c.path.replace(/\\/g, '/'));
    }
    for (const e of options.store.allEdges()) {
      fromFiles.add(e.fromPath.replace(/\\/g, '/'));
    }
    candidatePaths = [...fromFiles];
    if (candidatePaths.length === 0) {
      candidatePaths = await listCandidatePaths(
        root,
        options.maxFiles ?? 8_000,
        options.signal
      );
      notes.push('Index had no paths; fell back to workspace walk.');
    }
  } else {
    candidatePaths = await listCandidatePaths(
      root,
      options.maxFiles ?? 8_000,
      options.signal
    );
  }

  const ignores = loadConflictIgnores(root).ignores;
  const ignoreIds = new Set(ignores.map((i) => i.conflictId));
  const findings: ContextConflictFinding[] = [];

  for (const rule of rules) {
    if (options.signal?.aborted) break;
    const hits = await runConflictDetectors({
      workspaceRoot: root,
      rule,
      candidatePaths,
      store: options.store,
    });
    if (hits.length === 0) continue;

    const byFile = new Map<string, Array<(typeof hits)[number]>>();
    for (const h of hits) {
      const list = byFile.get(h.evidence.path) ?? [];
      list.push(h);
      byFile.set(h.evidence.path, list);
    }

    const affectedFiles = [...byFile.keys()].sort();
    const id = findingId(rule.id, affectedFiles);
    const ignored = ignoreIds.has(id) || ignores.some((i) => i.ruleId === rule.id && (!i.paths?.length || i.paths.some((p) => affectedFiles.includes(p))));

    if (ignored && !options.includeIgnored) {
      continue;
    }

    const confidence =
      hits.every((h) => h.confidence === 'high')
        ? 'high'
        : hits.some((h) => h.confidence === 'high')
          ? 'medium'
          : 'low';

    findings.push({
      id,
      message: 'Documented rule conflicts with observed implementation.',
      rule,
      detector: rule.detector,
      confidence,
      documentedRule: documentedEvidence(rule),
      observedCode: hits.map((h) => h.evidence),
      affectedFiles,
      userConfirmed: rule.userConfirmed,
      ignored,
    });
  }

  findings.sort((a, b) => a.rule.id.localeCompare(b.rule.id));

  return {
    workspaceRoot: root,
    findings,
    rulesScanned: rules.length,
    extractedPending,
    notes,
  };
}
