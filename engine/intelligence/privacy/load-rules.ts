import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type {
  PrivacyClassification,
  PrivacyRule,
  PrivacyRuleSource,
} from '../contracts/types';

const CLASSIFICATIONS = new Set<PrivacyClassification>([
  'normal',
  'local_only',
  'metadata_only',
  'never_index',
  'never_send_to_model',
]);

export interface PrivacyRulesFile {
  readonly schemaVersion: number;
  readonly rules: readonly PrivacyRule[];
}

export interface PrivacyOverridesFile {
  readonly schemaVersion: number;
  /** Explicit path → weaker classification confirmed by the user. */
  readonly overrides: Readonly<Record<string, PrivacyClassification>>;
}

/** Built-in defaults applied when no config file exists. */
export const DEFAULT_PRIVACY_PATTERNS: readonly Omit<PrivacyRule, 'source' | 'rulePath'>[] = [
  { pattern: 'secrets/**', classification: 'never_index' },
  { pattern: '*.pem', classification: 'never_index' },
  { pattern: '.env', classification: 'never_send_to_model' },
  { pattern: '.env.*', classification: 'never_send_to_model' },
  { pattern: 'customer-data/**', classification: 'never_send_to_model' },
  { pattern: 'generated/**', classification: 'metadata_only' },
  { pattern: 'fixtures/private/**', classification: 'local_only' },
  { pattern: 'vendor/**', classification: 'never_index' },
  { pattern: 'legacy/**', classification: 'never_index' },
  { pattern: 'node_modules/**', classification: 'never_index' },
];

export function globalPrivacyConfigPath(): string {
  if (process.platform === 'win32') {
    const base = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    return path.join(base, 'mergecore', 'privacy.json');
  }
  const xdg = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  return path.join(xdg, 'mergecore', 'privacy.json');
}

export function workspacePrivacyConfigPath(workspaceRoot: string): string {
  return path.join(workspaceRoot, '.mergecore', 'privacy.json');
}

export function workspacePrivacyOverridesPath(workspaceRoot: string): string {
  return path.join(workspaceRoot, '.mergecore', 'privacy-overrides.json');
}

function parseRule(
  raw: unknown,
  source: PrivacyRuleSource,
  rulePath?: string
): PrivacyRule | undefined {
  if (!raw || typeof raw !== 'object') {
    return undefined;
  }
  const obj = raw as Record<string, unknown>;
  const pattern = typeof obj.pattern === 'string' ? obj.pattern.trim() : '';
  const classification = obj.classification;
  if (!pattern || typeof classification !== 'string' || !CLASSIFICATIONS.has(classification as PrivacyClassification)) {
    return undefined;
  }
  const rule: PrivacyRule = {
    pattern,
    classification: classification as PrivacyClassification,
    source,
    ...(rulePath ? { rulePath } : {}),
    ...(obj.include === true ? { include: true } : {}),
    ...(Array.isArray(obj.languages)
      ? {
          languages: obj.languages.filter((l): l is string => typeof l === 'string'),
        }
      : {}),
    ...(Array.isArray(obj.extensions)
      ? {
          extensions: obj.extensions.filter((e): e is string => typeof e === 'string'),
        }
      : {}),
  };
  return rule;
}

export function parsePrivacyRulesFile(
  json: string,
  source: PrivacyRuleSource,
  rulePath?: string
): PrivacyRulesFile {
  const raw = JSON.parse(json) as unknown;
  if (!raw || typeof raw !== 'object') {
    throw new Error('Privacy rules file must be an object');
  }
  const obj = raw as Record<string, unknown>;
  const schemaVersion =
    typeof obj.schemaVersion === 'number' ? obj.schemaVersion : 1;
  const rulesRaw = Array.isArray(obj.rules) ? obj.rules : [];
  const rules: PrivacyRule[] = [];
  for (const r of rulesRaw) {
    const parsed = parseRule(r, source, rulePath);
    if (parsed) {
      rules.push(parsed);
    }
  }
  return { schemaVersion, rules };
}

