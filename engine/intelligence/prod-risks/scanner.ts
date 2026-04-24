import * as fs from 'fs/promises';
import * as path from 'path';
import type { ProjectProfile } from '../types';
import { BUILTIN_PROD_RISK_RULES } from './rules';
import { loadPackProdRiskRules } from './pack-loader';
import {
  PROD_RISK_CATEGORIES,
  type ProdRiskCategory,
  type ProdRiskCategorySummary,
  type ProdRiskFinding,
  type ProdRiskLanguage,
  type ProdRiskRule,
  type ProdRiskScanProgress,
  type ProdRiskScanResult,
  type ProdRiskSeverity,
} from './types';

/**
 * Pack-aware, fully-local "What Breaks In Prod?" scanner.
 *
 * The scanner separates three concerns so it can be reused from the
 * extension, CI, or a unit test:
 *  1. Rule assembly — merge built-in + pack-contributed rules, then
 *     filter by the active {@link ProjectProfile} signals.
 *  2. File walking  — bounded, deterministic, excludes the usual
 *     heavy directories. Same exclusion list as the profile collector
 *     so findings and conventions speak about the same file set.
 *  3. Rule evaluation — one pre-compiled regex per pattern, evaluated
 *     against every applicable file. Negative patterns suppress the
 *     whole file for that rule; positives emit a finding per match up
 *     to a per-rule cap.
 *
 * Future-proofing notes for anyone adding packs or languages:
 *  - Unknown languages are fine; use `'*'` in `languages` to apply to
 *    any text file, or add the language to `FILE_LANGUAGE_MAP` below.
 *  - Unknown categories are dropped at pack-loader time; extending
 *    `PROD_RISK_CATEGORIES` in `types.ts` is the only place to add new
 *    ones, and it is a deliberate, reviewed change.
 *  - Rules are data. Never put executable logic in `prod-risks.json`;
 *    keep it in this file (behind a bool flag or a new rule field) so
 *    extension hosts stay safe.
 */

/** Files larger than this are skipped. 512 KB is well above any normal source file. */
const MAX_FILE_BYTES = 512 * 1024;

/** Hard cap on findings per rule per scan to keep the UI readable. */
const MAX_FINDINGS_PER_RULE = 50;

/** Hard cap on total files walked to stay fast on big monorepos. */
const MAX_SCANNED_FILES = 5000;

/** Hard cap on matches evaluated per file per pattern — prevents pathological O(n^2) regex loops. */
const MAX_MATCHES_PER_PATTERN_PER_FILE = 20;

const WALK_EXCLUDE = new Set<string>([
  'node_modules',
  'vendor',
  '.git',
  '.hg',
  '.svn',
  'dist',
  'build',
  'out',
  '.next',
  '.nuxt',
  '.svelte-kit',
  'coverage',
  '.venv',
  'venv',
  '__pycache__',
  '.mypy_cache',
  '.pytest_cache',
  'target',
  '.turbo',
  '.cache',
  '.gradle',
  'DerivedData',
  '.idea',
  '.vscode',
  'storage',
]);

const FILE_LANGUAGE_MAP: Readonly<Record<string, ProdRiskLanguage>> = {
  '.ts': 'typescript',
  '.mts': 'typescript',
  '.cts': 'typescript',
  '.tsx': 'tsx',
  '.js': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.jsx': 'jsx',
  '.php': 'php',
  '.blade.php': 'blade',
  '.py': 'python',
  '.go': 'go',
  '.swift': 'swift',
  '.rs': 'rust',
  '.java': 'java',
  '.kt': 'kotlin',
  '.kts': 'kotlin',
  '.rb': 'ruby',
  '.cs': 'csharp',
  '.sql': 'sql',
  '.yml': 'yaml',
  '.yaml': 'yaml',
  '.json': 'json',
  '.vue': 'vue',
  '.prisma': '*',
};

