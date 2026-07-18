import type { ContextDocumentFrontmatter } from './types';

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

/**
 * Parse simple YAML-like frontmatter (Cursor rules / mdc style).
 * Supports `globs:`, `description:`, `alwaysApply:`, and list items under globs.
 */
export function parseFrontmatter(content: string): {
  readonly frontmatter?: ContextDocumentFrontmatter;
  readonly body: string;
  readonly bodyStartLine: number;
} {
  const match = content.match(FRONTMATTER_RE);
  if (!match) {
    return { body: content, bodyStartLine: 1 };
  }
  const raw = match[1] ?? '';
  const fields: Record<string, unknown> = {};
  const globs: string[] = [];
  let description: string | undefined;
  let alwaysApply: boolean | undefined;
  let currentList: string[] | undefined;

  for (const line of raw.split(/\r?\n/)) {
    const listItem = line.match(/^\s*-\s+(.+)\s*$/);
    if (listItem && currentList) {
      const item = stripQuotes(listItem[1]!.trim());
      currentList.push(item);
      continue;
    }
    currentList = undefined;

    const kv = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
    if (!kv) {
      continue;
    }
    const key = kv[1]!;
    const value = kv[2]!.trim();
    if (key === 'globs') {
      if (value === '' || value === '|' || value === '>') {
        currentList = globs;
        fields.globs = globs;
      } else if (value.startsWith('[') && value.endsWith(']')) {
        const inner = value.slice(1, -1);
        for (const part of inner.split(',')) {
          const g = stripQuotes(part.trim());
          if (g) {
            globs.push(g);
          }
        }
        fields.globs = globs;
      } else {
        const g = stripQuotes(value);
        if (g) {
          globs.push(g);
        }
        fields.globs = globs;
      }
      continue;
    }
    if (key === 'description') {
      description = stripQuotes(value);
      fields.description = description;
      continue;
    }
    if (key === 'alwaysApply') {
      alwaysApply = /^(true|yes|1)$/i.test(value);
      fields.alwaysApply = alwaysApply;
      continue;
    }
    fields[key] = stripQuotes(value);
  }

  const fm: ContextDocumentFrontmatter = {
    raw,
    fields,
    globs: globs.length > 0 ? globs : undefined,
    description,
    alwaysApply,
  };

  const consumed = match[0] ?? '';
  const bodyStartLine = consumed.split(/\r?\n/).length;
  const body = content.slice(consumed.length);
  return { frontmatter: fm, body, bodyStartLine: Math.max(1, bodyStartLine) };
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

/**
 * Match a relative file path against Cursor-style glob patterns.
 * Supports `**`, `*`, and `{a,b}` loosely.
 */
export function pathMatchesGlob(filePath: string, globPattern: string): boolean {
  const file = normalisePath(filePath);
  const pattern = normalisePath(globPattern);
  const regex = globToRegExp(pattern);
  return regex.test(file);
}

export function normalisePath(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.\//, '');
}

function globToRegExp(glob: string): RegExp {
  let g = glob;
  // Expand {a,b}
  g = g.replace(/\{([^}]+)\}/g, (_m, inner: string) => {
    const alts = inner.split(',').map((s) => escapeRegex(s.trim())).join('|');
    return `(?:${alts})`;
  });
  let out = '';
  for (let i = 0; i < g.length; i++) {
    const ch = g[i]!;
    if (ch === '*' && g[i + 1] === '*') {
      out += '.*';
      i++;
      if (g[i + 1] === '/') {
        i++;
      }
      continue;
    }
    if (ch === '*') {
      out += '[^/]*';
      continue;
    }
    if (ch === '?') {
      out += '[^/]';
      continue;
    }
    out += escapeRegex(ch);
  }
  return new RegExp(`^${out}$`, 'i');
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
