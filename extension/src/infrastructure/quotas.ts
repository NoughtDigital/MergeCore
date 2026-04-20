/**
 * Client-side quotas mirror `engine/pipeline/cost-controls.ts` so we fail fast
 * with a helpful message instead of uploading a 5 MB file and then surfacing
 * a 413.
 */
export interface ClientQuota {
  readonly maxInputChars: number;
  readonly maxDiffChars: number;
  readonly maxFindings: number;
}

export const DEFAULT_CLIENT_QUOTA: ClientQuota = {
  maxInputChars: 48_000,
  maxDiffChars: 120_000,
  maxFindings: 25,
};

export function quotaFor(scope: 'selection' | 'file' | 'git-diff', q: ClientQuota = DEFAULT_CLIENT_QUOTA): number {
  return scope === 'git-diff' ? q.maxDiffChars : q.maxInputChars;
}
