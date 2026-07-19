import type { DependencyEdgeKind } from '../../contracts/types';
import { parseTaskContextDepth } from '../task-context-budgets';
import { getBuiltinTemplate, slugifyName } from './builtins';
import { isKnownSectionId } from './section-catalog';
import type {
  ContextPackTemplate,
  TemplateParseIssue,
  TemplateParseResult,
  TemplatePrioritiseHint,
  TemplateRetrievalSettings,
  TemplateSourceType,
} from './types';
import {
  TEMPLATE_BUDGET_CEILING,
  TEMPLATE_FORBIDDEN_KEYS,
} from './types';

const EDGE_KINDS = new Set<string>([
  'import',
  'require',
  'export',
  'reference',
  'call',
  'extends',
  'implements',
  'typeUsage',
  'fileDependency',
  'likelyTestCoverage',
  'route',
  'job',
  'event',
  'integration',
  'documentation',
]);

const SOURCE_TYPES = new Set<string>([
  'source',
  'symbol',
  'instruction',
  'architecture',
  'dependency',
  'test',
  'memory',
  'documentation',
]);

const PRIORITISE = new Set<string>([
  'instructions',
  'architecture',
  'authentication',
  'network_calls',
  'database_writes',
  'tests',
  'integrations',
  'routes',
  'public_apis',
  'callers',
  'callees',
  'migrations',
  'config',
  'symptoms',
  'coverage',
]);

/**
 * Parse a context-pack template Markdown file (YAML frontmatter + optional body).
 * Forbidden privacy/validation keys are reported as conflicts and never applied.
 */
