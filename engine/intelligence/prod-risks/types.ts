/**
 * "What Breaks In Prod?" Scanner — public types.
 *
 * This module defines a small, stable contract that lives independently
 * of any specific rules pack. Packs, detectors, and future ecosystems
 * contribute rules against this contract; the scanner is pack-agnostic.
 *
 * Design goals:
 *  - Separates toys from tools by focusing on nine production risk
 *    categories that cause real incidents (see `ProdRiskCategory`).
 *  - Rules are *data*, not code, so a new pack can extend coverage
 *    without touching the scanner.
 *  - Each rule is language-gated and stack-gated so we never flag
 *    `time.sleep` in a Swift project or `go func()` in a Python one.
 *  - Stable `id` values + `ruleVersion` keep findings referenceable in
 *    PRs and dashboards as packs evolve.
 */

/**
 * The nine production risk categories the scanner promises to cover.
 * These are intentionally "what wakes an on-call engineer up", not style.
 *
 * Extensible: downstream tools may treat unknown categories as `'other'`
 * (see `isKnownProdRiskCategory`), but new categories should be added here
 * when they become first-class in the product. Never rename existing ids.
 */
export const PROD_RISK_CATEGORIES = [
  'race-conditions',
  'retry-duplication',
  'no-transactions',
  'bad-queue-retries',
  'memory-leaks',
  'n-plus-one',
  'missing-indexes',
  'no-rate-limits',
  'weak-logging',
] as const;

export type ProdRiskCategory = (typeof PROD_RISK_CATEGORIES)[number];

export function isKnownProdRiskCategory(value: string): value is ProdRiskCategory {
  return (PROD_RISK_CATEGORIES as readonly string[]).includes(value);
}

/** Severity aligned with the review engine's `Finding` severity. */
export type ProdRiskSeverity = 'critical' | 'error' | 'warning' | 'info' | 'hint';

/**
 * A language hint used by the scanner to decide whether a rule even
 * applies to a given file. The list is open; unknown languages are
 * treated as "match if the rule opts in via `languages: ['*']`".
 */
export type ProdRiskLanguage =
  | 'typescript'
  | 'javascript'
  | 'tsx'
  | 'jsx'
  | 'php'
  | 'python'
  | 'go'
  | 'swift'
  | 'rust'
  | 'java'
  | 'kotlin'
  | 'ruby'
  | 'csharp'
  | 'sql'
  | 'yaml'
  | 'json'
  | 'blade'
  | 'vue'
  | '*';

/**
 * Workspace-level stack signals the rule requires to be "live". Each
 * entry is matched against {@link import('../types').ProjectProfile.signals}.
 *
 * Example: `['laravel']` means the rule only fires inside a Laravel repo.
 *
 * Empty/omitted = always active if the language matches. This keeps
 * generic rules (missing indexes in SQL migrations, weak logging) wide.
 */
export type ProdRiskRequiredSignal = string;

/**
 * A rule is a piece of evidence-bearing data that the scanner evaluates
 * against file contents. All matching is local, deterministic, and
 * cheap — no LLM calls.
 *
 * Rules may ship with:
 *  - `patterns`: regex strings tried against the file body (multi-line ok).
 *    Each pattern must be a JavaScript-compatible regex literal source
 *    (without the surrounding slashes). The scanner compiles them with
 *    `m` flag by default; add `s` by hand in `patternFlags` when you need
 *    dotAll.
 *  - `negativePatterns`: if ANY of these match the file, the rule is
 *    suppressed for that file. Used to avoid false positives when a
 *    safeguard is already present (e.g. `DB::transaction(` defeats the
 *    "no transactions" rule for the same file).
 *  - `filePathIncludes` / `filePathExcludes`: substring filters on the
 *    workspace-relative path (lowercased, forward-slashed). Cheap and
 *    surprisingly effective (e.g. `/migrations/` for missing-indexes).
 */
export interface ProdRiskRule {
  /** Stable dot-colon namespaced id, e.g. `ts:race:shared-mutable-async`. */
  readonly id: string;
  /** Monotonic string — bump when semantics change so caches invalidate. */
  readonly ruleVersion: string;
  readonly category: ProdRiskCategory;
  readonly severity: ProdRiskSeverity;
  /** Short headline — appears in the sidebar and the diagnostic squiggle. */
  readonly title: string;
  /** Why this is a production risk, in one or two sentences. */
  readonly description: string;
  /** Concrete fix direction; never vague advice. */
  readonly fixHint: string;
  /**
   * Where the rule comes from. `'builtin'` for defaults that ship with
   * the engine, or a pack id like `'mergecore-react-rules'` so findings
   * can link back to the pack the user already trusts.
   */
  readonly origin: 'builtin' | (string & {});
  /** Languages the rule targets. `['*']` means "any text file". */
  readonly languages: readonly ProdRiskLanguage[];
  /**
   * Required workspace signals (AND). Empty means always active.
   * Example: `['laravel']` or `['react', 'typescript']`.
   */
  readonly requiredSignals?: readonly ProdRiskRequiredSignal[];
  /** Regex sources (without slashes). At least one must match per rule. */
  readonly patterns?: readonly string[];
  /** Extra regex flags appended to the default `m`. */
  readonly patternFlags?: string;
  /** If any match, the rule is suppressed for that file. */
  readonly negativePatterns?: readonly string[];
  /**
   * Substrings matched against the lowercased workspace-relative path.
   * ANY match gates the rule on. Use to focus on migrations, handlers, etc.
   */
  readonly filePathIncludes?: readonly string[];
  /** Substrings that exclude the file from the rule entirely. */
  readonly filePathExcludes?: readonly string[];
  /**
   * Optional static tags used for grouping in UIs. Not interpreted by
   * the scanner — kept for future filtering / telemetry.
   */
  readonly tags?: readonly string[];
}

/**
 * A concrete match found by the scanner. Line/column are 1-based to
 * match VS Code's `Finding` expectations in the extension.
 */
export interface ProdRiskFinding {
  readonly ruleId: string;
  readonly ruleVersion: string;
  readonly category: ProdRiskCategory;
  readonly severity: ProdRiskSeverity;
  readonly title: string;
  readonly description: string;
  readonly fixHint: string;
  readonly origin: string;
  /** Workspace-relative forward-slashed path. */
  readonly file: string;
  readonly line?: number;
  readonly column?: number;
  /** The matched text (truncated to 240 chars so panels stay readable). */
  readonly evidence?: string;
}

/**
 * A category roll-up used by presentation layers to show "8 race
 * condition hits in 3 files" without re-walking the finding list.
 */
export interface ProdRiskCategorySummary {
  readonly category: ProdRiskCategory;
  readonly count: number;
  readonly files: number;
  readonly worstSeverity: ProdRiskSeverity;
}

/** Full scan result. */
export interface ProdRiskScanResult {
  readonly scannedFiles: number;
  readonly skippedFiles: number;
  readonly durationMs: number;
  readonly findings: readonly ProdRiskFinding[];
  readonly summary: readonly ProdRiskCategorySummary[];
  /** Rules that were considered but did not fire, for transparency. */
  readonly activeRuleIds: readonly string[];
  /**
   * The rule-set fingerprint. Changes whenever the active rule list
   * changes so caches and UI badges can invalidate correctly.
   */
  readonly ruleSetFingerprint: string;
}

/** Scan progress hook (optional). */
export interface ProdRiskScanProgress {
  onFile?: (relPath: string, index: number, total: number) => void;
}
