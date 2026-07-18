import * as fs from 'fs/promises';
import * as path from 'path';
import { MISSING_CONTEXT_DIR } from '../memory/paths';
import { hashRelativePath, fingerprintQuery } from './scrub';

export const MISSING_CONTEXT_SCHEMA_VERSION = 1;

export interface MissingContextFeedback {
  readonly schemaVersion: number;
  readonly createdAt: string;
  readonly queryFingerprint: string;
  readonly missingPathHash: string;
  /** Local-only developer path — never include in analytics export. */
  readonly missingPath: string;
  readonly lastSelectedPathHashes: readonly string[];
  readonly notes?: string;
}

export async function saveMissingContextFeedback(
  workspaceRoot: string,
  input: {
    readonly query: string;
    readonly missingPath: string;
    readonly lastSelectedPaths?: readonly string[];
    readonly notes?: string;
  }
): Promise<{ readonly relativePath: string; readonly feedback: MissingContextFeedback }> {
  const dir = path.join(workspaceRoot, MISSING_CONTEXT_DIR);
  await fs.mkdir(dir, { recursive: true });
  const missingPath = input.missingPath.replace(/\\/g, '/');
  const feedback: MissingContextFeedback = {
    schemaVersion: MISSING_CONTEXT_SCHEMA_VERSION,
    createdAt: new Date().toISOString(),
    queryFingerprint: fingerprintQuery(input.query),
    missingPathHash: hashRelativePath(missingPath),
    missingPath,
    lastSelectedPathHashes: (input.lastSelectedPaths ?? []).map(hashRelativePath),
    notes: input.notes?.trim() || undefined,
  };
  const file = `${feedback.createdAt.replace(/[:.]/g, '-')}-${feedback.missingPathHash.slice(0, 8)}.json`;
  const abs = path.join(dir, file);
  await fs.writeFile(abs, `${JSON.stringify(feedback, null, 2)}\n`, 'utf8');
  return {
    relativePath: path.posix.join(MISSING_CONTEXT_DIR, file),
    feedback,
  };
}

export async function listMissingContextFeedback(
  workspaceRoot: string
): Promise<readonly MissingContextFeedback[]> {
  const dir = path.join(workspaceRoot, MISSING_CONTEXT_DIR);
  try {
    const entries = await fs.readdir(dir);
    const out: MissingContextFeedback[] = [];
    for (const name of entries) {
      if (!name.endsWith('.json')) continue;
      try {
        const raw = await fs.readFile(path.join(dir, name), 'utf8');
        out.push(JSON.parse(raw) as MissingContextFeedback);
      } catch {
        // skip malformed
      }
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Convert local missing-context feedback into eval-style tasks.
 * Does not alter production ranking.
 */
export function missingContextToEvalTasks(
  feedback: readonly MissingContextFeedback[]
): ReadonlyArray<{
  readonly id: string;
  readonly queryFingerprint: string;
  readonly relevantPathHashes: readonly string[];
  /** Local path for offline eval harnesses only. */
  readonly relevantFiles: readonly string[];
}> {
  return feedback.map((f, i) => ({
    id: `missing-context-${i}-${f.missingPathHash.slice(0, 8)}`,
    queryFingerprint: f.queryFingerprint,
    relevantPathHashes: [f.missingPathHash],
    relevantFiles: [f.missingPath],
  }));
}

/**
 * Load Mark Missing Context feedback as optional eval tasks.
 * Does not alter production ranking weights.
 */
export async function loadMissingContextEvalTasks(
  workspaceRoot: string
): Promise<
  ReadonlyArray<{
    readonly id: string;
    readonly queryFingerprint: string;
    readonly relevantPathHashes: readonly string[];
    readonly relevantFiles: readonly string[];
  }>
> {
  const feedback = await listMissingContextFeedback(workspaceRoot);
  return missingContextToEvalTasks(feedback);
}
