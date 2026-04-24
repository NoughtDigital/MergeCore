/**
 * MergeCore AI review pipeline orchestration (server-side).
 * Order: validate -> deterministic rules -> cache lookup -> LLM (structured) -> (optional) escalation -> merge -> validate JSON -> score normalise.
 */

import type { ModelProfile } from './models.js';
import { ESCALATION, PRIMARY_EDITOR } from './models.js';
import { buildSystemPrompt, buildUserPrompt, type ReviewPromptInput } from './prompts.js';
import { contentSha256, buildReviewCacheKey, normaliseDiffForCache } from './cache.js';
import { DEFAULT_QUOTA, estimateBillableTokensRough, shouldEscalate } from './cost-controls.js';

export interface PipelineInput {
  readonly tenantId: string;
  readonly scope: ReviewPromptInput['scope'];
  readonly filePath: string;
  readonly languageId: string;
  readonly text: string;
  readonly relatedContextDigest?: string;
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

export interface BudgetPort {
  /**
   * Called before an escalation call so the API layer can veto based on daily
   * spend, per-tenant caps, or provider health. Returning false skips the
   * escalation call silently.
   */
  allowEscalation(input: PipelineInput): Promise<boolean>;
}

export interface PipelineResult {
  readonly rawJson: string;
  readonly cacheHit: boolean;
  readonly escalated: boolean;
}

/**
 * Concrete pipeline: callers provide cache + llm + budget implementations.
 */
export async function runReviewPipeline(
  input: PipelineInput,
  deps: {
    cache: CachePort;
    llm: LlmPort;
    budget?: BudgetPort;
  }
): Promise<PipelineResult> {
  const text =
    input.scope === 'git-diff' ? normaliseDiffForCache(input.text) : input.text;

  if (text.length > (input.scope === 'git-diff' ? DEFAULT_QUOTA.maxDiffChars : DEFAULT_QUOTA.maxInputChars)) {
    throw new Error('INPUT_TOO_LARGE');
  }

  const digest = input.deterministicFindingsJson || '[]';
  const relatedContextDigest = input.relatedContextDigest ?? '';

  const sha = contentSha256(`${input.rulesetVersion}|${digest}|${relatedContextDigest}|${text}`);

  const cacheKey = buildReviewCacheKey({
    tenantId: input.tenantId,
    rulesetVersion: input.rulesetVersion,
    scope: input.scope,
    filePath: input.filePath,
    contentSha256: sha,
  });

  const cached = await deps.cache.get(cacheKey);
  if (cached) {
    return { rawJson: cached, cacheHit: true, escalated: false };
  }

  const userPrompt = buildUserPrompt({
    scope: input.scope,
    filePath: input.filePath,
    languageId: input.languageId,
    codeOrDiff: text,
    relatedContextDigest,
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
  let escalated = false;

  if (shouldEscalate(parseFindingsSeverities(primary), parseScore(primary))) {
    const allow = deps.budget ? await deps.budget.allowEscalation(input) : false;
    if (allow) {
      try {
        merged = await deps.llm.completeJson({
          system,
          user: userPrompt,
          model: ESCALATION,
          schemaName: 'MergeCoreReviewOutputV1',
        });
        escalated = true;
      } catch {
        // Escalation is best-effort; fall back to the primary output.
        merged = primary;
      }
    }
  }

  await deps.cache.set(cacheKey, merged, 86400);

  return { rawJson: merged, cacheHit: false, escalated };
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
  return estimateBillableTokensRough(
    input.text.length + (input.relatedContextDigest?.length ?? 0),
    PRIMARY_EDITOR.maxOutputTokens
  );
}
