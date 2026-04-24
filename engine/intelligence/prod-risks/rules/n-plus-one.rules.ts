import type { ProdRiskRule } from '../types';

/**
 * N+1 queries: iterating a collection and issuing one query per element
 * instead of eager-loading or batching. Number one cause of slow
 * endpoints that look fast in dev and die under real traffic.
 */
export const N_PLUS_ONE_RULES: readonly ProdRiskRule[] = [
  {
    id: 'php:nplus1:foreach-relation',
    ruleVersion: '1',
    category: 'n-plus-one',
    severity: 'warning',
    title: 'Foreach accessing a relation without eager loading',
    description:
      'Iterating a collection and reading `$item->relation` triggers one query per item. In production with thousands of rows this dominates latency.',
    fixHint:
      'Eager-load upfront: `Model::with(["relation"])->get()` or `$collection->load("relation")` before the loop.',
    origin: 'builtin',
    languages: ['php'],
    patterns: [
      String.raw`foreach\s*\(\s*\$\w+\s+as\s+\$\w+\s*\)\s*\{[\s\S]{0,300}?\$\w+->\w+->\w+`,
    ],
    negativePatterns: [
      String.raw`->with\s*\(`,
      String.raw`->load\s*\(`,
    ],
    patternFlags: 's',
    requiredSignals: ['path:artisan'],
    tags: ['laravel', 'eloquent', 'performance'],
  },
  {
    id: 'ts:nplus1:map-await-find',
    ruleVersion: '1',
    category: 'n-plus-one',
    severity: 'warning',
    title: 'Sequential awaited fetch inside map/forEach',
    description:
      '`items.map(async x => await db.find(x.id))` or a for-await loop issuing one query per item is the canonical N+1. It grows linearly with dataset size.',
    fixHint:
      'Batch the ids and issue one query: `db.findMany({ where: { id: { in: ids } } })`, or use a DataLoader at the boundary.',
    origin: 'builtin',
    languages: ['typescript', 'javascript', 'tsx', 'jsx'],
    patterns: [
      String.raw`\.map\s*\(\s*async\s*[\w(), ]+=>[\s\S]{0,200}?await\s+\w+\.(?:find|findOne|findUnique|get|fetch)\s*\(`,
      String.raw`for\s*\(\s*const\s+\w+\s+of\s+[^)]+\)\s*\{[\s\S]{0,300}?await\s+\w+\.(?:find|findOne|findUnique|get|fetch)\s*\(`,
    ],
    negativePatterns: [
      String.raw`findMany\s*\(`,
      String.raw`DataLoader\b`,
      String.raw`Promise\.all\s*\(`,
    ],
    patternFlags: 's',
    tags: ['orm', 'performance'],
  },
  {
    id: 'py:nplus1:django-for-loop-attr',
    ruleVersion: '1',
    category: 'n-plus-one',
    severity: 'warning',
    title: 'Django for-loop accesses related object without select_related',
    description:
      'Iterating a QuerySet and reading `item.related.field` triggers a query per row. `select_related` / `prefetch_related` collapses it to one or two queries.',
    fixHint:
      'Add `.select_related("related")` (ForeignKey/OneToOne) or `.prefetch_related("related")` (ManyToMany / reverse FK) to the queryset.',
    origin: 'builtin',
    languages: ['python'],
    patterns: [
      String.raw`for\s+\w+\s+in\s+[\w.]+\.objects[\s\S]{0,60}:\s*\n(?:\s+[^\n]*\n){1,8}?\s+\w+\.\w+\.\w+`,
    ],
    negativePatterns: [
      String.raw`select_related\s*\(`,
      String.raw`prefetch_related\s*\(`,
    ],
    patternFlags: 's',
    tags: ['django', 'orm', 'performance'],
  },
  {
    id: 'ts:nplus1:graphql-resolver-no-loader',
    ruleVersion: '1',
    category: 'n-plus-one',
    severity: 'warning',
    title: 'GraphQL field resolver fetches per-parent without a DataLoader',
    description:
      'A nested field resolver that calls the ORM directly will be invoked once per parent record — exactly the N+1 shape DataLoader exists to solve.',
    fixHint:
      'Wrap the fetch in a DataLoader created per request and dispatch `loader.load(parent.id)` from the resolver.',
    origin: 'builtin',
    languages: ['typescript', 'javascript'],
    filePathIncludes: ['resolver', 'graphql'],
    patterns: [
      String.raw`(?:resolve|\w+)\s*:\s*async\s*\([^)]*parent[^)]*\)\s*=>\s*\{[\s\S]{0,200}?await\s+\w+\.(?:find|findOne|findMany|get)\s*\(`,
    ],
    negativePatterns: [
      String.raw`DataLoader\b`,
      String.raw`dataloader`,
    ],
    patternFlags: 's',
    tags: ['graphql', 'performance'],
  },
];
