/**
 * Model tiers for MergeCore. Tune per environment; keep temperatures at 0 for JSON.
 * Prefer vendors that support JSON Schema / structured output binding.
 */

export type ProviderId = 'openai' | 'anthropic' | 'google';

export interface ModelProfile {
  readonly provider: ProviderId;
  readonly model: string;
  readonly maxOutputTokens: number;
  readonly temperature: 0;
  readonly useStructuredOutput: true;
  readonly typicalLatencyBudgetMs: number;
  readonly relativeCostIndex: number;
}

/** Default path: fast, cheap, schema-bound. */
export const PRIMARY_EDITOR: ModelProfile = {
  provider: 'openai',
  model: 'gpt-4.1-mini',
  maxOutputTokens: 1800,
  temperature: 0,
  useStructuredOutput: true,
  typicalLatencyBudgetMs: 3500,
  relativeCostIndex: 1,
};

/** Optional second pass only when PRIMARY flags security/critical or score swing > threshold. */
export const ESCALATION: ModelProfile = {
  provider: 'openai',
  model: 'gpt-4.1',
  maxOutputTokens: 2500,
  temperature: 0,
  useStructuredOutput: true,
  typicalLatencyBudgetMs: 9000,
  relativeCostIndex: 6,
};

/** Anthropic alternative if OpenAI unavailable; use tool-use JSON or constrained generation. */
export const PRIMARY_EDITOR_ANTHROPIC: ModelProfile = {
  provider: 'anthropic',
  model: 'claude-3-5-haiku-latest',
  maxOutputTokens: 1800,
  temperature: 0,
  useStructuredOutput: true,
  typicalLatencyBudgetMs: 4000,
  relativeCostIndex: 1.1,
};
