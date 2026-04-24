import type { ProdRiskRule } from '../types';

/**
 * Missing transactions: a sequence of writes that must succeed or fail
 * as a unit is being issued without a transaction, so a failure partway
 * through leaves the database in a half-applied state that is almost
 * impossible to clean up automatically.
 */
export const NO_TRANSACTIONS_RULES: readonly ProdRiskRule[] = [
  {
    id: 'php:tx:multi-write-no-transaction',
    ruleVersion: '1',
    category: 'no-transactions',
    severity: 'error',
    title: 'Multiple Eloquent writes in one method without DB::transaction',
    description:
      'Two or more create/update/delete calls that depend on each other are running outside a transaction. Any failure between them leaves the database half-written.',
    fixHint:
      'Wrap the sequence in `DB::transaction(function () { … });` and rethrow to force a rollback.',
    origin: 'builtin',
    languages: ['php'],
    patterns: [
      String.raw`(?:[A-Z]\w+::(?:create|update|delete|insert)\s*\([\s\S]{0,400}?){2,}`,
    ],
    negativePatterns: [
      String.raw`DB::transaction\s*\(`,
      String.raw`DB::beginTransaction\s*\(`,
      String.raw`->getConnection\(\)->transaction\s*\(`,
    ],
    patternFlags: 's',
    requiredSignals: ['path:artisan'],
    tags: ['laravel', 'eloquent'],
  },
  {
    id: 'ts:tx:prisma-sequence',
    ruleVersion: '1',
    category: 'no-transactions',
    severity: 'warning',
    title: 'Sequential Prisma writes without prisma.$transaction',
    description:
      'Back-to-back `await prisma.x.create(...)` / `update(...)` calls are not atomic. A crash or timeout between them corrupts related records.',
    fixHint:
      'Group dependent writes in `prisma.$transaction([...])` or `$transaction(async (tx) => { ... })`.',
    origin: 'builtin',
    languages: ['typescript', 'javascript', 'tsx', 'jsx'],
    patterns: [
      String.raw`(?:await\s+(?:prisma|db|tx)\.[\w.]+\.(?:create|update|delete|upsert)\s*\([\s\S]{0,200}?\)\s*;?\s*){2,}`,
    ],
    negativePatterns: [
      String.raw`\$transaction\s*\(`,
      String.raw`\.transaction\s*\(`,
    ],
    patternFlags: 's',
    tags: ['prisma', 'orm'],
  },
  {
    id: 'ts:tx:typeorm-sequence',
    ruleVersion: '1',
    category: 'no-transactions',
    severity: 'warning',
    title: 'Repeated TypeORM save() calls without a transaction',
    description:
      'Two or more repository.save / remove calls in one service method without a `manager.transaction(...)` or `@Transaction()` boundary.',
    fixHint:
      'Use `dataSource.transaction(async manager => { ... })` or the `@Transaction()` decorator on the service method.',
    origin: 'builtin',
    languages: ['typescript', 'javascript'],
    patterns: [
      String.raw`(?:await\s+[\w.]+Repository\.(?:save|remove|insert|update)\s*\([\s\S]{0,200}?\)\s*;?\s*){2,}`,
    ],
    negativePatterns: [
      String.raw`\.transaction\s*\(`,
      String.raw`@Transaction\s*\(`,
    ],
    patternFlags: 's',
    tags: ['typeorm', 'orm'],
  },
  {
    id: 'py:tx:django-no-atomic',
    ruleVersion: '1',
    category: 'no-transactions',
    severity: 'warning',
    title: 'Django model writes without transaction.atomic',
    description:
      'Multiple `.save()` / `.create()` / `.delete()` in one view without `transaction.atomic()` leave related records inconsistent if any step fails.',
    fixHint:
      'Wrap the block in `with transaction.atomic():` or decorate the view with `@transaction.atomic`.',
    origin: 'builtin',
    languages: ['python'],
    patterns: [
      String.raw`(?:\b\w+\.(?:save|delete)\s*\(\s*\)\s*[\s\S]{0,200}?){2,}`,
      String.raw`(?:\b\w+\.objects\.(?:create|update|delete)\s*\([\s\S]{0,200}?\)\s*[\s\S]{0,200}?){2,}`,
    ],
    negativePatterns: [
      String.raw`transaction\.atomic\b`,
      String.raw`@atomic\b`,
    ],
    patternFlags: 's',
    tags: ['django', 'orm'],
  },
  {
    id: 'go:tx:database-sql-multi-exec',
    ruleVersion: '1',
    category: 'no-transactions',
    severity: 'warning',
    title: 'Multiple db.Exec calls without BeginTx',
    description:
      'Repeated `db.Exec(...)` calls in a handler without opening a transaction means partial failures are silently durable.',
    fixHint:
      'Open `tx, err := db.BeginTx(ctx, nil)` and commit/rollback; run all writes via `tx.Exec`.',
    origin: 'builtin',
    languages: ['go'],
    patterns: [
      String.raw`(?:\b(?:db|conn)\.(?:Exec|ExecContext)\s*\([\s\S]{0,200}?\)\s*;?\s*){2,}`,
    ],
    negativePatterns: [
      String.raw`\.BeginTx\s*\(`,
      String.raw`\.Begin\s*\(`,
    ],
    patternFlags: 's',
    tags: ['database/sql'],
  },
];
