import {
  MEMORY_SCHEMA_VERSION,
  MEMORY_STATUSES,
  type MemoryFrontmatter,
  type MemorySourceRef,
  type MemoryStatus,
} from './types';

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

export interface ParsedMemoryDocument {
  readonly frontmatter?: MemoryFrontmatter;
  readonly body: string;
  readonly bodyStartLine: number;
  readonly raw: string;
  readonly malformed: boolean;
  readonly errors: readonly string[];
}

/**
 * Parse MergeCore memory frontmatter (status, sources, confidence, etc.).
 * Malformed files return `malformed: true` with best-effort body.
 */
export function parseMemoryDocument(content: string): ParsedMemoryDocument {
  const match = content.match(FRONTMATTER_RE);
  if (!match) {
    return {
      body: content,
      bodyStartLine: 1,
      raw: content,
      malformed: false,
      errors: [],
    };
  }

  const rawBlock = match[1] ?? '';
  const errors: string[] = [];
  try {
    const parsed = parseSimpleYaml(rawBlock);
    const statusRaw = String(parsed.status ?? 'generated');
    const status = (MEMORY_STATUSES as readonly string[]).includes(statusRaw)
      ? (statusRaw as MemoryStatus)
      : undefined;
    if (!status) {
      errors.push(`invalid-status:${statusRaw}`);
    }

    const sources = normaliseSources(parsed.sources);
    const confidence =
      parsed.confidence !== undefined ? Number(parsed.confidence) : undefined;
    if (
      confidence !== undefined &&
      (Number.isNaN(confidence) || confidence < 0 || confidence > 1)
    ) {
      errors.push('invalid-confidence');
    }

    const schemaVersion = Number(
      parsed.schema_version ?? parsed.schemaVersion ?? MEMORY_SCHEMA_VERSION
    );
    if (!Number.isFinite(schemaVersion)) {
      errors.push('invalid-schema_version');
    }

    const frontmatter: MemoryFrontmatter = {
      generatedBy:
        parsed.generated_by !== undefined
          ? String(parsed.generated_by)
          : parsed.generatedBy !== undefined
            ? String(parsed.generatedBy)
            : undefined,
      generatedAt:
        parsed.generated_at !== undefined
          ? String(parsed.generated_at)
          : parsed.generatedAt !== undefined
            ? String(parsed.generatedAt)
            : undefined,
      schemaVersion: Number.isFinite(schemaVersion)
        ? schemaVersion
        : MEMORY_SCHEMA_VERSION,
      status: status ?? 'generated',
      confidence:
        confidence !== undefined && !Number.isNaN(confidence)
          ? confidence
          : undefined,
      sources,
      fields: parsed,
    };

    const consumed = match[0] ?? '';
    const bodyStartLine = Math.max(1, consumed.split(/\r?\n/).length);
    return {
      frontmatter,
      body: content.slice(consumed.length),
      bodyStartLine,
      raw: content,
      malformed: errors.length > 0,
      errors,
    };
  } catch (err) {
    return {
      body: content.slice((match[0] ?? '').length),
      bodyStartLine: Math.max(1, (match[0] ?? '').split(/\r?\n/).length),
      raw: content,
      malformed: true,
      errors: [`parse-error:${err instanceof Error ? err.message : String(err)}`],
    };
  }
}

/** Serialise memory frontmatter + body. Never drops sources. */
export function serialiseMemoryDocument(
  frontmatter: MemoryFrontmatter,
  body: string
): string {
  const lines: string[] = ['---'];
  if (frontmatter.generatedBy) {
    lines.push(`generated_by: ${frontmatter.generatedBy}`);
  }
  if (frontmatter.generatedAt) {
    lines.push(`generated_at: ${frontmatter.generatedAt}`);
  }
  lines.push(`schema_version: ${frontmatter.schemaVersion}`);
  lines.push(`status: ${frontmatter.status}`);
  if (frontmatter.confidence !== undefined) {
    lines.push(`confidence: ${frontmatter.confidence}`);
  }
  lines.push('sources:');
  if (frontmatter.sources.length === 0) {
    lines.push('  []');
  } else {
    for (const s of frontmatter.sources) {
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
  const trimmedBody = body.replace(/^\n+/, '');
  return `${lines.join('\n')}${trimmedBody.endsWith('\n') ? trimmedBody : `${trimmedBody}\n`}`;
}

export function isGeneratedMemoryFrontmatter(
  fm: MemoryFrontmatter | undefined
): boolean {
  if (!fm) return false;
  return fm.generatedBy === 'mergecore' || MEMORY_STATUSES.includes(fm.status);
}

function normaliseSources(raw: unknown): MemorySourceRef[] {
  if (!Array.isArray(raw)) return [];
  const out: MemorySourceRef[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const pathVal = o.path ?? o.file;
    if (typeof pathVal !== 'string' || !pathVal.trim()) continue;
    const start = Number(o.start_line ?? o.startLine ?? 1);
    const end = Number(o.end_line ?? o.endLine ?? start);
    const fingerprint =
      typeof o.fingerprint === 'string' ? o.fingerprint : undefined;
    out.push({
      path: pathVal.replace(/\\/g, '/'),
      startLine: Number.isFinite(start) ? start : 1,
      endLine: Number.isFinite(end) ? end : 1,
      fingerprint,
    });
  }
  return out;
}

/**
 * Minimal YAML subset for memory frontmatter: flat keys + list-of-maps under `sources`.
 */
export function parseSimpleYaml(text: string): Record<string, unknown> {
  const root: Record<string, unknown> = {};
  let currentList: Record<string, unknown>[] | undefined;
  let currentItem: Record<string, unknown> | undefined;

  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;

    const listStart = line.match(/^\s*-\s+([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
    const emptyList = line.match(/^\s*-\s*$/);
    const nested = line.match(/^\s{2,}([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
    const top = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);

    if (listStart && currentList) {
      currentItem = {};
      currentItem[listStart[1]!] = coerce(listStart[2]!.trim());
      currentList.push(currentItem);
      continue;
    }
    if (emptyList && currentList) {
      currentItem = {};
      currentList.push(currentItem);
      continue;
    }
    if (nested && currentList && currentItem && line.startsWith(' ')) {
      currentItem[nested[1]!] = coerce(nested[2]!.trim());
      continue;
    }

    if (top && !line.startsWith(' ')) {
      currentList = undefined;
      currentItem = undefined;
      const key = top[1]!;
      const value = top[2]!.trim();
      if (value === '' || value === '|' || value === '>') {
        if (key === 'sources') {
          currentList = [];
          root[key] = currentList;
        } else {
          root[key] = {};
        }
      } else if (value === '[]') {
        root[key] = [];
      } else {
        root[key] = coerce(value);
      }
    }
  }

  return root;
}

function coerce(value: string): unknown {
  if (/^(true|yes)$/i.test(value)) return true;
  if (/^(false|no)$/i.test(value)) return false;
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
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
