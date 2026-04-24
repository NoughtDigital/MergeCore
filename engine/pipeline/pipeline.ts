/**
 * MergeCore AI review pipeline orchestration (server-side).
 * Order: validate -> deterministic rules -> cache lookup -> LLM (structured) -> (optional) escalation -> merge -> validate JSON -> score normalise.
 */

import type { ModelProfile } from './models.js';
import { ESCALATION, PRIMARY_EDITOR } from './models.js';
import {
  buildSystemPrompt,
  buildUserPrompt,
  type ProjectConventionDigest,
  type ReviewPromptInput,
} from './prompts.js';
import { contentSha256, buildReviewCacheKey, normaliseDiffForCache } from './cache.js';
import {
  auditCommentStrength,
  stripHedgedOpening,
  type CommentStrengthIssue,
} from './comment-strength.js';
import { DEFAULT_QUOTA, estimateBillableTokensRough, shouldEscalate } from './cost-controls.js';
import { getPersonaById, type ReviewPersonaId } from './personas.js';
import { getReviewLevelById, type ReviewLevelId } from './review-levels.js';

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
  /**
   * Reviewer persona tuning the LLM stage. Namespaced into the cache hash so
   * two personas never share a cached response for the same code.
   */
  readonly reviewerPersonaId?: ReviewPersonaId;
  /**
   * Review level (quick/file/flow/pr/disaster). Namespaced into the cache
   * hash so a Quick Review never reuses a Disaster Review payload.
   */
  readonly reviewLevelId?: ReviewLevelId;
  /**
   * Detected project conventions (contextual memory). Passed to the prompt
   * so the LLM can critique divergences from the repo's declared standards.
   * Also folded into the cache key so a convention change busts the cache
   * for any reviewed input.
   */
  readonly conventions?: readonly ProjectConventionDigest[];
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
  /**
   * Per-finding comment-strength issues detected AFTER any in-place tone
   * rewrite. Empty when every finding was already direct. Host UIs can use
   * this to highlight weak findings in debug builds or to suppress them
   * behind a setting. Not persisted in the cache — regenerated on every run.
   */
  readonly commentStrength?: ReadonlyArray<{
    readonly findingIndex: number;
    readonly findingId: string | undefined;
    readonly issues: readonly CommentStrengthIssue[];
  }>;
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
  const persona = getPersonaById(input.reviewerPersonaId);
  const level = getReviewLevelById(input.reviewLevelId);

  const conventionsDigest = digestConventions(input.conventions);

  const sha = contentSha256(
    `${input.rulesetVersion}|${persona.id}|${level.id}|${digest}|${relatedContextDigest}|${conventionsDigest}|${text}`
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
    return { rawJson: cached, cacheHit: true, escalated: false };
  }

  // The level's maxFindingsHint narrows or widens the LLM's budget, but the
  // global quota still clamps the absolute maximum so no level can exceed it.
  const maxFindings = Math.min(level.maxFindingsHint, DEFAULT_QUOTA.maxFindingsReturned);

  const userPrompt = buildUserPrompt({
    scope: input.scope,
    filePath: input.filePath,
    languageId: input.languageId,
    codeOrDiff: text,
    relatedContextDigest,
    projectRulesDigest: input.projectRulesDigest,
    deterministicFindingsJson: digest,
    maxFindings,
    reviewerPersonaId: persona.id,
    reviewLevelId: level.id,
    conventions: input.conventions,
  });

  const system = buildSystemPrompt(persona.id, level.id);

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

  // Comment-strength pass: strip hedged openings in place (safe, tone-only)
  // and collect a report of residual weaknesses. Runs on BOTH primary and
  // escalation output because new packs inherit the same rules and we want
  // one chokepoint. Cache stores the post-rewrite JSON so strong wording
  // is preserved on future cache hits.
  const { json: strongJson, report } = enforceCommentStrength(merged);
  merged = strongJson;

  await deps.cache.set(cacheKey, merged, 86400);

  return {
    rawJson: merged,
    cacheHit: false,
    escalated,
    commentStrength: report.length > 0 ? report : undefined,
  };
}

interface StrengthReportEntry {
  readonly findingIndex: number;
  readonly findingId: string | undefined;
  readonly issues: readonly CommentStrengthIssue[];
}

/**
 * Rewrites weak openings (e.g. "Consider …") on every finding's message /
 * whyItMatters / fixHint and returns a report of residual issues that cannot
 * be fixed mechanically (empty verdicts, too-short messages). Never touches
 * non-comment fields. If the JSON is malformed we fall through untouched —
 * the existing response guard in the host is responsible for shape errors.
 */
function enforceCommentStrength(
  json: string
): { json: string; report: readonly StrengthReportEntry[] } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { json, report: [] };
  }
  if (!isRecord(parsed)) {
    return { json, report: [] };
  }

  const findingsRaw = parsed.findings;
  if (!Array.isArray(findingsRaw)) {
    return { json, report: [] };
  }

  const report: StrengthReportEntry[] = [];
  let mutated = false;

  findingsRaw.forEach((finding, index) => {
    if (!isRecord(finding)) {
      return;
    }
    for (const field of ['message', 'whyItMatters', 'fixHint'] as const) {
      const current = finding[field];
      if (typeof current === 'string' && current.length > 0) {
        const rewritten = stripHedgedOpening(current);
        if (rewritten !== current) {
          finding[field] = rewritten;
          mutated = true;
        }
      }
    }
    const audit = auditCommentStrength({
      message: typeof finding.message === 'string' ? finding.message : undefined,
      whyItMatters: typeof finding.whyItMatters === 'string' ? finding.whyItMatters : undefined,
      fixHint: typeof finding.fixHint === 'string' ? finding.fixHint : undefined,
    });
    if (!audit.ok) {
      report.push({
        findingIndex: index,
        findingId: typeof finding.id === 'string' ? finding.id : undefined,
        issues: audit.issues,
      });
    }
  });

  return {
    json: mutated ? JSON.stringify(parsed) : json,
    report,
  };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
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

/**
 * Folds the conventions list into a compact, order-stable string so cache
 * keys change exactly when the remembered context changes. We deliberately
 * ignore evidence here — evidence is diagnostic only; changing the count
 * of "action files" shouldn't invalidate a cached review if the convention
 * itself (id, label, confidence) is unchanged.
 */
function digestConventions(
  conventions: readonly ProjectConventionDigest[] | undefined
): string {
  if (!conventions || conventions.length === 0) {
    return 'conv:none';
  }
  const sorted = [...conventions].sort((a, b) => a.id.localeCompare(b.id));
  return sorted.map((c) => `${c.id}@${c.confidence}`).join(',');
}
