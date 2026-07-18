import type { TaskContextMeta, TaskContextSourceRef } from './task-context-types';
import { TASK_CONTEXT_SCHEMA_VERSION } from './task-context-types';

export interface TaskContextFrontmatter {
  readonly task: string;
  readonly generatedBy: string;
  readonly generatedAt: string;
  readonly schemaVersion: number;
  readonly indexRevision: string;
  readonly retrieval: {
    readonly depth: string;
    readonly k: number;
    readonly maxFiles: number;
    readonly maxSymbols: number;
    readonly maxChars: number;
  };
  readonly selectedFiles: readonly string[];
  readonly selectedSymbols: readonly string[];
  readonly confidence: number;
  readonly sources: readonly TaskContextSourceRef[];
  readonly modelProvider: string;
  readonly dataLeftMachine: boolean;
}

export function metaToFrontmatter(meta: TaskContextMeta): TaskContextFrontmatter {
  return {
    task: meta.task,
    generatedBy: 'mergecore',
    generatedAt: meta.generatedAt,
    schemaVersion: TASK_CONTEXT_SCHEMA_VERSION,
    indexRevision: meta.indexRevision,
    retrieval: {
      depth: meta.depth,
      k: meta.k,
      maxFiles: meta.budgets.maxFiles,
      maxSymbols: meta.budgets.maxSymbols,
      maxChars: meta.budgets.maxChars,
    },
    selectedFiles: meta.selectedFiles,
    selectedSymbols: meta.selectedSymbols,
    confidence: meta.confidence,
    sources: meta.sources,
    modelProvider: meta.modelProvider,
    dataLeftMachine: meta.dataLeftMachine,
  };
}

export function serialiseTaskContextDocument(
  frontmatter: TaskContextFrontmatter,
  bodyMarkdown: string
): string {
  const lines: string[] = ['---'];
  lines.push(`task: ${yamlScalar(frontmatter.task)}`);
  lines.push(`generated_by: ${frontmatter.generatedBy}`);
  lines.push(`generated_at: ${frontmatter.generatedAt}`);
  lines.push(`schema_version: ${frontmatter.schemaVersion}`);
  lines.push(`index_revision: ${yamlScalar(frontmatter.indexRevision)}`);
  lines.push('retrieval:');
  lines.push(`  depth: ${frontmatter.retrieval.depth}`);
  lines.push(`  k: ${frontmatter.retrieval.k}`);
  lines.push(`  max_files: ${frontmatter.retrieval.maxFiles}`);
  lines.push(`  max_symbols: ${frontmatter.retrieval.maxSymbols}`);
  lines.push(`  max_chars: ${frontmatter.retrieval.maxChars}`);
  lines.push('selected_files:');
  if (frontmatter.selectedFiles.length === 0) {
    lines.push('  []');
  } else {
    for (const f of frontmatter.selectedFiles) {
      lines.push(`  - ${yamlScalar(f)}`);
    }
  }
  lines.push('selected_symbols:');
  if (frontmatter.selectedSymbols.length === 0) {
    lines.push('  []');
  } else {
    for (const s of frontmatter.selectedSymbols) {
      lines.push(`  - ${yamlScalar(s)}`);
    }
  }
  lines.push(`confidence: ${frontmatter.confidence}`);
  lines.push(`model_provider: ${yamlScalar(frontmatter.modelProvider)}`);
  lines.push(`data_left_machine: ${frontmatter.dataLeftMachine}`);
  lines.push('sources:');
  if (frontmatter.sources.length === 0) {
    lines.push('  []');
  } else {
    for (const s of frontmatter.sources.slice(0, 80)) {
      lines.push(`  - path: ${yamlScalar(s.path)}`);
      lines.push(`    start_line: ${s.startLine}`);
      lines.push(`    end_line: ${s.endLine}`);
      if (s.fingerprint) {
        lines.push(`    fingerprint: ${yamlScalar(s.fingerprint)}`);
      }
    }
  }
  lines.push('---');
  lines.push('');
  const body = bodyMarkdown.replace(/^\n+/, '');
  return `${lines.join('\n')}${body.endsWith('\n') ? body : `${body}\n`}`;
}

export function parseTaskContextFrontmatter(content: string): {
  readonly frontmatter?: Partial<TaskContextFrontmatter>;
  readonly body: string;
  readonly ok: boolean;
} {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) {
    return { body: content, ok: false };
  }
  const block = match[1] ?? '';
  const fields: Record<string, string> = {};
  for (const line of block.split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z0-9_]+)\s*:\s*(.*)$/);
    if (kv && !line.startsWith(' ')) {
      fields[kv[1]!] = stripQuotes(kv[2]!.trim());
    }
  }
  return {
    ok: Boolean(fields.task && fields.generated_by),
    frontmatter: {
      task: fields.task,
      generatedBy: fields.generated_by,
      generatedAt: fields.generated_at,
      schemaVersion: fields.schema_version
        ? Number(fields.schema_version)
        : undefined,
      indexRevision: fields.index_revision,
      confidence: fields.confidence ? Number(fields.confidence) : undefined,
      modelProvider: fields.model_provider,
      dataLeftMachine: fields.data_left_machine === 'true',
    },
    body: content.slice(match[0]!.length),
  };
}

function yamlScalar(value: string): string {
  if (/[:#\[\]{},\n]/.test(value) || value.includes(' ')) {
    return JSON.stringify(value);
  }
  return value;
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

export function slugifyTask(task: string): string {
  const s = task
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return s || 'task';
}

export function compactTimestamp(iso = new Date().toISOString()): string {
  return iso.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}
