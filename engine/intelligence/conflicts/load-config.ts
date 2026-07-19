import * as fs from 'fs';
import * as path from 'path';
import type {
  ConflictIgnoreEntry,
  ConflictRule,
  ConflictRuleSource,
  ExtractedConflictRule,
  ExtractedRuleStatus,
  ConflictDetectorKind,
} from './types';

const DETECTORS = new Set<ConflictDetectorKind>([
  'forbidden_imports',
  'required_abstraction',
  'prohibited_directory_deps',
  'naming_rules',
  'required_test_location',
  'direct_database_access',
  'network_provider_access',
  'environment_variable_access',
]);

export function conflictRulesPath(workspaceRoot: string): string {
  return path.join(workspaceRoot, '.mergecore', 'conflict-rules.json');
}

export function extractedConflictRulesPath(workspaceRoot: string): string {
  return path.join(workspaceRoot, '.mergecore', 'extracted-conflict-rules.json');
}

export function conflictIgnoresPath(workspaceRoot: string): string {
  return path.join(workspaceRoot, '.mergecore', 'conflict-ignores.json');
}

export interface ConflictRulesFile {
  readonly schemaVersion: number;
  readonly rules: readonly ConflictRule[];
}

export interface ExtractedConflictRulesFile {
  readonly schemaVersion: number;
  readonly rules: readonly ExtractedConflictRule[];
}

export interface ConflictIgnoresFile {
  readonly schemaVersion: number;
  readonly ignores: readonly ConflictIgnoreEntry[];
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0);
}

function parseSource(raw: unknown): ConflictRuleSource | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const o = raw as Record<string, unknown>;
  if (typeof o.path !== 'string') return undefined;
  return {
    path: o.path.replace(/\\/g, '/'),
    ...(typeof o.line === 'number' ? { line: o.line } : {}),
    ...(typeof o.startLine === 'number' ? { startLine: o.startLine } : {}),
    ...(typeof o.endLine === 'number' ? { endLine: o.endLine } : {}),
  };
}

function parseDetector(raw: unknown): ConflictDetectorKind | undefined {
  return typeof raw === 'string' && DETECTORS.has(raw as ConflictDetectorKind)
    ? (raw as ConflictDetectorKind)
    : undefined;
}

function inferDetector(obj: Record<string, unknown>): ConflictDetectorKind | undefined {
  if (obj.forbidden_imports || obj.forbiddenImports) return 'forbidden_imports';
  if (obj.required_abstractions || obj.requiredAbstractions) return 'required_abstraction';
  if (obj.prohibited_directories || obj.prohibitedDirectories) {
    return 'prohibited_directory_deps';
  }
  if (obj.naming_pattern || obj.namingPattern) return 'naming_rules';
  if (obj.required_test_globs || obj.requiredTestGlobs) return 'required_test_location';
  if (obj.database_access_patterns || obj.databaseAccessPatterns) {
    return 'direct_database_access';
  }
  if (obj.network_provider_patterns || obj.networkProviderPatterns) {
    return 'network_provider_access';
  }
  if (obj.environment_variable_patterns || obj.environmentVariablePatterns) {
    return 'environment_variable_access';
  }
  return undefined;
}

export function parseConflictRule(raw: unknown, userConfirmed = false): ConflictRule | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const obj = raw as Record<string, unknown>;
  const id = typeof obj.id === 'string' ? obj.id.trim() : '';
  const description =
    typeof obj.description === 'string'
      ? obj.description.trim()
      : typeof obj.text === 'string'
        ? obj.text.trim()
        : '';
  if (!id || !description) return undefined;

  const detector =
    parseDetector(obj.detector) ??
    parseDetector(obj.kind) ??
    inferDetector(obj);
  if (!detector) return undefined;

  const appliesTo = asStringArray(obj.applies_to ?? obj.appliesTo);
  if (appliesTo.length === 0) return undefined;

  return {
    id,
    description,
    appliesTo,
    enabled: obj.enabled !== false,
    detector,
    forbiddenImports: asStringArray(obj.forbidden_imports ?? obj.forbiddenImports),
    requiredAbstractions: asStringArray(
      obj.required_abstractions ?? obj.requiredAbstractions
    ),
    prohibitedDirectories: asStringArray(
      obj.prohibited_directories ?? obj.prohibitedDirectories
    ),
    namingPattern:
      typeof obj.naming_pattern === 'string'
        ? obj.naming_pattern
        : typeof obj.namingPattern === 'string'
          ? obj.namingPattern
          : undefined,
    namingMustMatch:
      obj.naming_must_match === false || obj.namingMustMatch === false ? false : true,
    requiredTestGlobs: asStringArray(obj.required_test_globs ?? obj.requiredTestGlobs),
    databaseAccessPatterns: asStringArray(
      obj.database_access_patterns ?? obj.databaseAccessPatterns
    ),
    networkProviderPatterns: asStringArray(
      obj.network_provider_patterns ?? obj.networkProviderPatterns
    ),
    environmentVariablePatterns: asStringArray(
      obj.environment_variable_patterns ?? obj.environmentVariablePatterns
    ),
    source: parseSource(obj.source),
    userConfirmed:
      userConfirmed || obj.user_confirmed === true || obj.userConfirmed === true,
  };
}