export function parseContextPackTemplateMarkdown(
  content: string,
  options: {
    readonly idHint?: string;
    readonly source?: 'builtin' | 'workspace';
    readonly filePath?: string;
    readonly inheritFrom?: ContextPackTemplate;
  } = {}
): TemplateParseResult {
  const issues: TemplateParseIssue[] = [];
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) {
    return {
      ok: false,
      issues: [
        {
          code: 'malformed',
          message: 'Template must start with YAML frontmatter delimited by ---',
          path: options.filePath,
        },
      ],
    };
  }

  let tree: Record<string, unknown>;
  try {
    tree = parseSimpleYaml(match[1] ?? '');
  } catch (err) {
    return {
      ok: false,
      issues: [
        {
          code: 'malformed',
          message: `Invalid frontmatter: ${err instanceof Error ? err.message : String(err)}`,
          path: options.filePath,
        },
      ],
    };
  }

  for (const key of Object.keys(tree)) {
    if ((TEMPLATE_FORBIDDEN_KEYS as readonly string[]).includes(key)) {
      issues.push({
        code: 'privacy_conflict',
        message: `Template must not set "${key}" — privacy controls and source validation cannot be disabled`,
        path: key,
      });
      delete tree[key];
    }
  }
  const retrievalRaw = asRecord(tree.retrieval);
  if (retrievalRaw) {
    for (const key of Object.keys(retrievalRaw)) {
      if ((TEMPLATE_FORBIDDEN_KEYS as readonly string[]).includes(key)) {
        issues.push({
          code: 'privacy_conflict',
          message: `Template retrieval must not set "${key}"`,
          path: `retrieval.${key}`,
        });
        delete retrievalRaw[key];
      }
    }
  }

  const inherit = options.inheritFrom;
  const name =
    asString(tree.name) ??
    inherit?.name ??
    (options.idHint ? humanise(options.idHint) : undefined);
  if (!name) {
    issues.push({
      code: 'missing_name',
      message: 'Template frontmatter requires name',
    });
  }

  const id =
    asString(tree.id) ??
    options.idHint ??
    (name ? slugifyName(name) : undefined) ??
    'custom-template';

  const sectionIds = asStringList(tree.sections);
  if (sectionIds.length === 0 && !inherit?.sections.length) {
    issues.push({
      code: 'missing_sections',
      message: 'Template frontmatter requires a non-empty sections list',
    });
  }
  const sections =
    sectionIds.length > 0 ? sectionIds : [...(inherit?.sections ?? [])];
  for (const s of sections) {
    if (!isKnownSectionId(s)) {
      issues.push({
        code: 'unknown_section',
        message: `Unknown section id "${s}" — will render with a derived title`,
        path: s,
      });
    }
  }

  const baseRetrieval = inherit?.retrieval;
  const depth = parseTaskContextDepth(
    asString(retrievalRaw?.depth) ?? baseRetrieval?.depth ?? 'standard'
  );
  let dependencyDepth =
    asNumber(retrievalRaw?.dependency_depth ?? retrievalRaw?.dependencyDepth) ??
    baseRetrieval?.dependencyDepth ??
    (depth === 'deep' ? 3 : depth === 'shallow' ? 1 : 2);
  if (dependencyDepth > TEMPLATE_BUDGET_CEILING.maxDependencyDepth) {
    issues.push({
      code: 'budget_clamped',
      message: `dependency_depth clamped to ${TEMPLATE_BUDGET_CEILING.maxDependencyDepth}`,
      path: 'retrieval.dependency_depth',
    });
    dependencyDepth = TEMPLATE_BUDGET_CEILING.maxDependencyDepth;
  }
  if (dependencyDepth < 0) dependencyDepth = 0;

  const prioritise = (
    asStringList(retrievalRaw?.prioritise ?? retrievalRaw?.prioritize).length > 0
      ? asStringList(retrievalRaw?.prioritise ?? retrievalRaw?.prioritize)
      : [...(baseRetrieval?.prioritise ?? [])]
  ).filter((p): p is TemplatePrioritiseHint => PRIORITISE.has(p));

  let maxChars =
    asNumber(retrievalRaw?.max_chars ?? retrievalRaw?.maxChars) ??
    asNumber(tree.max_context_budget ?? tree.maxContextBudget) ??
    baseRetrieval?.maxChars ??
    inherit?.maxContextBudget;
  if (maxChars !== undefined && maxChars > TEMPLATE_BUDGET_CEILING.maxChars) {
    issues.push({
      code: 'budget_clamped',
      message: `max_chars clamped to ${TEMPLATE_BUDGET_CEILING.maxChars}`,
      path: 'retrieval.max_chars',
    });
    maxChars = TEMPLATE_BUDGET_CEILING.maxChars;
  }

  const retrieval: TemplateRetrievalSettings = {
    depth,
    dependencyDepth,
    prioritise,
    maxFiles: clampOpt(
      asNumber(retrievalRaw?.max_files ?? retrievalRaw?.maxFiles) ??
        baseRetrieval?.maxFiles,
      TEMPLATE_BUDGET_CEILING.maxFiles,
      issues,
      'retrieval.max_files'
    ),
    maxSymbols: clampOpt(
      asNumber(retrievalRaw?.max_symbols ?? retrievalRaw?.maxSymbols) ??
        baseRetrieval?.maxSymbols,
      TEMPLATE_BUDGET_CEILING.maxSymbols,
      issues,
      'retrieval.max_symbols'
    ),
    maxChunks: clampOpt(
      asNumber(retrievalRaw?.max_chunks ?? retrievalRaw?.maxChunks) ??
        baseRetrieval?.maxChunks,
      TEMPLATE_BUDGET_CEILING.maxChunks,
      issues,
      'retrieval.max_chunks'
    ),
    maxChars,
    k: clampOpt(
      asNumber(retrievalRaw?.k) ?? baseRetrieval?.k,
      TEMPLATE_BUDGET_CEILING.k,
      issues,
      'retrieval.k'
    ),
  };

  const preferredRelationshipKinds = (
    asStringList(
      tree.preferred_relationship_kinds ??
        tree.preferredRelationshipKinds ??
        tree.relationship_kinds ??
        tree.relationshipKinds
    ).length > 0
      ? asStringList(
          tree.preferred_relationship_kinds ??
            tree.preferredRelationshipKinds ??
            tree.relationship_kinds ??
            tree.relationshipKinds
        )
      : [...(inherit?.preferredRelationshipKinds ?? [])]
  ).filter((k): k is DependencyEdgeKind => EDGE_KINDS.has(k));

  const sourceTypes = (
    asStringList(tree.source_types ?? tree.sourceTypes).length > 0
      ? asStringList(tree.source_types ?? tree.sourceTypes)
      : [...(inherit?.sourceTypes ?? [])]
  ).filter((s): s is TemplateSourceType => SOURCE_TYPES.has(s));

  const riskCategories =
    asStringList(tree.risk_categories ?? tree.riskCategories).length > 0
      ? asStringList(tree.risk_categories ?? tree.riskCategories)
      : [...(inherit?.riskCategories ?? [])];

  const requireTests = asBool(
    tree.require_tests ?? tree.requireTests,
    inherit?.requireTests ?? false
  );
  const prioritiseArchitecture = asBool(
    tree.prioritise_architecture ??
      tree.prioritize_architecture ??
      tree.prioritiseArchitecture,
    inherit?.prioritiseArchitecture ?? false
  );
  const uncertaintyBlocksCompletion = asBool(
    tree.uncertainty_blocks_completion ?? tree.uncertaintyBlocksCompletion,
    inherit?.uncertaintyBlocksCompletion ?? false
  );

  const bodyGuidance = content.slice(match[0]!.length).trim() || inherit?.bodyGuidance;

  const hasBlocking =
    issues.some((i) => i.code === 'malformed' || i.code === 'missing_name') ||
    sections.length === 0 ||
    !name;

  if (hasBlocking) {
    return { ok: false, issues };
  }

  // Privacy conflicts do not block parse — keys are stripped — but tests can assert them
  const template: ContextPackTemplate = {
    id,
    name: name!,
    description: asString(tree.description) ?? inherit?.description,
    source: options.source ?? 'workspace',
    filePath: options.filePath,
    sections,
    retrieval,
    preferredRelationshipKinds:
      preferredRelationshipKinds.length > 0
        ? preferredRelationshipKinds
        : (inherit?.preferredRelationshipKinds ?? ['call', 'import']),
    sourceTypes:
      sourceTypes.length > 0
        ? sourceTypes
        : (inherit?.sourceTypes ?? ['source', 'symbol', 'instruction', 'test']),
    riskCategories,
    requireTests,
    prioritiseArchitecture,
    uncertaintyBlocksCompletion,
    maxContextBudget: Math.min(
      maxChars ?? inherit?.maxContextBudget ?? 24_000,
      TEMPLATE_BUDGET_CEILING.maxChars
    ),
    bodyGuidance: bodyGuidance || undefined,
  };

  return { ok: true, template, issues };
}