export interface ProdRiskScannerOptions {
  readonly workspaceRoot: string;
  readonly profile?: ProjectProfile;
  /**
   * Path to `rules/registry.json` (or equivalent). When provided, pack-
   * contributed rules are merged on top of the built-in set. Omitting
   * this keeps the scanner usable in environments without packs.
   */
  readonly rulesRegistryPath?: string;
  /**
   * Extra in-memory rules (for tests or hosts that want to inject
   * rules without a registry).
   */
  readonly extraRules?: readonly ProdRiskRule[];
  /**
   * Limit the scan to a subset of files (workspace-relative). When
   * omitted, the scanner walks the whole workspace up to
   * `MAX_SCANNED_FILES`.
   */
  readonly files?: readonly string[];
  readonly progress?: ProdRiskScanProgress;
}

export async function scanProdRisks(
  options: ProdRiskScannerOptions
): Promise<ProdRiskScanResult> {
  const started = Date.now();
  const rules = await assembleRules(options);
  const activeRules = filterRulesByProfile(rules, options.profile);
  const ruleSetFingerprint = buildRuleSetFingerprint(activeRules);

  const files = options.files
    ? options.files.slice(0, MAX_SCANNED_FILES)
    : await walkWorkspace(options.workspaceRoot);

  const findings: ProdRiskFinding[] = [];
  const perRuleCounts = new Map<string, number>();
  let scanned = 0;
  let skipped = 0;

  for (let i = 0; i < files.length; i++) {
    const rel = files[i];
    options.progress?.onFile?.(rel, i, files.length);
    const language = detectLanguage(rel);
    const applicable = activeRules.filter((r) =>
      ruleAppliesToFile(r, rel.toLowerCase(), language)
    );
    if (applicable.length === 0) {
      skipped++;
      continue;
    }
    const abs = path.join(options.workspaceRoot, rel);
    let stat;
    try {
      stat = await fs.stat(abs);
    } catch {
      skipped++;
      continue;
    }
    if (!stat.isFile() || stat.size > MAX_FILE_BYTES) {
      skipped++;
      continue;
    }
    let content: string;
    try {
      content = await fs.readFile(abs, 'utf8');
    } catch {
      skipped++;
      continue;
    }
    scanned++;

    for (const rule of applicable) {
      const existing = perRuleCounts.get(rule.id) ?? 0;
      if (existing >= MAX_FINDINGS_PER_RULE) {
        continue;
      }
      const ruleHits = evaluateRule(rule, rel, content);
      for (const hit of ruleHits) {
        findings.push(hit);
        const next = (perRuleCounts.get(rule.id) ?? 0) + 1;
        perRuleCounts.set(rule.id, next);
        if (next >= MAX_FINDINGS_PER_RULE) {
          break;
        }
      }
    }
  }

  return {
    scannedFiles: scanned,
    skippedFiles: skipped,
    durationMs: Date.now() - started,
    findings: sortFindings(findings),
    summary: summarise(findings),
    activeRuleIds: activeRules.map((r) => r.id),
    ruleSetFingerprint,
  };
}

async function assembleRules(
  options: ProdRiskScannerOptions
): Promise<readonly ProdRiskRule[]> {
  const packRules = options.rulesRegistryPath
    ? await loadPackProdRiskRules(options.rulesRegistryPath)
    : [];
  const merged = new Map<string, ProdRiskRule>();
  for (const r of BUILTIN_PROD_RISK_RULES) {
    merged.set(r.id, r);
  }
  // Packs can override a builtin by using the same id. We favour the
  // pack definition when one is supplied because pack maintainers own
  // ecosystem-specific nuance.
  for (const r of packRules) {
    merged.set(r.id, r);
  }
  if (options.extraRules) {
    for (const r of options.extraRules) {
      merged.set(r.id, r);
    }
  }
  return [...merged.values()];
}

function filterRulesByProfile(
  rules: readonly ProdRiskRule[],
  profile: ProjectProfile | undefined
): readonly ProdRiskRule[] {
  const signals = new Set<string>(profile?.signals ?? []);
  return rules.filter((rule) => {
    if (!rule.requiredSignals || rule.requiredSignals.length === 0) {
      return true;
    }
    // AND semantics: every required signal must be present. This lets
    // rules target precise stacks (e.g. `react` AND `typescript`)
    // without weakening to substring matches.
    return rule.requiredSignals.every((s) => signals.has(s));
  });
}

