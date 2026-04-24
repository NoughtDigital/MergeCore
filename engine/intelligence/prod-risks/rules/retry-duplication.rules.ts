import type { ProdRiskRule } from '../types';

/**
 * Retry duplication: client or middleware layer retries a non-idempotent
 * operation, so every transient failure causes a double-charge, double-
 * send, or double-write. The cheap fix is always an idempotency key.
 */
export const RETRY_DUPLICATION_RULES: readonly ProdRiskRule[] = [
  {
    id: 'ts:retry:axios-no-idempotency',
    ruleVersion: '1',
    category: 'retry-duplication',
    severity: 'warning',
    title: 'Retry wrapper around a POST without idempotency key',
    description:
      'Retrying a POST will re-execute the side effect on every attempt. Without an idempotency key the receiver has no way to deduplicate, which is how double-charges and duplicate webhook deliveries ship to production.',
    fixHint:
      'Attach an `Idempotency-Key` header (UUID per logical operation) and make the server-side handler deduplicate on it.',
    origin: 'builtin',
    languages: ['typescript', 'javascript', 'tsx', 'jsx'],
    patterns: [
      String.raw`(?:axios-retry|retry|p-retry|async-retry)[\s\S]{0,400}?\baxios\.(?:post|put|patch)\s*\(`,
      String.raw`\bfetch\s*\([^)]*,\s*\{\s*method\s*:\s*['"]POST['"][\s\S]{0,300}?\}\s*\)[\s\S]{0,200}?\.catch\s*\([\s\S]{0,200}?\bretry\b`,
    ],
    negativePatterns: [
      String.raw`['"](?:Idempotency-Key|idempotency_key)['"]`,
    ],
    patternFlags: 's',
    tags: ['http', 'idempotency'],
  },
  {
    id: 'ts:retry:stripe-no-idempotency',
    ruleVersion: '1',
    category: 'retry-duplication',
    severity: 'error',
    title: 'Stripe charge/create without idempotency key',
    description:
      'Stripe SDK calls that mutate state must carry an `idempotencyKey`. Without one, any retry — from the SDK, your code, or the platform — double-charges the customer.',
    fixHint:
      'Pass `{ idempotencyKey: <stable-uuid-for-this-action> }` as the second argument to the Stripe call.',
    origin: 'builtin',
    languages: ['typescript', 'javascript', 'tsx', 'jsx'],
    patterns: [
      String.raw`stripe\.(?:charges|paymentIntents|checkout\.sessions|subscriptions|invoices)\.(?:create|update|capture)\s*\(`,
    ],
    negativePatterns: [
      String.raw`idempotencyKey\s*:`,
      String.raw`['"]Idempotency-Key['"]`,
    ],
    tags: ['payments', 'stripe', 'idempotency'],
  },
  {
    id: 'py:retry:requests-retry-post',
    ruleVersion: '1',
    category: 'retry-duplication',
    severity: 'warning',
    title: 'urllib3/requests Retry allows POST without idempotency',
    description:
      '`Retry(method_whitelist=...)` or `allowed_methods=` including POST without an idempotency key re-runs side effects on every failure.',
    fixHint:
      'Either exclude POST from the retry whitelist or add an `Idempotency-Key` header generated per logical request.',
    origin: 'builtin',
    languages: ['python'],
    patterns: [
      String.raw`Retry\s*\([\s\S]{0,300}?(?:method_whitelist|allowed_methods)\s*=\s*\[[^\]]*['"]POST['"]`,
    ],
    negativePatterns: [
      String.raw`['"]Idempotency-Key['"]`,
    ],
    patternFlags: 's',
    tags: ['http', 'idempotency'],
  },
  {
    id: 'php:retry:http-retry-unsafe',
    ruleVersion: '1',
    category: 'retry-duplication',
    severity: 'warning',
    title: 'Laravel HTTP client retries a POST without idempotency',
    description:
      '`Http::retry($n)->post(...)` will re-send the payload on every failure; the receiver has no way to deduplicate.',
    fixHint:
      'Chain `->withHeaders(["Idempotency-Key" => Str::uuid()])` and make the endpoint deduplicate by that header.',
    origin: 'builtin',
    languages: ['php'],
    patterns: [
      String.raw`Http::retry\s*\([^)]*\)(?:\s*->[^;]+)*->(?:post|put|patch)\s*\(`,
    ],
    negativePatterns: [
      String.raw`['"]Idempotency-Key['"]`,
    ],
    requiredSignals: ['path:artisan'],
    tags: ['laravel', 'http', 'idempotency'],
  },
  {
    id: 'any:retry:webhook-no-dedupe-table',
    ruleVersion: '1',
    category: 'retry-duplication',
    severity: 'warning',
    title: 'Webhook handler has no deduplication guard',
    description:
      'Stripe, GitHub, Shopify and most webhook senders retry aggressively on any non-2xx. A handler that does not dedupe on `event.id` (or equivalent) will apply the same effect multiple times.',
    fixHint:
      'Record processed event ids in a unique-indexed table or cache and bail early when a repeat is seen, then return 2xx fast.',
    origin: 'builtin',
    languages: ['typescript', 'javascript', 'tsx', 'jsx', 'php', 'python', 'go'],
    filePathIncludes: ['webhook', 'webhooks'],
    patterns: [
      String.raw`\b(?:handle|process|onEvent|webhook)\s*\(`,
    ],
    negativePatterns: [
      String.raw`(?:event|payload)\.id`,
      String.raw`processed_events`,
      String.raw`idempotency`,
    ],
    tags: ['webhook', 'idempotency'],
  },
];