export function serialiseContextPackTemplate(
  template: ContextPackTemplate
): string {
  const lines: string[] = ['---'];
  lines.push(`name: ${yamlScalar(template.name)}`);
  lines.push(`id: ${yamlScalar(template.id)}`);
  if (template.description) {
    lines.push(`description: ${yamlScalar(template.description)}`);
  }
  lines.push('retrieval:');
  lines.push(`  depth: ${template.retrieval.depth}`);
  lines.push(`  dependency_depth: ${template.retrieval.dependencyDepth}`);
  if (template.retrieval.maxChars !== undefined) {
    lines.push(`  max_chars: ${template.retrieval.maxChars}`);
  }
  if (template.retrieval.maxFiles !== undefined) {
    lines.push(`  max_files: ${template.retrieval.maxFiles}`);
  }
  if (template.retrieval.maxSymbols !== undefined) {
    lines.push(`  max_symbols: ${template.retrieval.maxSymbols}`);
  }
  if (template.retrieval.k !== undefined) {
    lines.push(`  k: ${template.retrieval.k}`);
  }
  lines.push('  prioritise:');
  for (const p of template.retrieval.prioritise) {
    lines.push(`    - ${p}`);
  }
  lines.push('sections:');
  for (const s of template.sections) {
    lines.push(`  - ${s}`);
  }
  lines.push('preferred_relationship_kinds:');
  for (const k of template.preferredRelationshipKinds) {
    lines.push(`  - ${k}`);
  }
  lines.push('source_types:');
  for (const s of template.sourceTypes) {
    lines.push(`  - ${s}`);
  }
  lines.push('risk_categories:');
  if (template.riskCategories.length === 0) {
    lines.push('  []');
  } else {
    for (const r of template.riskCategories) {
      lines.push(`  - ${yamlScalar(r)}`);
    }
  }
  lines.push(`require_tests: ${template.requireTests}`);
  lines.push(`prioritise_architecture: ${template.prioritiseArchitecture}`);
  lines.push(
    `uncertainty_blocks_completion: ${template.uncertaintyBlocksCompletion}`
  );
  lines.push(`max_context_budget: ${template.maxContextBudget}`);
  lines.push('---');
  lines.push('');
  if (template.bodyGuidance) {
    lines.push(template.bodyGuidance.trimEnd());
    lines.push('');
  }
  return lines.join('\n');
}

