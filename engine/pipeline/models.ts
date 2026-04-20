/**
 * Model tiers for MergeCore. Tune per environment; keep temperatures at 0 for JSON.
 * Prefer vendors that support JSON Schema / structured output binding.
 *
 * Model names and caps come from environment variables so we never have to
 * ship a new build just to rotate a model. Fallbacks match the values we
 * previously hardcoded so behaviour is unchanged when env vars are unset.
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

function envString(name: string, fallback: string): string {
  const v = process.env[name];
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : fallback;
}

function envInt(name: string, fallback: number): number {
  const v = process.env[name];
  const parsed = v === undefined ? NaN : Number.parseInt(v, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function envProvider(name: string, fallback: ProviderId): ProviderId {
  const v = envString(name, fallback);
  return v === 'openai' || v === 'anthropic' || v === 'google' ? v : fallback;
}

export const PRIMARY_EDITOR: ModelProfile = {
  provider: envProvider('MERGECORE_PRIMARY_PROVIDER', 'openai'),
  model: envString('MERGECORE_PRIMARY_MODEL', 'gpt-4.1-mini'),
  maxOutputTokens: envInt('MERGECORE_PRIMARY_MAX_OUTPUT_TOKENS', 1800),
  temperature: 0,
  useStructuredOutput: true,
  typicalLatencyBudgetMs: envInt('MERGECORE_PRIMARY_LATENCY_MS', 3500),
  relativeCostIndex: 1,
};

export const ESCALATION: ModelProfile = {
  provider: envProvider('MERGECORE_ESCALATION_PROVIDER', 'openai'),
  model: envString('MERGECORE_ESCALATION_MODEL', 'gpt-4.1'),
  maxOutputTokens: envInt('MERGECORE_ESCALATION_MAX_OUTPUT_TOKENS', 2500),
  temperature: 0,
  useStructuredOutput: true,
  typicalLatencyBudgetMs: envInt('MERGECORE_ESCALATION_LATENCY_MS', 9000),
  relativeCostIndex: 6,
};

export const PRIMARY_EDITOR_ANTHROPIC: ModelProfile = {
  provider: 'anthropic',
  model: envString('MERGECORE_PRIMARY_ANTHROPIC_MODEL', 'claude-3-5-haiku-latest'),
  maxOutputTokens: envInt('MERGECORE_PRIMARY_ANTHROPIC_MAX_OUTPUT_TOKENS', 1800),
  temperature: 0,
  useStructuredOutput: true,
  typicalLatencyBudgetMs: envInt('MERGECORE_PRIMARY_ANTHROPIC_LATENCY_MS', 4000),
  relativeCostIndex: 1.1,
};
