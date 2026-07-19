import * as fs from 'fs/promises';
import * as path from 'path';
import { DEFAULT_TEMPLATE_PATH, TEMPLATES_DIR } from '../../memory/paths';
import { budgetsForDepth } from '../task-context-budgets';
import type { TaskContextDepth } from '../task-context-types';
import {
  getBuiltinTemplate,
  listBuiltinTemplates,
  slugifyName,
} from './builtins';
import {
  inheritBuiltinDefaults,
  parseContextPackTemplateMarkdown,
  serialiseContextPackTemplate,
} from './parse';
import type {
  ContextPackTemplate,
  ResolveTemplatesOptions,
  TemplateCustomiseInput,
  TemplateParseIssue,
  TemplatePreview,
} from './types';
import { TEMPLATE_BUDGET_CEILING } from './types';

export interface LoadedTemplates {
  readonly builtins: readonly ContextPackTemplate[];
  readonly workspace: readonly ContextPackTemplate[];
  readonly defaultId: string;
  readonly issues: readonly TemplateParseIssue[];
}

export async function listContextPackTemplates(
  workspaceRoot: string
): Promise<LoadedTemplates> {
  const builtins = listBuiltinTemplates();
  const issues: TemplateParseIssue[] = [];
  const workspace: ContextPackTemplate[] = [];
  const dir = path.join(workspaceRoot, TEMPLATES_DIR);
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const ent of entries) {
      if (!ent.isFile()) continue;
      if (ent.name === 'default' || ent.name.startsWith('.')) continue;
      if (!/\.(md|markdown|yml|yaml)$/i.test(ent.name)) continue;
      const abs = path.join(dir, ent.name);
      const raw = await fs.readFile(abs, 'utf8');
      const idHint = slugifyName(ent.name.replace(/\.(md|markdown|yml|yaml)$/i, ''));
      const parsed = parseContextPackTemplateMarkdown(raw, {
        idHint,
        source: 'workspace',
        filePath: path.posix.join(TEMPLATES_DIR, ent.name.replace(/\\/g, '/')),
        inheritFrom: getBuiltinTemplate(idHint) ?? getBuiltinTemplate('new-feature'),
      });
      issues.push(...parsed.issues);
      if (parsed.ok && parsed.template) {
        workspace.push(inheritBuiltinDefaults(parsed.template, idHint));
      }
    }
  } catch {
    // no templates dir yet
  }

  const defaultId = await readWorkspaceDefaultTemplateId(workspaceRoot);
  return { builtins, workspace, defaultId, issues };
}

export async function readWorkspaceDefaultTemplateId(
  workspaceRoot: string
): Promise<string> {
  try {
    const raw = await fs.readFile(
      path.join(workspaceRoot, DEFAULT_TEMPLATE_PATH),
      'utf8'
    );
    const id = raw.trim().split(/\r?\n/)[0]?.trim();
    if (id) return id;
  } catch {
    // fall through
  }
  return 'new-feature';
}

export async function setWorkspaceDefaultTemplate(
  workspaceRoot: string,
  templateId: string
): Promise<void> {
  const dir = path.join(workspaceRoot, TEMPLATES_DIR);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(workspaceRoot, DEFAULT_TEMPLATE_PATH),
    `${templateId.trim()}\n`,
    'utf8'
  );
}

export async function resolveContextPackTemplate(
  options: ResolveTemplatesOptions
): Promise<{
  readonly template: ContextPackTemplate;
  readonly issues: readonly TemplateParseIssue[];
}> {
  const loaded = await listContextPackTemplates(options.workspaceRoot);
  const wanted =
    options.templateId?.trim() ||
    options.customise?.baseId?.trim() ||
    loaded.defaultId;

  let base =
    loaded.workspace.find((t) => t.id === wanted) ??
    loaded.builtins.find((t) => t.id === wanted) ??
    getBuiltinTemplate(wanted) ??
    getBuiltinTemplate(loaded.defaultId) ??
    getBuiltinTemplate('new-feature')!;

  if (options.customise) {
    base = customiseTemplate(base, options.customise);
  }

  return { template: base, issues: loaded.issues };
}

export function customiseTemplate(
  base: ContextPackTemplate,
  input: Partial<TemplateCustomiseInput>
): ContextPackTemplate {
  const retrieval = {
    ...base.retrieval,
    ...input.retrieval,
    prioritise:
      input.retrieval?.prioritise && input.retrieval.prioritise.length > 0
        ? input.retrieval.prioritise
        : base.retrieval.prioritise,
    dependencyDepth: Math.min(
      input.retrieval?.dependencyDepth ?? base.retrieval.dependencyDepth,
      TEMPLATE_BUDGET_CEILING.maxDependencyDepth
    ),
    maxChars: Math.min(
      input.retrieval?.maxChars ??
        input.maxContextBudget ??
        base.retrieval.maxChars ??
        base.maxContextBudget,
      TEMPLATE_BUDGET_CEILING.maxChars
    ),
    maxFiles:
      input.retrieval?.maxFiles !== undefined
        ? Math.min(input.retrieval.maxFiles, TEMPLATE_BUDGET_CEILING.maxFiles)
        : base.retrieval.maxFiles,
    maxSymbols:
      input.retrieval?.maxSymbols !== undefined
        ? Math.min(input.retrieval.maxSymbols, TEMPLATE_BUDGET_CEILING.maxSymbols)
        : base.retrieval.maxSymbols,
    maxChunks:
      input.retrieval?.maxChunks !== undefined
        ? Math.min(input.retrieval.maxChunks, TEMPLATE_BUDGET_CEILING.maxChunks)
        : base.retrieval.maxChunks,
    k:
      input.retrieval?.k !== undefined
        ? Math.min(input.retrieval.k, TEMPLATE_BUDGET_CEILING.k)
        : base.retrieval.k,
  };

  const maxContextBudget = Math.min(
    input.maxContextBudget ?? retrieval.maxChars ?? base.maxContextBudget,
    TEMPLATE_BUDGET_CEILING.maxChars
  );

  return {
    ...base,
    id: input.id?.trim() || base.id,
    name: input.name?.trim() || base.name,
    sections: input.sections && input.sections.length > 0 ? input.sections : base.sections,
    retrieval,
    preferredRelationshipKinds:
      input.preferredRelationshipKinds && input.preferredRelationshipKinds.length > 0
        ? input.preferredRelationshipKinds
        : base.preferredRelationshipKinds,
    sourceTypes:
      input.sourceTypes && input.sourceTypes.length > 0
        ? input.sourceTypes
        : base.sourceTypes,
    riskCategories:
      input.riskCategories !== undefined ? input.riskCategories : base.riskCategories,
    requireTests: input.requireTests ?? base.requireTests,
    prioritiseArchitecture:
      input.prioritiseArchitecture ?? base.prioritiseArchitecture,
    uncertaintyBlocksCompletion:
      input.uncertaintyBlocksCompletion ?? base.uncertaintyBlocksCompletion,
    maxContextBudget,
    bodyGuidance: input.bodyGuidance ?? base.bodyGuidance,
    source: 'workspace',
  };
}

