import * as fs from 'fs/promises';
import * as path from 'path';
import { formatRelationshipPathLabel } from '../graph/paths/rank';
import { traverseRelationshipPaths } from '../graph/paths/traverse';
import { LAST_INSPECTION_PATH, DIAGNOSTICS_DIR } from '../memory/paths';
import { sha256 } from '../rag/hash';
import type { RagStore } from '../rag/store';
import { queryTerms } from '../retrieve/signals';
import type {
  RetrievalBudgetUsage,
  RetrievalCandidateSummary,
  RetrievalDebugInfo,
  RetrievalDependencyPathSummary,
  RetrievalIndexHealth,
  RetrievalInspectionRecord,
  RetrievalParserFailure,
  RetrievalSourceFreshness,
  RetrievalStageTiming,
  RepositoryContextResult,
  ScoreBreakdown,
} from '../retrieve/types';
import { fingerprintQuery } from './scrub';
import { sumBreakdown } from '../retrieve/signals';

export function buildQueryFingerprint(query: string): string {
  return fingerprintQuery(query);
}

export function buildNormalisedQuery(query: string): readonly string[] {
  return queryTerms(query.trim()).slice(0, 48);
}

export function stageTimer(): {
  mark: (name: string) => void;
  stages: () => RetrievalStageTiming[];
} {
  const stages: RetrievalStageTiming[] = [];
  let last = Date.now();
  return {
    mark(name: string) {
      const now = Date.now();
      stages.push({ name, elapsedMs: Math.max(0, now - last) });
      last = now;
    },
    stages: () => [...stages],
  };
}

function freshnessForPath(
  store: RagStore,
  relPath: string
): RetrievalSourceFreshness {
  const file = store.getFile(relPath);
  if (!file) {
    return { path: relPath, status: 'missing' };
  }
  if (!file.hash) {
    return { path: relPath, status: 'unknown' };
  }
  // Indexed hash present — treat as fresh relative to the local index snapshot
  const ageMs = Date.now() - (file.indexedAt ?? file.mtimeMs ?? 0);
  if (ageMs > 7 * 24 * 60 * 60 * 1000) {
    return { path: relPath, status: 'stale' };
  }
  return { path: relPath, status: 'fresh' };
}

export function collectParserFailures(store: RagStore): RetrievalParserFailure[] {
  const out: RetrievalParserFailure[] = [];
  for (const p of store.allFilePaths()) {
    const f = store.getFile(p);
    if (f?.parseStatus === 'error') {
      out.push({ path: p, message: 'parseStatus=error' });
    }
  }
  return out.slice(0, 40);
}

export function buildIndexHealth(
  store: RagStore,
  incomplete: boolean
): RetrievalIndexHealth {
  const fileCount = store.fileCount;
  const chunkCount = store.chunkCount;
  const updatedAt = store.updatedAt;
  const ageMs = updatedAt ? Date.now() - updatedAt : Number.POSITIVE_INFINITY;
  return {
    updatedAt,
    fileCount,
    chunkCount,
    schemaVersion: store.schemaVersion,
    incomplete: incomplete || chunkCount === 0,
    possiblyStale: chunkCount === 0 || ageMs > 14 * 24 * 60 * 60 * 1000,
  };
}

export function buildDependencyPathSummaries(
  store: RagStore,
  seedPaths: readonly string[]
): RetrievalDependencyPathSummary[] {
  const out: RetrievalDependencyPathSummary[] = [];
  for (const seed of seedPaths.slice(0, 3)) {
    const paths = traverseRelationshipPaths({
      store,
      start: { path: seed },
      budget: { maxDepth: 2, maxPaths: 4, maxNodes: 24, direction: 'both' },
    });
    for (const p of paths.slice(0, 4)) {
      if (p.steps.length < 2) continue;
      out.push({
        label: formatRelationshipPathLabel(p),
        paths: p.steps.map((s) => s.node.path),
        score: p.score,
      });
    }
  }
  return out.slice(0, 12);
}

