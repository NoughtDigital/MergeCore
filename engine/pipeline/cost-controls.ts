/**
 * Cost and abuse controls for the review API. Enforce server-side; never trust the extension.
 */

export interface QuotaConfig {
  readonly maxInputChars: number;
  readonly maxDiffChars: number;
  readonly maxFindingsReturned: number;
  readonly dailySoftCapTokensPerUser: number;
  readonly concurrentReviewsPerUser: number;
}

export const DEFAULT_QUOTA: QuotaConfig = {
  maxInputChars: 48_000,
  maxDiffChars: 120_000,
  maxFindingsReturned: 25,
  dailySoftCapTokensPerUser: 800_000,
  concurrentReviewsPerUser: 2,
};

export function estimateBillableTokensRough(inputChars: number, outputCap: number): number {
  // Rough heuristic: ~0.25 tokens per char for English/code mix; use provider tokenizer in production.
  return Math.ceil(inputChars * 0.28 + outputCap * 1.0);
}

export function shouldEscalate(
  findings: ReadonlyArray<{ severity: string }>,
  primaryScore: number
): boolean {
  const critical = findings.some((f) => f.severity === 'critical' || f.severity === 'error');
  return critical || primaryScore <= 3;
}
