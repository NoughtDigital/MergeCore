/**
 * MergeCore AI review pipeline orchestration (server-side).
 * Order: validate -> deterministic rules -> cache lookup -> LLM (structured) -> merge -> validate JSON -> score normalise.
 */

import type { ModelProfile } from './models.js';
import { PRIMARY_EDITOR } from './models.js';
import { buildSystemPrompt, buildUserPrompt, type ReviewPromptInput } from './prompts.js';
import { contentSha256, buildReviewCacheKey, normaliseDiffForCache } from './cache.js';
import { DEFAULT_QUOTA, estimateBillableTokensRough, shouldEscalate } from './cost-controls.js';

export interface PipelineInput {
  readonly tenantId: string;
  readonly scope: ReviewPromptInput['scope'];
  readonly filePath: string;
  readonly languageId: string;
  readonly laravelVersionHint?: string;
  readonly text: string;
  readonly rulesetVersion: string;
  readonly projectRulesDigest: string;
  readonly deterministicFindingsJson: string;
}

export interface CachePort {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
}

export interface LlmPort {
  completeJson(args: {
    system: string;
    user: string;
    model: ModelProfile;
    schemaName: string;
  }): Promise<string>;
}

/**
 * Pseudocode-style pipeline: wire implementations for Redis, OpenAI responses.parse, etc.
 */
export async function runReviewPipeline(
  input: PipelineInput,
  deps: {
    cache: CachePort;
    llm: LlmPort;
  }
): Promise<{ rawJson: string; cacheHit: boolean }> {
  const text =
    input.scope === 'git-diff' ? normaliseDiffForCache(input.text) : input.text;

  if (text.length > (input.scope === 'git-diff' ? DEFAULT_QUOTA.maxDiffChars : DEFAULT_QUOTA.maxInputChars)) {
    throw new Error('INPUT_TOO_LARGE');
  }

  const digest = input.deterministicFindingsJson || '[]';

  const sha = contentSha256(
    `${input.rulesetVersion}|${digest}|${text}`
  );

  const cacheKey = buildReviewCacheKey({
    tenantId: input.tenantId,
    rulesetVersion: input.rulesetVersion,
    scope: input.scope,
    filePath: input.filePath,
    contentSha256: sha,
  });

  const cached = await deps.cache.get(cacheKey);
  if (cached) {
    return { rawJson: cached, cacheHit: true };
  }

  const userPrompt = buildUserPrompt({
    scope: input.scope,
    filePath: input.filePath,
    languageId: input.languageId,
    laravelVersionHint: input.laravelVersionHint,
    codeOrDiff: text,
    projectRulesDigest: input.projectRulesDigest,
    deterministicFindingsJson: digest,
    maxFindings: DEFAULT_QUOTA.maxFindingsReturned,
  });

  const system = buildSystemPrompt();

  const primary = await deps.llm.completeJson({
    system,
    user: userPrompt,
    model: PRIMARY_EDITOR,
    schemaName: 'MergeCoreReviewOutputV1',
  });

  let merged = primary;

  if (shouldEscalate(parseFindingsSeverities(primary), parseScore(primary))) {
    // Optional second pass: re-run with ESCALATION model only if budget allows — implement gate in API.
    merged = primary;
  }

  await deps.cache.set(cacheKey, merged, 86400);

  return { rawJson: merged, cacheHit: false };
}

function parseScore(json: string): number {
  try {
    const o = JSON.parse(json) as { score?: number };
    return typeof o.score === 'number' ? o.score : 5;
  } catch {
    return 5;
  }
}

function parseFindingsSeverities(json: string): ReadonlyArray<{ severity: string }> {
  try {
    const o = JSON.parse(json) as { findings?: ReadonlyArray<{ severity: string }> };
    return o.findings ?? [];
  } catch {
    return [];
  }
}

export function roughTokenEstimateForBudget(input: PipelineInput): number {
  return estimateBillableTokensRough(input.text.length, PRIMARY_EDITOR.maxOutputTokens);
}
