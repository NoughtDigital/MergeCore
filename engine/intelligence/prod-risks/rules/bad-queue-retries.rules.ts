import type { ProdRiskRule } from '../types';

/**
 * Bad queue retries: jobs configured to retry forever, retry on all
 * exceptions indiscriminately, or drop jobs silently on failure —
 * the three patterns behind most "mysterious missing data" incidents.
 */
export const BAD_QUEUE_RETRY_RULES: readonly ProdRiskRule[] = [
  {
    id: 'php:queue:infinite-retry',
    ruleVersion: '1',
    category: 'bad-queue-retries',
    severity: 'warning',
    title: 'Laravel queue job with unlimited retries',
    description:
      '`public $tries = 0;` or missing `$tries`/`$backoff` on a non-trivial job means a poison message retries forever, saturating the queue and masking bugs.',
    fixHint:
      'Set `public int $tries = 3;` (or similar), define `public function backoff(): array` with exponential values, and implement `failed(Throwable $e)` to push to a DLQ.',
    origin: 'builtin',
    languages: ['php'],
    patterns: [
      String.raw`class\s+\w+\s+implements\s+ShouldQueue`,
    ],
    negativePatterns: [
      String.raw`public\s+\$tries\s*=\s*\d+`,
      String.raw`public\s+int\s+\$tries`,
      String.raw`public\s+function\s+backoff\s*\(`,
    ],
    requiredSignals: ['path:artisan'],
    tags: ['laravel', 'queue'],
  },
  {
    id: 'php:queue:no-failed-handler',
    ruleVersion: '1',
    category: 'bad-queue-retries',
    severity: 'warning',
    title: 'ShouldQueue job without a failed() handler',
    description:
      'Without `failed(Throwable $e)`, the job disappears into the `failed_jobs` table silently — no alert, no compensating action.',
    fixHint:
      'Add `public function failed(Throwable $e): void` that notifies on-call and/or enqueues a compensating action.',
    origin: 'builtin',
    languages: ['php'],
    patterns: [
      String.raw`class\s+\w+\s+implements\s+ShouldQueue[\s\S]{0,5000}`,
    ],
    negativePatterns: [
      String.raw`public\s+function\s+failed\s*\(`,
    ],
    patternFlags: 's',
    requiredSignals: ['path:artisan'],
    tags: ['laravel', 'queue', 'observability'],
  },
  {
    id: 'ts:queue:bullmq-retry-all',
    ruleVersion: '1',
    category: 'bad-queue-retries',
    severity: 'warning',
    title: 'BullMQ worker retries every exception without classification',
    description:
      'A worker that throws on every error with default retry settings will retry bug-induced failures as aggressively as transient ones, amplifying outages.',
    fixHint:
      'Classify errors: throw `UnrecoverableError` from bullmq for bugs, return cleanly on idempotent no-ops, and let only transient errors surface to the retry strategy.',
    origin: 'builtin',
    languages: ['typescript', 'javascript'],
    patterns: [
      String.raw`new\s+Worker\s*\(`,
    ],
    negativePatterns: [
      String.raw`UnrecoverableError`,
      String.raw`attemptsMade`,
      String.raw`moveToFailed`,
    ],
    tags: ['bullmq', 'queue'],
  },
  {
    id: 'ts:queue:sqs-no-dlq',
    ruleVersion: '1',
    category: 'bad-queue-retries',
    severity: 'warning',
    title: 'SQS consumer swallows errors without a DLQ strategy',
    description:
      'Catching an error in an SQS handler and returning without deleting the message leaves it to re-appear indefinitely until the message hits the retention wall.',
    fixHint:
      'Configure a dead-letter queue with a sensible `maxReceiveCount` and rethrow on non-retriable errors so the infrastructure handles classification.',
    origin: 'builtin',
    languages: ['typescript', 'javascript'],
    patterns: [
      String.raw`ReceiveMessageCommand|sqs\.receiveMessage\s*\(`,
    ],
    negativePatterns: [
      String.raw`DeadLetterQueue|redrivePolicy|maxReceiveCount`,
    ],
    tags: ['aws', 'sqs', 'queue'],
  },
  {
    id: 'py:queue:celery-no-max-retries',
    ruleVersion: '1',
    category: 'bad-queue-retries',
    severity: 'warning',
    title: 'Celery task with retry() but no max_retries',
    description:
      'Calling `self.retry()` inside an except without a bounded `max_retries` or `autoretry_for` classification means a poison task retries until the broker collapses.',
    fixHint:
      'Declare `@app.task(bind=True, max_retries=5, autoretry_for=(TransientError,), retry_backoff=True)` and let non-transient exceptions fail fast.',
    origin: 'builtin',
    languages: ['python'],
    patterns: [
      String.raw`self\.retry\s*\(`,
    ],
    negativePatterns: [
      String.raw`max_retries\s*=`,
      String.raw`autoretry_for\s*=`,
    ],
    tags: ['celery', 'queue'],
  },
  {
    id: 'any:queue:fire-and-forget',
    ruleVersion: '1',
    category: 'bad-queue-retries',
    severity: 'info',
    title: 'Dispatch without awaiting or handling rejection',
    description:
      '`dispatch(...)` / `enqueue(...)` called without awaiting or catching means the enqueue itself can fail silently, so the job never runs and there is no alert.',
    fixHint:
      'Await the dispatch; on failure log and raise so the outer request also fails visibly.',
    origin: 'builtin',
    languages: ['typescript', 'javascript'],
    patterns: [
      String.raw`^\s*(?:dispatch|enqueue|queue\.add)\s*\(`,
    ],
    negativePatterns: [
      String.raw`await\s+(?:dispatch|enqueue|queue\.add)\s*\(`,
      String.raw`\.catch\s*\(`,
    ],
    tags: ['queue', 'observability'],
  },
];