export function assembleRetrievalDebugInfo(input: {
  readonly query: string;
  readonly store: RagStore;
  readonly candidateCount: number;
  readonly selectedCount: number;
  readonly rejected: RetrievalDebugInfo['rejected'];
  readonly filtering: RetrievalDebugInfo['filtering'];
  readonly scoreComponents: RetrievalDebugInfo['scoreComponents'];
  readonly selectedIds: readonly string[];
  readonly rejectedIds: readonly string[];
  readonly elapsedMs: number;
  readonly notes: readonly string[];
  readonly stages: readonly RetrievalStageTiming[];
  readonly candidates: readonly RetrievalCandidateSummary[];
  readonly budgetUsage: RetrievalBudgetUsage;
  readonly selectedPaths: readonly string[];
  readonly seedPaths: readonly string[];
  readonly incomplete: boolean;
}): RetrievalDebugInfo {
  const sourceFreshness = input.selectedPaths
    .slice(0, 40)
    .map((p) => freshnessForPath(input.store, p));
  return {
    candidateCount: input.candidateCount,
    selectedCount: input.selectedCount,
    rejected: input.rejected,
    filtering: input.filtering,
    scoreComponents: input.scoreComponents,
    selectedIds: input.selectedIds,
    rejectedIds: input.rejectedIds,
    elapsedMs: input.elapsedMs,
    notes: input.notes,
    queryFingerprint: buildQueryFingerprint(input.query),
    normalisedQuery: buildNormalisedQuery(input.query),
    stages: input.stages,
    candidates: input.candidates,
    budgetUsage: input.budgetUsage,
    sourceFreshness,
    parserFailures: collectParserFailures(input.store),
    indexHealth: buildIndexHealth(input.store, input.incomplete),
    dependencyPaths: buildDependencyPathSummaries(input.store, input.seedPaths),
  };
}

/** Persist a redacted inspection (no originalQuery) for MCP / Inspect command. */
export async function saveLastInspection(
  workspaceRoot: string,
  record: RetrievalInspectionRecord
): Promise<void> {
  const dir = path.join(workspaceRoot, DIAGNOSTICS_DIR);
  await fs.mkdir(dir, { recursive: true });
  const redacted = {
    capturedAt: record.capturedAt,
    workspaceRoot: undefined,
    queryFingerprint: record.debug.queryFingerprint,
    normalisedQuery: record.debug.normalisedQuery,
    incomplete: record.result.incomplete,
    selectedPaths: record.result.results.map((r) => r.path),
    selectedIds: record.debug.selectedIds,
    rejected: record.debug.rejected,
    filtering: record.debug.filtering,
    scoreComponents: record.debug.scoreComponents,
    stages: record.debug.stages,
    budgetUsage: record.debug.budgetUsage,
    sourceFreshness: record.debug.sourceFreshness,
    parserFailures: record.debug.parserFailures,
    indexHealth: record.debug.indexHealth,
    dependencyPaths: record.debug.dependencyPaths,
    notes: record.debug.notes,
    elapsedMs: record.debug.elapsedMs,
    candidateCount: record.debug.candidateCount,
    selectedCount: record.debug.selectedCount,
    candidates: record.debug.candidates,
    // Session-only field omitted from disk by default for safety in shared machines;
    // Inspect panel uses in-memory session cache when available.
  };
  await fs.writeFile(
    path.join(workspaceRoot, LAST_INSPECTION_PATH),
    `${JSON.stringify(redacted, null, 2)}\n`,
    'utf8'
  );
}

export async function loadLastInspection(
  workspaceRoot: string
): Promise<Record<string, unknown> | undefined> {
  try {
    const raw = await fs.readFile(
      path.join(workspaceRoot, LAST_INSPECTION_PATH),
      'utf8'
    );
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

export function inspectionFromResult(
  result: RepositoryContextResult,
  originalQuery?: string
): RetrievalInspectionRecord | undefined {
  if (!result.debug) return undefined;
  return {
    capturedAt: Date.now(),
    workspaceRoot: result.workspaceRoot,
    originalQuery,
    result,
    debug: result.debug,
  };
}

/** Re-export helper used by tests. */
export function scoreTotal(breakdown: ScoreBreakdown): number {
  return sumBreakdown(breakdown);
}

export function stableId(...parts: string[]): string {
  return sha256(parts.join('|')).slice(0, 16);
}
