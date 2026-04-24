import type { ProdRiskRule } from '../types';

/**
 * Weak logging: print-debugging in production code, swallowed errors,
 * logs without context ids, and log statements that quietly leak
 * secrets / PII. All of them reduce the signal at 3am.
 */
export const WEAK_LOGGING_RULES: readonly ProdRiskRule[] = [
  {
    id: 'ts:log:console-in-server',
    ruleVersion: '1',
    category: 'weak-logging',
    severity: 'hint',
    title: 'console.log used in server code',
    description:
      '`console.log` is unstructured and cannot be filtered, sampled, or correlated to a request. In production it drowns signal in noise.',
    fixHint:
      'Use a structured logger (pino, winston, bunyan, …) with a request-scoped child logger carrying `requestId`, `userId`, `route`.',
    origin: 'builtin',
    languages: ['typescript', 'javascript'],
    filePathIncludes: ['server', 'api', 'handler', 'controller', 'route'],
    patterns: [
      String.raw`console\.(?:log|debug|info)\s*\(`,
    ],
    negativePatterns: [
      String.raw`pino\b`,
      String.raw`winston\b`,
      String.raw`bunyan\b`,
      String.raw`import\s+\{\s*logger`,
    ],
    tags: ['logging', 'node'],
  },
  {
    id: 'ts:log:swallowed-catch',
    ruleVersion: '1',
    category: 'weak-logging',
    severity: 'warning',
    title: 'Empty catch block — error silently discarded',
    description:
      'An empty `catch (e) {}` block makes failures invisible in production. If it is intentional, the intent should be explicit and logged at `debug`.',
    fixHint:
      'Log the error with context (`logger.error({ err: e, op: "x" }, "x failed")`) and rethrow if the caller should know.',
    origin: 'builtin',
    languages: ['typescript', 'javascript', 'tsx', 'jsx'],
    patterns: [
      String.raw`catch\s*\(\s*\w*\s*\)\s*\{\s*\}`,
    ],
    tags: ['error-handling'],
  },
  {
    id: 'any:log:print-in-production',
    ruleVersion: '1',
    category: 'weak-logging',
    severity: 'hint',
    title: 'Raw print / var_dump / dd left in code',
    description:
      'Leftover debug statements ship to production, write to stdout without structure, and in some frameworks halt execution (`dd()`).',
    fixHint:
      'Replace with the project logger at the appropriate level. If genuinely temporary, the plugin review flags this for removal before merge.',
    origin: 'builtin',
    languages: ['php', 'python'],
    patterns: [
      String.raw`\b(?:var_dump|print_r|dd|dump)\s*\(`,
      String.raw`^\s*print\s*\(`,
    ],
    tags: ['debug'],
  },
  {
    id: 'py:log:bare-except-pass',
    ruleVersion: '1',
    category: 'weak-logging',
    severity: 'error',
    title: 'Bare except swallowing exceptions',
    description:
      '`except: pass` or `except Exception: pass` hides every failure including `KeyboardInterrupt` or logic bugs — a classic cause of silent production corruption.',
    fixHint:
      'Narrow the except to the specific exception class and `logger.exception("...")` at minimum; rethrow if the caller needs to know.',
    origin: 'builtin',
    languages: ['python'],
    patterns: [
      String.raw`except(?:\s+Exception)?\s*:\s*(?:\n\s*pass|\s*pass)`,
    ],
    tags: ['error-handling'],
  },
  {
    id: 'php:log:catch-no-log',
    ruleVersion: '1',
    category: 'weak-logging',
    severity: 'warning',
    title: 'PHP catch block without Log::error / report',
    description:
      'Catching `\\Throwable` and returning without logging or calling `report($e)` makes the error invisible to observability tooling.',
    fixHint:
      'Call `Log::error($e->getMessage(), ["exception" => $e, "context" => [...]]);` or `report($e);` before returning.',
    origin: 'builtin',
    languages: ['php'],
    patterns: [
      String.raw`catch\s*\(\s*(?:\\)?\w+\s+\$\w+\s*\)\s*\{\s*\}`,
      String.raw`catch\s*\(\s*(?:\\)?\w+\s+\$\w+\s*\)\s*\{\s*return\s+[^;]{0,120};\s*\}`,
    ],
    negativePatterns: [
      String.raw`Log::(?:error|critical|warning)\s*\(`,
      String.raw`\breport\s*\(\s*\$\w+\s*\)`,
    ],
    patternFlags: 's',
    requiredSignals: ['php:composer'],
    tags: ['laravel', 'logging'],
  },
  {
    id: 'any:log:secret-logged',
    ruleVersion: '1',
    category: 'weak-logging',
    severity: 'error',
    title: 'Logging a value that looks like a secret or token',
    description:
      'Logging a value labelled `password`, `token`, `api_key`, or `authorization` lands the secret in every log sink the service writes to, including third-party aggregators.',
    fixHint:
      'Redact at the logger: use a serializer that masks these fields (`pino-redact`, `serializers`) or log only the `sha256` prefix.',
    origin: 'builtin',
    languages: ['typescript', 'javascript', 'tsx', 'jsx', 'python', 'php', 'go'],
    patterns: [
      String.raw`(?:console\.log|logger\.\w+|Log::\w+|log\.\w+|logging\.\w+|fmt\.Println)\s*\([^)]*\b(?:password|api_?key|secret|token|authorization)\b`,
    ],
    tags: ['logging', 'security'],
  },
];
