import type { ProdRiskRule } from '../types';

/**
 * Missing indexes: a new column that will be used in a WHERE or JOIN
 * predicate but is shipped without an index, or a migration that adds
 * a foreign key without the corresponding index.
 *
 * We focus on migration files rather than query files because adding an
 * index post-hoc on a large table is painful. Catching it at migration
 * authoring time is the cheap move.
 */
export const MISSING_INDEX_RULES: readonly ProdRiskRule[] = [
  {
    id: 'php:index:laravel-foreign-no-index',
    ruleVersion: '1',
    category: 'missing-indexes',
    severity: 'warning',
    title: 'Laravel migration adds foreign key without index',
    description:
      'An FK column used in JOINs without an index forces full-table scans as soon as the child table grows. Production schemas discover this under load, not in dev.',
    fixHint:
      'Call `$table->foreignId("x_id")->constrained()->index();` or add `$table->index("x_id")` explicitly.',
    origin: 'builtin',
    languages: ['php'],
    filePathIncludes: ['database/migrations/', '/migrations/'],
    patterns: [
      String.raw`\$table->(?:unsignedBigInteger|bigInteger|integer|foreignId)\s*\(\s*['"](\w+_id)['"][^;]*;`,
    ],
    negativePatterns: [
      String.raw`->index\s*\(`,
      String.raw`->unique\s*\(`,
      String.raw`->primary\s*\(`,
      String.raw`->constrained\s*\(`,
    ],
    requiredSignals: ['path:artisan'],
    tags: ['laravel', 'migrations', 'sql'],
  },
  {
    id: 'sql:index:create-table-fk-no-index',
    ruleVersion: '1',
    category: 'missing-indexes',
    severity: 'warning',
    title: 'CREATE TABLE declares a FOREIGN KEY with no accompanying index',
    description:
      'Most engines (notably Postgres) do not auto-index the referencing column. Deletes on the parent table will degrade catastrophically.',
    fixHint:
      'Add `CREATE INDEX` on the referencing column, or declare `UNIQUE` when appropriate.',
    origin: 'builtin',
    languages: ['sql'],
    patterns: [
      String.raw`CREATE\s+TABLE[\s\S]{0,2000}?FOREIGN\s+KEY\s*\(\s*(\w+)\s*\)`,
    ],
    negativePatterns: [
      String.raw`CREATE\s+(?:UNIQUE\s+)?INDEX\b`,
    ],
    patternFlags: 'si',
    tags: ['sql', 'postgres', 'schema'],
  },
  {
    id: 'py:index:django-fk-no-db-index',
    ruleVersion: '1',
    category: 'missing-indexes',
    severity: 'hint',
    title: 'Django ForeignKey without db_index=True (non-primary relation)',
    description:
      'Django auto-indexes the FK in most cases, but custom `to_field` or `db_column` relations bypass that. Worth making the index explicit on hot tables.',
    fixHint:
      'Add `db_index=True` to the ForeignKey when you rely on the relation being queryable, or add a `class Meta: indexes = [...]` block.',
    origin: 'builtin',
    languages: ['python'],
    filePathIncludes: ['models.py', '/models/', 'migrations/'],
    patterns: [
      String.raw`models\.ForeignKey\s*\([\s\S]{0,200}?(?:to_field|db_column)\s*=`,
    ],
    negativePatterns: [
      String.raw`db_index\s*=\s*True`,
      String.raw`indexes\s*=`,
    ],
    patternFlags: 's',
    tags: ['django', 'orm', 'schema'],
  },
  {
    id: 'ts:index:prisma-relation-no-index',
    ruleVersion: '1',
    category: 'missing-indexes',
    severity: 'warning',
    title: 'Prisma model with @relation but no @@index on the FK scalar',
    description:
      'Prisma does not create indexes on FK scalar fields automatically. Queries filtering by `userId`, `tenantId`, etc. go full-scan.',
    fixHint:
      'Add `@@index([userId])` (or the appropriate scalar) inside the model block, or make the field `@unique` when 1:1.',
    origin: 'builtin',
    languages: ['*'],
    filePathIncludes: ['schema.prisma'],
    patterns: [
      String.raw`@relation\s*\([\s\S]{0,200}?fields\s*:\s*\[(\w+)\]`,
    ],
    negativePatterns: [
      String.raw`@@index\s*\(`,
      String.raw`@unique\b`,
    ],
    patternFlags: 's',
    tags: ['prisma', 'schema'],
  },
];
