import type { ProdRiskRule } from '../types';
import { BAD_QUEUE_RETRY_RULES } from './bad-queue-retries.rules';
import { MEMORY_LEAK_RULES } from './memory-leaks.rules';
import { MISSING_INDEX_RULES } from './missing-indexes.rules';
import { N_PLUS_ONE_RULES } from './n-plus-one.rules';
import { NO_RATE_LIMIT_RULES } from './no-rate-limits.rules';
import { NO_TRANSACTIONS_RULES } from './no-transactions.rules';
import { RACE_CONDITION_RULES } from './race-conditions.rules';
import { RETRY_DUPLICATION_RULES } from './retry-duplication.rules';
import { WEAK_LOGGING_RULES } from './weak-logging.rules';

/**
 * Built-in rule set. Kept small and curated: every rule here must be
 * precise enough to ship on by default without drowning users in false
 * positives. Pack-contributed rules layer on top via the pack loader
 * (see `prod-risks/pack-loader.ts`).
 */
export const BUILTIN_PROD_RISK_RULES: readonly ProdRiskRule[] = Object.freeze([
  ...RACE_CONDITION_RULES,
  ...RETRY_DUPLICATION_RULES,
  ...NO_TRANSACTIONS_RULES,
  ...BAD_QUEUE_RETRY_RULES,
  ...MEMORY_LEAK_RULES,
  ...N_PLUS_ONE_RULES,
  ...MISSING_INDEX_RULES,
  ...NO_RATE_LIMIT_RULES,
  ...WEAK_LOGGING_RULES,
]);
