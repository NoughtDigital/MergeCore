import type { ProdRiskRule } from '../types';

/**
 * Memory leaks: unbounded in-process state (caches, listener lists,
 * intervals, global maps) that grows with traffic until the process
 * OOMs or hits GC thrashing.
 */
export const MEMORY_LEAK_RULES: readonly ProdRiskRule[] = [
  {
    id: 'ts:leak:module-scope-map',
    ruleVersion: '1',
    category: 'memory-leaks',
    severity: 'warning',
    title: 'Module-scope Map/Set used as a cache without eviction',
    description:
      'A top-level `new Map()` / `new Set()` grows for every request in a long-running Node process. Without a TTL or size cap it is a classic slow leak that survives deploys.',
    fixHint:
      'Use an LRU cache (`lru-cache`), set a `max` and `ttl`, or delegate to Redis. If this really is per-request, move it inside the handler.',
    origin: 'builtin',
    languages: ['typescript', 'javascript', 'tsx', 'jsx'],
    patterns: [
      String.raw`^\s*const\s+\w+\s*=\s*new\s+(?:Map|Set)\s*\(\s*\)\s*;`,
    ],
    negativePatterns: [
      String.raw`lru-cache`,
      String.raw`LRU\s*\(`,
      String.raw`\.(?:delete|clear)\s*\(`,
    ],
    tags: ['cache', 'node'],
  },
  {
    id: 'ts:leak:setinterval-no-clear',
    ruleVersion: '1',
    category: 'memory-leaks',
    severity: 'warning',
    title: 'setInterval without a matching clearInterval',
    description:
      'Timers in long-lived modules (servers, singletons, React effects) hold closures alive. No clear means the associated scope and its objects never get GCed.',
    fixHint:
      'Store the handle, and call `clearInterval(handle)` in the matching teardown (shutdown handler, `useEffect` return, or finaliser).',
    origin: 'builtin',
    languages: ['typescript', 'javascript', 'tsx', 'jsx'],
    patterns: [
      String.raw`setInterval\s*\(`,
    ],
    negativePatterns: [
      String.raw`clearInterval\s*\(`,
    ],
    tags: ['timer', 'node', 'react'],
  },
  {
    id: 'ts:leak:event-emitter-no-off',
    ruleVersion: '1',
    category: 'memory-leaks',
    severity: 'warning',
    title: 'EventEmitter.on without matching .off / .removeListener',
    description:
      'Long-lived emitters (process, singleton services, pub/sub clients) accumulate listeners forever when code only calls `.on` — leaking both memory and CPU on every emit.',
    fixHint:
      'Pair each `.on(event, handler)` with `.off(event, handler)` on teardown, or use `.once(...)` when one-shot.',
    origin: 'builtin',
    languages: ['typescript', 'javascript', 'tsx', 'jsx'],
    patterns: [
      String.raw`\b(?:process|emitter|bus|io|socket|client)\.on\s*\(`,
    ],
    negativePatterns: [
      String.raw`\.off\s*\(`,
      String.raw`removeListener\s*\(`,
      String.raw`removeAllListeners\s*\(`,
    ],
    tags: ['events'],
  },
  {
    id: 'react:leak:effect-no-cleanup',
    ruleVersion: '1',
    category: 'memory-leaks',
    severity: 'warning',
    title: 'useEffect subscribes but returns no cleanup function',
    description:
      'Setting up a timer, subscription, or listener inside `useEffect` without returning a cleanup callback leaks on every rerender and unmount.',
    fixHint:
      'Return a cleanup function from the effect: `return () => { clearInterval(id); sub.unsubscribe(); };`.',
    origin: 'builtin',
    languages: ['tsx', 'jsx', 'typescript', 'javascript'],
    requiredSignals: ['react'],
    patterns: [
      String.raw`useEffect\s*\(\s*\(\s*\)\s*=>\s*\{[\s\S]{0,600}?(?:setInterval|setTimeout|addEventListener|subscribe)\s*\([\s\S]{0,600}?\}\s*,\s*\[`,
    ],
    negativePatterns: [
      String.raw`useEffect\s*\(\s*\(\s*\)\s*=>\s*\{[\s\S]{0,1200}?return\s+\(?\s*\)?\s*=>\s*\{`,
    ],
    patternFlags: 's',
    tags: ['react', 'hooks'],
  },
  {
    id: 'py:leak:lru-cache-on-self',
    ruleVersion: '1',
    category: 'memory-leaks',
    severity: 'warning',
    title: '@lru_cache on an instance method holds instances forever',
    description:
      '`functools.lru_cache` on a method captures `self` in the key, so the cache keeps every instance alive for the lifetime of the class.',
    fixHint:
      'Use `functools.cache` on a module-level function, or `cachetools.TTLCache` stored on the instance with a bounded size.',
    origin: 'builtin',
    languages: ['python'],
    patterns: [
      String.raw`@(?:functools\.)?lru_cache[\s\S]{0,80}\n\s*def\s+\w+\s*\(\s*self\b`,
    ],
    tags: ['python', 'cache'],
  },
  {
    id: 'go:leak:unclosed-body',
    ruleVersion: '1',
    category: 'memory-leaks',
    severity: 'warning',
    title: 'HTTP response body used without defer resp.Body.Close()',
    description:
      'Not closing `resp.Body` leaks TCP connections from the default transport pool, which presents first as file-descriptor exhaustion and then as memory growth.',
    fixHint:
      'Add `defer resp.Body.Close()` immediately after the error check, even on error paths where applicable.',
    origin: 'builtin',
    languages: ['go'],
    patterns: [
      String.raw`(?:resp|r|res)\s*,\s*err\s*:?=\s*\w+\.(?:Get|Post|Do)\s*\(`,
    ],
    negativePatterns: [
      String.raw`defer\s+\w+\.Body\.Close\s*\(\s*\)`,
    ],
    tags: ['net/http', 'go'],
  },
];
