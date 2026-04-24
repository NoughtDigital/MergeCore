import type { ProdRiskRule } from '../types';

/**
 * Race conditions: concurrent access to shared mutable state, non-atomic
 * read-modify-write, missing locks around critical sections, and the
 * classic "check then act" sequence on a store that doesn't guarantee it.
 *
 * These patterns are tuned to be conservative — each one has a clear
 * fix, so false positives cost the reviewer seconds, not trust.
 */
export const RACE_CONDITION_RULES: readonly ProdRiskRule[] = [
  {
    id: 'ts:race:check-then-act',
    ruleVersion: '1',
    category: 'race-conditions',
    severity: 'warning',
    title: 'Check-then-act pattern without a lock',
    description:
      'Reading a value, branching on it, and then writing it back across an await boundary is not atomic. Another task can change the value in between, producing double-writes or lost updates.',
    fixHint:
      'Move to a single atomic operation (compare-and-swap, unique index + upsert, or a mutex around the critical section).',
    origin: 'builtin',
    languages: ['typescript', 'javascript', 'tsx', 'jsx'],
    patterns: [
      String.raw`if\s*\(\s*!\s*await\s+[\w.$]+\.(?:find|findOne|get|exists)\s*\([^)]*\)\s*\)\s*\{[\s\S]{0,400}?await\s+[\w.$]+\.(?:create|insert|save|set)\s*\(`,
    ],
    patternFlags: 's',
    tags: ['concurrency', 'async'],
  },
  {
    id: 'ts:race:shared-counter',
    ruleVersion: '1',
    category: 'race-conditions',
    severity: 'warning',
    title: 'Module-level counter mutated inside async handler',
    description:
      'A module-scoped `let` incremented inside an async/request handler is shared across concurrent invocations. In a serverless or Node server this reliably corrupts under load.',
    fixHint:
      'Persist counters in a database atomic op (INCR, UPDATE … SET x = x + 1) or a dedicated metric backend.',
    origin: 'builtin',
    languages: ['typescript', 'javascript', 'tsx', 'jsx'],
    patterns: [
      String.raw`^\s*let\s+\w+\s*=\s*0\s*;[\s\S]{0,2000}?\b(?:async\s+function|=>\s*\{)[\s\S]{0,2000}?\w+\s*\+\+`,
    ],
    patternFlags: 's',
    tags: ['concurrency', 'state'],
  },
  {
    id: 'py:race:threaded-shared-state',
    ruleVersion: '1',
    category: 'race-conditions',
    severity: 'warning',
    title: 'Threaded access to shared state without a lock',
    description:
      'Spawning threads while mutating shared collections (lists, dicts, counters) without `threading.Lock` leads to corrupted state under contention.',
    fixHint:
      'Wrap the critical section in `with lock:` (threading.Lock / asyncio.Lock) or move to a queue-based actor model.',
    origin: 'builtin',
    languages: ['python'],
    patterns: [
      String.raw`threading\.Thread\s*\([\s\S]{0,200}?target\s*=`,
    ],
    negativePatterns: [
      String.raw`threading\.(?:Lock|RLock|Semaphore)\s*\(`,
      String.raw`queue\.Queue\s*\(`,
    ],
    tags: ['concurrency'],
  },
  {
    id: 'go:race:goroutine-loop-capture',
    ruleVersion: '1',
    category: 'race-conditions',
    severity: 'warning',
    title: 'Goroutine captures loop variable by reference',
    description:
      'Before Go 1.22, `for _, v := range xs { go func(){ use(v) }() }` captures the same `v` for every goroutine. Even on 1.22+, the pattern fools many static checks and newer contributors.',
    fixHint:
      'Pass the loop variable as a parameter: `go func(v T){ use(v) }(v)` — explicit and version-independent.',
    origin: 'builtin',
    languages: ['go'],
    patterns: [
      String.raw`for\s+[^{]{0,120}range\s+[\s\S]{0,40}\{[\s\S]{0,200}?go\s+func\s*\(\s*\)\s*\{[\s\S]{0,200}?\b(?:v|i|item|val|x)\b`,
    ],
    patternFlags: 's',
    tags: ['concurrency', 'goroutine'],
  },
  {
    id: 'go:race:map-without-mutex',
    ruleVersion: '1',
    category: 'race-conditions',
    severity: 'error',
    title: 'Concurrent map access without sync.Mutex or sync.Map',
    description:
      'Go maps are not safe for concurrent write access. Parallel writes will crash the process with `fatal error: concurrent map writes`.',
    fixHint:
      'Guard the map with `sync.RWMutex` or switch to `sync.Map` when access is heavily read-dominated.',
    origin: 'builtin',
    languages: ['go'],
    patterns: [
      String.raw`go\s+func[\s\S]{0,400}?\b\w+\s*\[[^\]]+\]\s*=\s*`,
    ],
    negativePatterns: [
      String.raw`sync\.(?:Mutex|RWMutex|Map)\b`,
    ],
    patternFlags: 's',
    tags: ['concurrency'],
  },
  {
    id: 'php:race:laravel-balance-update',
    ruleVersion: '1',
    category: 'race-conditions',
    severity: 'error',
    title: 'Read-modify-write on a model field without lockForUpdate',
    description:
      'Fetching a record, incrementing a field in PHP, then saving it back is not atomic. Concurrent requests produce lost updates (classic "wallet bug").',
    fixHint:
      'Use `DB::transaction(fn () => Model::lockForUpdate()->where(...)->increment(...))` or a single UPDATE that does the arithmetic in SQL.',
    origin: 'builtin',
    languages: ['php'],
    patterns: [
      String.raw`\$\w+\s*=\s*[A-Z]\w+::(?:find|where)[\s\S]{0,200}?\$\w+->\w+\s*(?:\+=|-=)[\s\S]{0,200}?\$\w+->save\s*\(`,
    ],
    negativePatterns: [
      String.raw`lockForUpdate\s*\(`,
      String.raw`::increment\s*\(`,
      String.raw`::decrement\s*\(`,
    ],
    patternFlags: 's',
    requiredSignals: ['path:artisan'],
    tags: ['laravel', 'concurrency'],
  },
];