export function previewContextPackTemplate(
  template: ContextPackTemplate
): TemplatePreview {
  const depthBudgets = budgetsForDepth(template.retrieval.depth);
  const maxFiles = Math.min(
    template.retrieval.maxFiles ?? depthBudgets.budgets.maxFiles,
    TEMPLATE_BUDGET_CEILING.maxFiles
  );
  const maxSymbols = Math.min(
    template.retrieval.maxSymbols ?? depthBudgets.budgets.maxSymbols,
    TEMPLATE_BUDGET_CEILING.maxSymbols
  );
  const maxChunks = Math.min(
    template.retrieval.maxChunks ?? depthBudgets.budgets.maxChunks,
    TEMPLATE_BUDGET_CEILING.maxChunks
  );
  const maxChars = Math.min(
    template.retrieval.maxChars ?? template.maxContextBudget,
    TEMPLATE_BUDGET_CEILING.maxChars
  );
  const k = Math.min(
    template.retrieval.k ?? depthBudgets.k,
    TEMPLATE_BUDGET_CEILING.k
  );
  const notes: string[] = [
    'Templates control organisation and retrieval priorities only.',
    'Privacy controls and source validation cannot be disabled by templates.',
  ];
  if (template.uncertaintyBlocksCompletion) {
    notes.push('Unresolved uncertainty marks the pack incomplete.');
  }
  if (template.requireTests) {
    notes.push('Test discovery is required for this template.');
  }
  return {
    template,
    retrieval: {
      depth: template.retrieval.depth,
      dependencyDepth: Math.min(
        template.retrieval.dependencyDepth,
        TEMPLATE_BUDGET_CEILING.maxDependencyDepth
      ),
      maxFiles,
      maxSymbols,
      maxChunks,
      maxChars,
      k,
      prioritise: [...template.retrieval.prioritise],
    },
    sections: [...template.sections],
    preferredRelationshipKinds: [...template.preferredRelationshipKinds],
    sourceTypes: [...template.sourceTypes],
    riskCategories: [...template.riskCategories],
    requireTests: template.requireTests,
    prioritiseArchitecture: template.prioritiseArchitecture,
    uncertaintyBlocksCompletion: template.uncertaintyBlocksCompletion,
    notes,
  };
}

export async function saveContextPackTemplate(
  workspaceRoot: string,
  template: ContextPackTemplate,
  options: { readonly filename?: string; readonly setDefault?: boolean } = {}
): Promise<{ readonly relativePath: string }> {
  const dir = path.join(workspaceRoot, TEMPLATES_DIR);
  await fs.mkdir(dir, { recursive: true });
  const filename = options.filename ?? `${template.id}.md`;
  const safe = filename.replace(/[^a-zA-Z0-9._-]+/g, '-');
  const abs = path.join(dir, safe);
  await fs.writeFile(abs, serialiseContextPackTemplate(template), 'utf8');
  if (options.setDefault) {
    await setWorkspaceDefaultTemplate(workspaceRoot, template.id);
  }
  return { relativePath: path.posix.join(TEMPLATES_DIR, safe) };
}

export function budgetsFromTemplate(template: ContextPackTemplate): {
  readonly depth: TaskContextDepth;
  readonly budgets: {
    readonly maxFiles: number;
    readonly maxSymbols: number;
    readonly maxChunks: number;
    readonly maxDependencyDepth: number;
    readonly maxChars: number;
    readonly maxTokensApprox: number;
  };
  readonly k: number;
} {
  const preview = previewContextPackTemplate(template);
  const depth = preview.retrieval.depth;
  const base = budgetsForDepth(depth);
  return {
    depth,
    budgets: {
      maxFiles: preview.retrieval.maxFiles,
      maxSymbols: preview.retrieval.maxSymbols,
      maxChunks: preview.retrieval.maxChunks,
      maxDependencyDepth: preview.retrieval.dependencyDepth,
      maxChars: preview.retrieval.maxChars,
      maxTokensApprox: Math.min(
        Math.ceil(preview.retrieval.maxChars / 4),
        TEMPLATE_BUDGET_CEILING.maxTokensApprox
      ),
    },
    k: preview.retrieval.k || base.k,
  };
}