function detectLanguage(rel: string): ProdRiskLanguage | undefined {
  const lower = rel.toLowerCase();
  // Check compound extensions first (e.g. .blade.php) so they win over
  // the shorter .php match.
  const compound = Object.keys(FILE_LANGUAGE_MAP).filter((k) => k.length > 4);
  for (const ext of compound) {
    if (lower.endsWith(ext)) {
      return FILE_LANGUAGE_MAP[ext];
    }
  }
  const dot = lower.lastIndexOf('.');
  if (dot < 0) {
    return undefined;
  }
  const ext = lower.slice(dot);
  return FILE_LANGUAGE_MAP[ext];
}

function ruleAppliesToFile(
  rule: ProdRiskRule,
  lowerRel: string,
  language: ProdRiskLanguage | undefined
): boolean {
  const wildcard = rule.languages.includes('*');
  if (!wildcard) {
    if (!language || !rule.languages.includes(language)) {
      return false;
    }
  }
  if (rule.filePathIncludes && rule.filePathIncludes.length > 0) {
    const hit = rule.filePathIncludes.some((needle) =>
      lowerRel.includes(needle.toLowerCase())
    );
    if (!hit) {
      return false;
    }
  }
  if (rule.filePathExcludes && rule.filePathExcludes.length > 0) {
    const blocked = rule.filePathExcludes.some((needle) =>
      lowerRel.includes(needle.toLowerCase())
    );
    if (blocked) {
      return false;
    }
  }
  return true;
}

interface CompiledRule {
  readonly rule: ProdRiskRule;
  readonly positives: readonly RegExp[];
  readonly negatives: readonly RegExp[];
}

const compileCache = new WeakMap<ProdRiskRule, CompiledRule>();

function compileRule(rule: ProdRiskRule): CompiledRule {
  const cached = compileCache.get(rule);
  if (cached) {
    return cached;
  }
  const flags = normaliseFlags(rule.patternFlags);
  const positives = (rule.patterns ?? [])
    .map((src) => safeCompile(src, flags))
    .filter((r): r is RegExp => r !== undefined);
  const negatives = (rule.negativePatterns ?? [])
    .map((src) => safeCompile(src, flags))
    .filter((r): r is RegExp => r !== undefined);
  const compiled: CompiledRule = { rule, positives, negatives };
  compileCache.set(rule, compiled);
  return compiled;
}

function normaliseFlags(raw: string | undefined): string {
  // Always include 'g' (so we can iterate matches) and 'm' (so `^`/`$`
  // behave per line). Keep user-supplied flags like 's' or 'i'.
  const base = new Set<string>(['g', 'm']);
  if (raw) {
    for (const ch of raw) {
      base.add(ch);
    }
  }
  return [...base].join('');
}

function safeCompile(src: string, flags: string): RegExp | undefined {
  try {
    return new RegExp(src, flags);
  } catch {
    return undefined;
  }
}

function evaluateRule(
  rule: ProdRiskRule,
  relFile: string,
  content: string
): readonly ProdRiskFinding[] {
  const compiled = compileRule(rule);
  if (compiled.positives.length === 0 && (!rule.filePathIncludes || rule.filePathIncludes.length === 0)) {
    return [];
  }

  // Negative patterns suppress the rule on this whole file: the file
  // already carries the safeguard the rule is asking for.
  for (const neg of compiled.negatives) {
    neg.lastIndex = 0;
    if (neg.test(content)) {
      return [];
    }
  }

  // Rules with only a path filter and no positive regex fire once per
  // matching file at line 1, because the evidence is the path itself.
  if (compiled.positives.length === 0) {
    return [makeFinding(rule, relFile, 1, 1, relFile)];
  }

  const findings: ProdRiskFinding[] = [];
  for (const re of compiled.positives) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    let iterations = 0;
    while ((m = re.exec(content)) !== null) {
      iterations++;
      if (iterations > MAX_MATCHES_PER_PATTERN_PER_FILE) {
        break;
      }
      const { line, column } = indexToLineCol(content, m.index);
      findings.push(makeFinding(rule, relFile, line, column, m[0]));
      if (m.index === re.lastIndex) {
        // Zero-width match guard so we never loop forever.
        re.lastIndex++;
      }
    }
  }
  return findings;
}

