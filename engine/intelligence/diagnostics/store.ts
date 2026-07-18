import * as fs from 'fs/promises';
import * as path from 'path';
import { DIAGNOSTICS_DIR, USAGE_METRICS_PATH } from '../memory/paths';
import {
  EMPTY_USAGE_METRICS,
  USAGE_METRICS_SCHEMA_VERSION,
  type UsageEvent,
  type UsageMetricsSnapshot,
} from './types';

function metricsAbs(workspaceRoot: string): string {
  return path.join(workspaceRoot, USAGE_METRICS_PATH);
}

export async function loadUsageMetrics(
  workspaceRoot: string
): Promise<UsageMetricsSnapshot> {
  try {
    const raw = await fs.readFile(metricsAbs(workspaceRoot), 'utf8');
    const parsed = JSON.parse(raw) as Partial<UsageMetricsSnapshot>;
    return {
      ...EMPTY_USAGE_METRICS,
      ...parsed,
      schemaVersion: USAGE_METRICS_SCHEMA_VERSION,
      frequentSourceHashes: { ...(parsed.frequentSourceHashes ?? {}) },
      lowConfidenceQueryFingerprints: [
        ...(parsed.lowConfidenceQueryFingerprints ?? []),
      ].slice(-64),
    };
  } catch {
    return { ...EMPTY_USAGE_METRICS, frequentSourceHashes: {} };
  }
}

export async function saveUsageMetrics(
  workspaceRoot: string,
  snapshot: UsageMetricsSnapshot
): Promise<void> {
  const dir = path.join(workspaceRoot, DIAGNOSTICS_DIR);
  await fs.mkdir(dir, { recursive: true });
  const next: UsageMetricsSnapshot = {
    ...snapshot,
    schemaVersion: USAGE_METRICS_SCHEMA_VERSION,
    updatedAt: new Date().toISOString(),
  };
  await fs.writeFile(metricsAbs(workspaceRoot), `${JSON.stringify(next, null, 2)}\n`, 'utf8');
}

export function applyUsageEvent(
  snapshot: UsageMetricsSnapshot,
  event: UsageEvent
): UsageMetricsSnapshot {
  const n = Math.max(1, event.count ?? 1);
  const hashes = { ...snapshot.frequentSourceHashes };
  if (event.pathHash) {
    hashes[event.pathHash] = (hashes[event.pathHash] ?? 0) + n;
  }
  let lowFingerprints = [...snapshot.lowConfidenceQueryFingerprints];
  if (event.queryFingerprint) {
    lowFingerprints = [...lowFingerprints, event.queryFingerprint].slice(-64);
  }

  const base: UsageMetricsSnapshot = {
    ...snapshot,
    frequentSourceHashes: hashes,
    lowConfidenceQueryFingerprints: lowFingerprints,
    updatedAt: new Date().toISOString(),
  };

  switch (event.kind) {
    case 'context_pack_generated':
      return { ...base, contextPacksGenerated: base.contextPacksGenerated + n };
    case 'hover_use':
      return { ...base, hoverUses: base.hoverUses + n };
    case 'explanation_opened':
      return { ...base, explanationsOpened: base.explanationsOpened + n };
    case 'manually_added_file':
      return { ...base, manuallyAddedFiles: base.manuallyAddedFiles + n };
    case 'manually_removed_file':
      return { ...base, manuallyRemovedFiles: base.manuallyRemovedFiles + n };
    case 'low_confidence_query':
      return { ...base, lowConfidenceQueries: base.lowConfidenceQueries + n };
    case 'retrieval_latency':
      return {
        ...base,
        retrievalLatencyMsSum: base.retrievalLatencyMsSum + (event.latencyMs ?? 0),
        retrievalLatencyCount: base.retrievalLatencyCount + n,
      };
    case 'index_latency':
      return {
        ...base,
        indexLatencyMsSum: base.indexLatencyMsSum + (event.latencyMs ?? 0),
        indexLatencyCount: base.indexLatencyCount + n,
      };
    case 'parse_failure':
      return { ...base, parseFailureCount: base.parseFailureCount + n };
    case 'frequent_source':
      return base;
    default:
      return base;
  }
}

export async function recordUsageEvent(
  workspaceRoot: string,
  event: UsageEvent
): Promise<UsageMetricsSnapshot> {
  const current = await loadUsageMetrics(workspaceRoot);
  const next = applyUsageEvent(current, event);
  await saveUsageMetrics(workspaceRoot, next);
  return next;
}

export async function deleteUsageDiagnostics(
  workspaceRoot: string
): Promise<void> {
  const dir = path.join(workspaceRoot, DIAGNOSTICS_DIR);
  try {
    await fs.rm(dir, { recursive: true, force: true });
  } catch {
    // ignore
  }
}

export function averageLatencyMs(sum: number, count: number): number | null {
  if (count <= 0) return null;
  return Math.round(sum / count);
}