export function loadConflictRulesFile(workspaceRoot: string): ConflictRulesFile {
  const filePath = conflictRulesPath(workspaceRoot);
  try {
    if (!fs.existsSync(filePath)) {
      return { schemaVersion: 1, rules: [] };
    }
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown;
    if (!raw || typeof raw !== 'object') {
      return { schemaVersion: 1, rules: [] };
    }
    const obj = raw as Record<string, unknown>;
    const rulesRaw = Array.isArray(obj.rules) ? obj.rules : [];
    const rules: ConflictRule[] = [];
    for (const r of rulesRaw) {
      const parsed = parseConflictRule(r, false);
      if (parsed) rules.push(parsed);
    }
    return {
      schemaVersion: typeof obj.schemaVersion === 'number' ? obj.schemaVersion : 1,
      rules,
    };
  } catch {
    return { schemaVersion: 1, rules: [] };
  }
}

export function loadExtractedConflictRules(
  workspaceRoot: string
): ExtractedConflictRulesFile {
  const filePath = extractedConflictRulesPath(workspaceRoot);
  try {
    if (!fs.existsSync(filePath)) {
      return { schemaVersion: 1, rules: [] };
    }
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown;
    if (!raw || typeof raw !== 'object') {
      return { schemaVersion: 1, rules: [] };
    }
    const obj = raw as Record<string, unknown>;
    const rulesRaw = Array.isArray(obj.rules) ? obj.rules : [];
    const rules: ExtractedConflictRule[] = [];
    for (const r of rulesRaw) {
      const parsed = parseExtractedRule(r);
      if (parsed) rules.push(parsed);
    }
    return {
      schemaVersion: typeof obj.schemaVersion === 'number' ? obj.schemaVersion : 1,
      rules,
    };
  } catch {
    return { schemaVersion: 1, rules: [] };
  }
}

function parseExtractedStatus(v: unknown): ExtractedRuleStatus {
  if (v === 'confirmed' || v === 'disabled' || v === 'edited' || v === 'pending') {
    return v;
  }
  return 'pending';
}

function parseExtractedRule(raw: unknown): ExtractedConflictRule | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const obj = raw as Record<string, unknown>;
  const id = typeof obj.id === 'string' ? obj.id : '';
  const originalText = typeof obj.originalText === 'string' ? obj.originalText : '';
  const description =
    typeof obj.description === 'string' ? obj.description : originalText;
  const sourceRaw = obj.source;
  if (!id || !originalText || !sourceRaw || typeof sourceRaw !== 'object') {
    return undefined;
  }
  const s = sourceRaw as Record<string, unknown>;
  if (typeof s.path !== 'string' || typeof s.startLine !== 'number') {
    return undefined;
  }
  const endLine = typeof s.endLine === 'number' ? s.endLine : s.startLine;
  return {
    id,
    status: parseExtractedStatus(obj.status),
    originalText,
    description,
    source: {
      path: s.path.replace(/\\/g, '/'),
      startLine: s.startLine,
      endLine,
      line: s.startLine,
    },
    appliesTo: asStringArray(obj.appliesTo ?? obj.applies_to),
    suggestedDetector: parseDetector(obj.suggestedDetector),
    suggestedFields:
      obj.suggestedFields && typeof obj.suggestedFields === 'object'
        ? (obj.suggestedFields as ExtractedConflictRule['suggestedFields'])
        : undefined,
    ambiguous: obj.ambiguous === true,
    fromGeneratedMemory: obj.fromGeneratedMemory === true,
  };
}