export function loadPrivacyRulesFile(
  filePath: string,
  source: PrivacyRuleSource
): PrivacyRulesFile | undefined {
  try {
    if (!fs.existsSync(filePath)) {
      return undefined;
    }
    const text = fs.readFileSync(filePath, 'utf8');
    return parsePrivacyRulesFile(text, source, filePath);
  } catch {
    return undefined;
  }
}

export function loadPrivacyOverrides(
  workspaceRoot: string
): PrivacyOverridesFile {
  const filePath = workspacePrivacyOverridesPath(workspaceRoot);
  try {
    if (!fs.existsSync(filePath)) {
      return { schemaVersion: 1, overrides: {} };
    }
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown;
    if (!raw || typeof raw !== 'object') {
      return { schemaVersion: 1, overrides: {} };
    }
    const obj = raw as Record<string, unknown>;
    const overridesRaw =
      obj.overrides && typeof obj.overrides === 'object'
        ? (obj.overrides as Record<string, unknown>)
        : {};
    const overrides: Record<string, PrivacyClassification> = {};
    for (const [p, c] of Object.entries(overridesRaw)) {
      if (typeof c === 'string' && CLASSIFICATIONS.has(c as PrivacyClassification)) {
        overrides[p.replace(/\\/g, '/')] = c as PrivacyClassification;
      }
    }
    return {
      schemaVersion: typeof obj.schemaVersion === 'number' ? obj.schemaVersion : 1,
      overrides,
    };
  } catch {
    return { schemaVersion: 1, overrides: {} };
  }
}

export function savePrivacyOverride(
  workspaceRoot: string,
  relPath: string,
  classification: PrivacyClassification
): void {
  const filePath = workspacePrivacyOverridesPath(workspaceRoot);
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const existing = loadPrivacyOverrides(workspaceRoot);
  const next: PrivacyOverridesFile = {
    schemaVersion: 1,
    overrides: {
      ...existing.overrides,
      [relPath.replace(/\\/g, '/')]: classification,
    },
  };
  fs.writeFileSync(filePath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
}

export function defaultPrivacyRules(): PrivacyRule[] {
  return DEFAULT_PRIVACY_PATTERNS.map((r) => ({
    ...r,
    source: 'default' as const,
    rulePath: 'builtin:defaults',
  }));
}

export function vscodeExtraExclusionRules(
  patterns: readonly string[]
): PrivacyRule[] {
  return patterns
    .map((p) => p.trim())
    .filter(Boolean)
    .map((pattern) => ({
      pattern,
      classification: 'never_index' as const,
      source: 'vscode' as const,
      rulePath: 'vscode:mergecore.privacy.extraExclusions',
    }));
}

export interface LoadAllPrivacyRulesOptions {
  readonly workspaceRoot: string;
  readonly globalConfigPath?: string;
  readonly vscodeExtraExclusions?: readonly string[];
  /** When true, skip reading the real global config (tests). */
  readonly skipGlobalFile?: boolean;
}

export function loadAllPrivacyRules(
  options: LoadAllPrivacyRulesOptions
): {
  readonly rules: readonly PrivacyRule[];
  readonly overrides: PrivacyOverridesFile;
} {
  const rules: PrivacyRule[] = [...defaultPrivacyRules()];
  if (!options.skipGlobalFile) {
    const globalPath = options.globalConfigPath ?? globalPrivacyConfigPath();
    const globalFile = loadPrivacyRulesFile(globalPath, 'global');
    if (globalFile) {
      rules.push(...globalFile.rules);
    }
  }
  const workspacePath = workspacePrivacyConfigPath(options.workspaceRoot);
  const workspaceFile = loadPrivacyRulesFile(workspacePath, 'workspace');
  if (workspaceFile) {
    rules.push(...workspaceFile.rules);
  }
  if (options.vscodeExtraExclusions?.length) {
    rules.push(...vscodeExtraExclusionRules(options.vscodeExtraExclusions));
  }
  return {
    rules,
    overrides: loadPrivacyOverrides(options.workspaceRoot),
  };
}
