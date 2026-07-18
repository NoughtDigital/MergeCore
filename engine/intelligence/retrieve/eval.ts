/**
 * Evaluation metrics for retrieval fixtures. Reports real measured values only.
 */

export interface EvalTask {
  readonly id: string;
  readonly query: string;
  /** Relative paths expected to be relevant (gold set). */
  readonly relevantFiles: readonly string[];
}

export interface EvalTaskResult {
  readonly taskId: string;
  readonly query: string;
  readonly retrievedFiles: readonly string[];
  readonly precisionAtK: number;
  readonly recallAtK: number;
  readonly mrr: number;
  readonly k: number;
}

export interface EvalSummary {
  readonly tasks: readonly EvalTaskResult[];
  readonly meanPrecisionAtK: number;
  readonly meanRecallAtK: number;
  readonly meanMrr: number;
  readonly k: number;
}

function normalise(p: string): string {
  return p.replace(/\\/g, '/');
}

export function precisionAtK(
  retrieved: readonly string[],
  relevant: ReadonlySet<string>,
  k: number
): number {
  const top = retrieved.slice(0, k).map(normalise);
  if (top.length === 0) return 0;
  let hits = 0;
  for (const p of top) {
    if (relevant.has(p)) hits++;
  }
  return hits / Math.min(k, top.length);
}

export function recallAtK(
  retrieved: readonly string[],
  relevant: ReadonlySet<string>,
  k: number
): number {
  if (relevant.size === 0) return 0;
  const top = new Set(retrieved.slice(0, k).map(normalise));
  let hits = 0;
  for (const r of relevant) {
    if (top.has(r)) hits++;
  }
  return hits / relevant.size;
}

/** Mean reciprocal rank of the first relevant file. */
export function meanReciprocalRank(
  retrieved: readonly string[],
  relevant: ReadonlySet<string>
): number {
  for (let i = 0; i < retrieved.length; i++) {
    if (relevant.has(normalise(retrieved[i]!))) {
      return 1 / (i + 1);
    }
  }
  return 0;
}

export function evaluateRetrievalTasks(
  tasks: readonly EvalTask[],
  retrievedByTask: ReadonlyMap<string, readonly string[]>,
  k: number
): EvalSummary {
  const results: EvalTaskResult[] = [];
  for (const task of tasks) {
    const retrieved = retrievedByTask.get(task.id) ?? [];
    const relevant = new Set(task.relevantFiles.map(normalise));
    results.push({
      taskId: task.id,
      query: task.query,
      retrievedFiles: retrieved.map(normalise),
      precisionAtK: precisionAtK(retrieved, relevant, k),
      recallAtK: recallAtK(retrieved, relevant, k),
      mrr: meanReciprocalRank(retrieved, relevant),
      k,
    });
  }
  const n = results.length || 1;
  return {
    tasks: results,
    meanPrecisionAtK: results.reduce((s, r) => s + r.precisionAtK, 0) / n,
    meanRecallAtK: results.reduce((s, r) => s + r.recallAtK, 0) / n,
    meanMrr: results.reduce((s, r) => s + r.mrr, 0) / n,
    k,
  };
}