export function saveExtractedConflictRules(
  workspaceRoot: string,
  file: ExtractedConflictRulesFile
): void {
  const filePath = extractedConflictRulesPath(workspaceRoot);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(file, null, 2)}\n`, 'utf8');
}

export function updateExtractedRuleStatus(
  workspaceRoot: string,
  ruleId: string,
  status: ExtractedRuleStatus,
  edits?: Partial<ExtractedConflictRule>
): ExtractedConflictRule | undefined {
  const current = loadExtractedConflictRules(workspaceRoot);
  const next = current.rules.map((r) => {
    if (r.id !== ruleId) return r;
    return {
      ...r,
      ...edits,
      status,
      id: r.id,
      originalText: r.originalText,
      source: r.source,
    };
  });
  saveExtractedConflictRules(workspaceRoot, {
    schemaVersion: 1,
    rules: next,
  });
  return next.find((r) => r.id === ruleId);
}

export function loadConflictIgnores(workspaceRoot: string): ConflictIgnoresFile {
  const filePath = conflictIgnoresPath(workspaceRoot);
  try {
    if (!fs.existsSync(filePath)) {
      return { schemaVersion: 1, ignores: [] };
    }
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown;
    if (!raw || typeof raw !== 'object') {
      return { schemaVersion: 1, ignores: [] };
    }
    const obj = raw as Record<string, unknown>;
    const ignoresRaw = Array.isArray(obj.ignores) ? obj.ignores : [];
    const ignores: ConflictIgnoreEntry[] = [];
    for (const i of ignoresRaw) {
      if (!i || typeof i !== 'object') continue;
      const e = i as Record<string, unknown>;
      if (typeof e.conflictId !== 'string' || typeof e.ruleId !== 'string') continue;
      ignores.push({
        conflictId: e.conflictId,
        ruleId: e.ruleId,
        paths: asStringArray(e.paths),
        ignoredAt:
          typeof e.ignoredAt === 'string' ? e.ignoredAt : new Date().toISOString(),
        reason: typeof e.reason === 'string' ? e.reason : undefined,
      });
    }
    return {
      schemaVersion: typeof obj.schemaVersion === 'number' ? obj.schemaVersion : 1,
      ignores,
    };
  } catch {
    return { schemaVersion: 1, ignores: [] };
  }
}

export function saveConflictIgnore(
  workspaceRoot: string,
  entry: ConflictIgnoreEntry
): void {
  const current = loadConflictIgnores(workspaceRoot);
  const next: ConflictIgnoresFile = {
    schemaVersion: 1,
    ignores: [
      ...current.ignores.filter((i) => i.conflictId !== entry.conflictId),
      entry,
    ],
  };
  const filePath = conflictIgnoresPath(workspaceRoot);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
}

/** Convert a confirmed/edited extraction into a scannable ConflictRule. */
export function extractedToConflictRule(
  extracted: ExtractedConflictRule
): ConflictRule | undefined {
  if (extracted.status !== 'confirmed' && extracted.status !== 'edited') {
    return undefined;
  }
  if (extracted.ambiguous || extracted.fromGeneratedMemory) {
    return undefined;
  }
  if (!extracted.suggestedDetector || extracted.appliesTo.length === 0) {
    return undefined;
  }
  const fields = extracted.suggestedFields ?? {};
  return {
    id: extracted.id,
    description: extracted.description,
    appliesTo: extracted.appliesTo,
    enabled: true,
    detector: extracted.suggestedDetector,
    forbiddenImports: fields.forbiddenImports ?? [],
    requiredAbstractions: fields.requiredAbstractions ?? [],
    prohibitedDirectories: fields.prohibitedDirectories ?? [],
    namingPattern: fields.namingPattern,
    namingMustMatch: fields.namingMustMatch,
    requiredTestGlobs: fields.requiredTestGlobs ?? [],
    databaseAccessPatterns: fields.databaseAccessPatterns ?? [],
    networkProviderPatterns: fields.networkProviderPatterns ?? [],
    environmentVariablePatterns: fields.environmentVariablePatterns ?? [],
    source: extracted.source,
    userConfirmed: true,
  };
}