function makeFinding(
  rule: ProdRiskRule,
  file: string,
  line: number,
  column: number,
  evidence: string
): ProdRiskFinding {
  return {
    ruleId: rule.id,
    ruleVersion: rule.ruleVersion,
    category: rule.category,
    severity: rule.severity,
    title: rule.title,
    description: rule.description,
    fixHint: rule.fixHint,
    origin: rule.origin,
    file,
    line,
    column,
    evidence: truncateEvidence(evidence),
  };
}

function truncateEvidence(text: string): string {
  const compact = text.replace(/\s+/g, ' ').trim();
  return compact.length > 240 ? `${compact.slice(0, 237)}…` : compact;
}

function indexToLineCol(content: string, index: number): { line: number; column: number } {
  let line = 1;
  let col = 1;
  for (let i = 0; i < index && i < content.length; i++) {
    const ch = content.charCodeAt(i);
    if (ch === 10 /* \n */) {
      line++;
      col = 1;
    } else {
      col++;
    }
  }
  return { line, column: col };
}

async function walkWorkspace(root: string): Promise<readonly string[]> {
  const out: string[] = [];
  async function recurse(dirRel: string): Promise<void> {
    if (out.length >= MAX_SCANNED_FILES) {
      return;
    }
    let entries;
    try {
      entries = await fs.readdir(path.join(root, dirRel), { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (out.length >= MAX_SCANNED_FILES) {
        return;
      }
      if (entry.name.startsWith('.DS_Store')) {
        continue;
      }
      const rel = dirRel ? `${dirRel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (WALK_EXCLUDE.has(entry.name) || entry.name.startsWith('.')) {
          continue;
        }
        await recurse(rel);
      } else if (entry.isFile()) {
        out.push(rel);
      }
    }
  }
  await recurse('');
  return out;
}

function summarise(
  findings: readonly ProdRiskFinding[]
): readonly ProdRiskCategorySummary[] {
  const buckets = new Map<ProdRiskCategory, { count: number; files: Set<string>; worst: ProdRiskSeverity }>();
  for (const cat of PROD_RISK_CATEGORIES) {
    buckets.set(cat, { count: 0, files: new Set(), worst: 'hint' });
  }
  for (const f of findings) {
    const b = buckets.get(f.category);
    if (!b) {
      continue;
    }
    b.count++;
    b.files.add(f.file);
    if (severityRank(f.severity) > severityRank(b.worst)) {
      b.worst = f.severity;
    }
  }
  return [...buckets.entries()]
    .filter(([, v]) => v.count > 0)
    .map(([category, v]) => ({
      category,
      count: v.count,
      files: v.files.size,
      worstSeverity: v.worst,
    }))
    .sort((a, b) => severityRank(b.worstSeverity) - severityRank(a.worstSeverity));
}

function severityRank(s: ProdRiskSeverity): number {
  switch (s) {
    case 'critical':
      return 5;
    case 'error':
      return 4;
    case 'warning':
      return 3;
    case 'info':
      return 2;
    case 'hint':
    default:
      return 1;
  }
}

function sortFindings(findings: readonly ProdRiskFinding[]): readonly ProdRiskFinding[] {
  return [...findings].sort((a, b) => {
    const bySeverity = severityRank(b.severity) - severityRank(a.severity);
    if (bySeverity !== 0) {
      return bySeverity;
    }
    const byFile = a.file.localeCompare(b.file);
    if (byFile !== 0) {
      return byFile;
    }
    return (a.line ?? 0) - (b.line ?? 0);
  });
}

function buildRuleSetFingerprint(rules: readonly ProdRiskRule[]): string {
  // Stable hash of (id, version) pairs so hosts can cache results
  // keyed on the exact rule set. fnv-1a 32-bit, hex encoded.
  const material = rules
    .map((r) => `${r.id}@${r.ruleVersion}`)
    .sort()
    .join('|');
  let h = 2166136261 >>> 0;
  for (let i = 0; i < material.length; i++) {
    h ^= material.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
