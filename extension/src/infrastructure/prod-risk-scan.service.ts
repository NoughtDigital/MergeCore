import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';
import {
  PROD_RISK_CATEGORIES,
  scanProdRisks,
  type ProdRiskCategory,
  type ProdRiskFinding,
  type ProdRiskScanResult,
  type ProjectProfile,
} from '@mergecore/intelligence';
import type { Finding, ReviewResult } from '../domain/review-types';
import { MergeCoreLogger } from './logger';

/**
 * Thin coordinator between the VS Code extension and the pack-aware
 * prod-risk scanner in `@mergecore/intelligence`.
 *
 * Responsibilities:
 *  - Locate the nearest `rules/registry.json` so the scanner picks up
 *    any packs shipped with the repo (first-party or vendored).
 *  - Convert scanner output into the extension's shared `ReviewResult`
 *    shape so the existing sidebar, diagnostics, and markdown export
 *    surfaces can display it with zero new UI code.
 *  - Group findings by file so per-file diagnostics can be rendered
 *    through the normal `FindingDiagnostics` pipeline.
 *
 * Kept deliberately free of `vscode.window` side effects so the service
 * is testable without the VS Code host.
 */

const HUMAN_CATEGORY: Readonly<Record<ProdRiskCategory, string>> = {
  'race-conditions': 'Race conditions',
  'retry-duplication': 'Retry duplication',
  'no-transactions': 'Missing transactions',
  'bad-queue-retries': 'Bad queue retries',
  'memory-leaks': 'Memory leaks',
  'n-plus-one': 'N+1 queries',
  'missing-indexes': 'Missing indexes',
  'no-rate-limits': 'No rate limits',
  'weak-logging': 'Weak logging',
};

export interface ProdRiskScanInput {
  readonly workspaceRoot: string;
  readonly profile?: ProjectProfile;
  readonly progress?: vscode.Progress<{ message?: string; increment?: number }>;
  readonly token?: vscode.CancellationToken;
  /** When provided, scan this subset instead of walking the workspace. */
  readonly files?: readonly string[];
}

export interface ProdRiskScanOutcome {
  readonly result: ProdRiskScanResult;
  readonly review: ReviewResult;
  readonly findingsByFile: ReadonlyMap<string, readonly Finding[]>;
}

export class ProdRiskScanService {
  async scan(input: ProdRiskScanInput): Promise<ProdRiskScanOutcome> {
    const registryPath = await locateRulesRegistry(input.workspaceRoot);
    const logger = MergeCoreLogger.shared;
    logger.info(
      `Prod-risk scan starting: root=${input.workspaceRoot} registry=${registryPath ?? '(none)'}`
    );

    const scan = await scanProdRisks({
      workspaceRoot: input.workspaceRoot,
      profile: input.profile,
      rulesRegistryPath: registryPath,
      files: input.files,
      progress: {
        onFile: (rel, index, total) => {
          // VS Code progress handlers throw if we post more than ~100 updates; throttle.
          if (index % 25 === 0) {
            input.progress?.report({
              message: `Scanning ${rel} (${index + 1}/${total})`,
            });
          }
          if (input.token?.isCancellationRequested) {
            throw new Error('cancelled');
          }
        },
      },
    });

    logger.info(
      `Prod-risk scan done in ${scan.durationMs} ms: ${scan.findings.length} finding(s) across ${scan.scannedFiles} file(s); active rules=${scan.activeRuleIds.length}`
    );

    const review = toReviewResult(scan);
    const byFile = groupFindingsByFile(scan.findings);

    return { result: scan, review, findingsByFile: byFile };
  }
}

/**
 * Walk up from the workspace root looking for `rules/registry.json`.
 * First-party users have it at `rules/registry.json`; hosts that
 * vendor MergeCore may place it somewhere else. Returning `undefined`
 * just means the scan runs on built-ins only — still useful.
 */
async function locateRulesRegistry(workspaceRoot: string): Promise<string | undefined> {
  const candidates = [
    path.join(workspaceRoot, 'rules', 'registry.json'),
    path.join(workspaceRoot, '.mergecore', 'rules', 'registry.json'),
    path.join(workspaceRoot, 'mergecore', 'rules', 'registry.json'),
  ];
  for (const candidate of candidates) {
    try {
      const stat = await fs.stat(candidate);
      if (stat.isFile()) {
        return candidate;
      }
    } catch {
      // keep looking
    }
  }
  return undefined;
}

function toReviewResult(scan: ProdRiskScanResult): ReviewResult {
  const findings: Finding[] = scan.findings.map((f) => prodRiskToFinding(f));
  const summary = buildSummaryText(scan);
  const score = scoreFor(scan);
  return {
    findings,
    score,
    summary,
  };
}

function prodRiskToFinding(f: ProdRiskFinding): Finding {
  return {
    id: `prod-risk/${f.ruleId}`,
    severity: f.severity,
    message: f.title,
    whyItMatters: f.description || undefined,
    fixHint: f.fixHint || undefined,
    file: f.file,
    line: f.line,
    column: f.column,
    category: `prod-risk:${f.category}`,
    code: f.ruleId,
  };
}

function groupFindingsByFile(
  findings: readonly ProdRiskFinding[]
): ReadonlyMap<string, readonly Finding[]> {
  const buckets = new Map<string, Finding[]>();
  for (const f of findings) {
    const key = f.file;
    const list = buckets.get(key);
    const next = prodRiskToFinding(f);
    if (list) {
      list.push(next);
    } else {
      buckets.set(key, [next]);
    }
  }
  return buckets;
}

function buildSummaryText(scan: ProdRiskScanResult): string {
  if (scan.findings.length === 0) {
    return `What Breaks In Prod? — no matches across ${scan.scannedFiles} file(s). Rule set ${scan.ruleSetFingerprint} (${scan.activeRuleIds.length} active). This is a local, pack-aware heuristic scan; a full review still catches higher-order issues.`;
  }
  const parts = scan.summary.map(
    (s) => `${HUMAN_CATEGORY[s.category]}: ${s.count} (${s.files} file${s.files === 1 ? '' : 's'})`
  );
  const missingCategories = PROD_RISK_CATEGORIES.filter(
    (c) => !scan.summary.some((s) => s.category === c)
  );
  const clean = missingCategories.length > 0
    ? ` Clean: ${missingCategories.map((c) => HUMAN_CATEGORY[c]).join(', ')}.`
    : '';
  return `What Breaks In Prod? — ${scan.findings.length} finding(s) across ${scan.scannedFiles} scanned file(s) in ${scan.durationMs} ms. ${parts.join('; ')}.${clean} Rule set ${scan.ruleSetFingerprint}.`;
}

function scoreFor(scan: ProdRiskScanResult): number {
  if (scan.findings.length === 0) {
    return 10;
  }
  // Same penalty shape as the review engine's severity cost so the
  // score reads on the same 0–10 scale users already expect.
  const cost = scan.findings.reduce((sum, f) => {
    switch (f.severity) {
      case 'critical':
        return sum + 2.8;
      case 'error':
        return sum + 2.0;
      case 'warning':
        return sum + 1.25;
      case 'info':
        return sum + 0.6;
      case 'hint':
      default:
        return sum + 0.4;
    }
  }, 0);
  const raw = 10 - cost;
  return Math.round(Math.max(3, Math.min(10, raw)) * 100) / 100;
}