/** Minimal nested YAML subset: maps, lists, scalars. */
export function parseSimpleYaml(raw: string): Record<string, unknown> {
  const root: Record<string, unknown> = {};
  type Frame = { indent: number; container: Record<string, unknown> | unknown[] };
  const stack: Frame[] = [{ indent: -1, container: root }];
  let pendingKey: { indent: number; key: string; parent: Record<string, unknown> } | undefined;

  const lines = raw.split(/\r?\n/);
  for (const line of lines) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const indent = line.match(/^ */)?.[0]?.length ?? 0;
    const trimmed = line.trim();

    while (stack.length > 1 && indent <= stack[stack.length - 1]!.indent) {
      stack.pop();
    }
    const frame = stack[stack.length - 1]!;

    const listItem = trimmed.match(/^-\s+(.*)$/) || (trimmed === '-' ? ['-', ''] : null);
    if (listItem) {
      const valueRaw = listItem[1]!.trim();
      const value =
        valueRaw === '' ? {} : valueRaw === '[]' ? [] : parseScalar(valueRaw);
      if (Array.isArray(frame.container)) {
        frame.container.push(value);
        if (value && typeof value === 'object' && !Array.isArray(value)) {
          stack.push({ indent, container: value as Record<string, unknown> });
        }
      } else if (pendingKey && indent > pendingKey.indent) {
        const arr: unknown[] = [];
        pendingKey.parent[pendingKey.key] = arr;
        arr.push(value);
        stack.push({ indent: pendingKey.indent, container: arr });
        if (value && typeof value === 'object' && !Array.isArray(value)) {
          stack.push({ indent, container: value as Record<string, unknown> });
        }
        pendingKey = undefined;
      } else {
        throw new Error(`Unexpected list item: ${trimmed}`);
      }
      continue;
    }

    const kv = trimmed.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
    if (!kv) continue;
    const key = kv[1]!;
    const rest = kv[2]!.trim();
    const parent = Array.isArray(frame.container)
      ? (frame.container[frame.container.length - 1] as Record<string, unknown>)
      : frame.container;

    if (rest === '' || rest === '|' || rest === '>') {
      pendingKey = { indent, key, parent };
      const child: Record<string, unknown> = {};
      parent[key] = child;
      stack.push({ indent, container: child });
      continue;
    }
    if (rest === '[]') {
      parent[key] = [];
      pendingKey = undefined;
      continue;
    }
    if (rest.startsWith('[') && rest.endsWith(']')) {
      parent[key] = rest
        .slice(1, -1)
        .split(',')
        .map((p) => parseScalar(p.trim()))
        .filter((v) => v !== '');
      pendingKey = undefined;
      continue;
    }
    parent[key] = parseScalar(rest);
    pendingKey = undefined;
  }
  return root;
}

function clampOpt(
  value: number | undefined,
  ceiling: number,
  issues: TemplateParseIssue[],
  path: string
): number | undefined {
  if (value === undefined) return undefined;
  if (value > ceiling) {
    issues.push({
      code: 'budget_clamped',
      message: `${path} clamped to ${ceiling}`,
      path,
    });
    return ceiling;
  }
  return Math.max(0, value);
}

function asRecord(v: unknown): Record<string, unknown> | undefined {
  return v && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : undefined;
}

function asString(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

function asNumber(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() && !Number.isNaN(Number(v))) {
    return Number(v);
  }
  return undefined;
}

function asBool(v: unknown, fallback: boolean): boolean {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') {
    if (/^(true|yes|1)$/i.test(v)) return true;
    if (/^(false|no|0)$/i.test(v)) return false;
  }
  return fallback;
}

function asStringList(v: unknown): string[] {
  if (!v) return [];
  if (Array.isArray(v)) {
    return v.map((x) => String(x).trim()).filter(Boolean);
  }
  if (typeof v === 'string') return [v.trim()].filter(Boolean);
  return [];
}

function parseScalar(raw: string): string | number | boolean {
  if (/^(true|yes)$/i.test(raw)) return true;
  if (/^(false|no)$/i.test(raw)) return false;
  if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
  return stripQuotes(raw);
}

function stripQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function yamlScalar(value: string): string {
  if (/[:#\[\]{},\n]/.test(value) || value.includes(' ')) {
    return JSON.stringify(value);
  }
  return value;
}

function humanise(id: string): string {
  return id
    .split(/[-_]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/** Inherit missing fields from a builtin when workspace template is partial. */
export function inheritBuiltinDefaults(
  partial: ContextPackTemplate,
  builtinId?: string
): ContextPackTemplate {
  const base =
    getBuiltinTemplate(builtinId ?? partial.id) ??
    getBuiltinTemplate('new-feature')!;
  return {
    ...base,
    ...partial,
    retrieval: {
      ...base.retrieval,
      ...partial.retrieval,
      prioritise:
        partial.retrieval.prioritise.length > 0
          ? partial.retrieval.prioritise
          : base.retrieval.prioritise,
    },
    sections: partial.sections.length > 0 ? partial.sections : base.sections,
    preferredRelationshipKinds:
      partial.preferredRelationshipKinds.length > 0
        ? partial.preferredRelationshipKinds
        : base.preferredRelationshipKinds,
    sourceTypes:
      partial.sourceTypes.length > 0 ? partial.sourceTypes : base.sourceTypes,
    riskCategories:
      partial.riskCategories.length > 0
        ? partial.riskCategories
        : base.riskCategories,
    source: partial.source,
    filePath: partial.filePath,
    maxContextBudget: Math.min(
      partial.maxContextBudget || base.maxContextBudget,
      TEMPLATE_BUDGET_CEILING.maxChars
    ),
  };
}
