import * as fs from 'fs/promises';
import * as path from 'path';
import { classifyContextPath, isAdrPath, isAgentsOrClaude } from './classify';
import { contentHash } from './markdown-sections';
import { parseFrontmatter, normalisePath } from './frontmatter';
import type { ContextDocument } from './types';

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'coverage',
  '.next',
  '.turbo',
  'vendor',
  'rag',
]);

export interface DiscoverContextOptions {
  readonly workspaceRoot: string;
  readonly configuredPaths?: readonly string[];
  readonly contextDirectory?: string;
  readonly signal?: AbortSignal;
}

/**
 * Discover repository context files (AGENTS, CLAUDE, README, ADRs, Cursor rules, docs).
 */
export async function discoverContextDocuments(
  options: DiscoverContextOptions
): Promise<ContextDocument[]> {
  const root = path.resolve(options.workspaceRoot);
  const contextDir = options.contextDirectory ?? '.mergecore/context';
  const found = new Map<string, ContextDocument>();

  const add = async (
    rel: string,
    flags: { userConfigured?: boolean; underGeneratedMemory?: boolean } = {}
  ): Promise<void> => {
    const normalised = normalisePath(rel);
    if (found.has(normalised)) {
      if (flags.userConfigured) {
        const prev = found.get(normalised)!;
        found.set(normalised, { ...prev, userConfigured: true });
      }
      return;
    }
    const abs = path.join(root, normalised);
    let content: string;
    try {
      content = await fs.readFile(abs, 'utf8');
    } catch {
      return;
    }
    const classification = classifyContextPath(normalised, flags);
    const { frontmatter, bodyStartLine } = parseFrontmatter(content);
    // Frontmatter can mark a shareable-path file as MergeCore-generated
    let documentType = classification.documentType;
    let authored = classification.authored;
    let binding = classification.binding;
    const genBy = frontmatter?.fields?.generated_by ?? frontmatter?.fields?.generatedBy;
    const statusField = frontmatter?.fields?.status;
    if (
      (genBy === 'mergecore' || typeof statusField === 'string') &&
      (flags.underGeneratedMemory ||
        normalised.includes('.mergecore/generated/') ||
        (typeof statusField === 'string' &&
          ['generated', 'reviewed', 'approved', 'rejected', 'stale'].includes(
            String(statusField)
          ) &&
          genBy === 'mergecore'))
    ) {
      documentType = 'generated_memory';
      authored = 'generated';
      binding = 'generated';
    }
    const lines = content.split(/\r?\n/);
    const title =
      (frontmatter?.description as string | undefined) ||
      basename(normalised) ||
      normalised;
    found.set(normalised, {
      id: `ctx:${normalised}`,
      path: normalised,
      title,
      documentType,
      scope: classification.scope,
      authored,
      classificationConfidence: classification.classificationConfidence,
      binding,
      userConfigured: flags.userConfigured === true,
      frontmatter,
      contentHash: contentHash(content),
      startLine: bodyStartLine,
      endLine: Math.max(1, lines.length),
    });
  };

  // Nested AGENTS.md / CLAUDE.md
  for (const rel of await walkMatching(root, '', (_rel, base) => isAgentsOrClaude(base.toLowerCase()), options.signal)) {
    await add(rel);
  }

  // README variants + CONTRIBUTING at any depth (bounded)
  for (const rel of await walkMatching(
    root,
    '',
    (_rel, base) => {
      const lower = base.toLowerCase();
      return (
        /^readme(\.[a-z0-9]+)?\.md$/i.test(lower) ||
        lower === 'contributing.md' ||
        lower === '.cursorrules'
      );
    },
    options.signal
  )) {
    await add(rel);
  }

  // docs/**/*.md
  await walkDir(path.join(root, 'docs'), 'docs', async (rel) => {
    if (rel.toLowerCase().endsWith('.md')) {
      await add(rel);
    }
  }, options.signal);

  // ADR locations
  for (const adrRoot of ['docs/adr', 'docs/adrs', 'adr', 'architecture/decisions']) {
    await walkDir(path.join(root, adrRoot), adrRoot, async (rel) => {
      if (rel.toLowerCase().endsWith('.md') || isAdrPath(rel)) {
        await add(rel);
      }
    }, options.signal);
  }

  // .cursor/rules/**/*.md and *.mdc
  await walkDir(path.join(root, '.cursor', 'rules'), '.cursor/rules', async (rel) => {
    const lower = rel.toLowerCase();
    if (lower.endsWith('.md') || lower.endsWith('.mdc')) {
      await add(rel);
    }
  }, options.signal);

  // MergeCore context directory (human) + shareable memory + generated memory
  await walkDir(path.join(root, contextDir), contextDir, async (rel) => {
    if (rel.toLowerCase().endsWith('.md')) {
      await add(rel);
    }
  }, options.signal);

  await walkDir(path.join(root, '.mergecore', 'memory'), '.mergecore/memory', async (rel) => {
    if (rel.toLowerCase().endsWith('.md')) {
      await add(rel);
    }
  }, options.signal);

  await walkDir(
    path.join(root, '.mergecore', 'generated'),
    '.mergecore/generated',
    async (rel) => {
      if (rel.toLowerCase().endsWith('.md')) {
        await add(rel, { underGeneratedMemory: true });
      }
    },
    options.signal
  );

  // User-configured paths
  for (const configured of options.configuredPaths ?? []) {
    const rel = normalisePath(configured);
    await add(rel, { userConfigured: true });
  }

  return [...found.values()].sort((a, b) => a.path.localeCompare(b.path));
}

async function walkMatching(
  absRoot: string,
  relBase: string,
  predicate: (rel: string, base: string) => boolean,
  signal?: AbortSignal
): Promise<string[]> {
  const out: string[] = [];
  async function recurse(abs: string, rel: string): Promise<void> {
    if (signal?.aborted) {
      return;
    }
    let entries: Array<{ name: string; isDirectory(): boolean; isFile(): boolean }>;
    try {
      entries = (await fs.readdir(abs, { withFileTypes: true })) as Array<{
        name: string;
        isDirectory(): boolean;
        isFile(): boolean;
      }>;
    } catch {
      return;
    }
    for (const entry of entries) {
      if (signal?.aborted) {
        return;
      }
      const name = String(entry.name);
      if (SKIP_DIRS.has(name) || (name.startsWith('.') && name !== '.cursor' && name !== '.mergecore')) {
        if (name !== '.cursor' && name !== '.mergecore') {
          continue;
        }
      }
      const childRel = rel ? `${rel}/${name}` : name;
      const childAbs = path.join(abs, name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(name)) {
          continue;
        }
        await recurse(childAbs, childRel);
      } else if (entry.isFile() && predicate(childRel, name)) {
        out.push(normalisePath(childRel));
      }
    }
  }
  await recurse(absRoot, relBase);
  return out;
}

async function walkDir(
  abs: string,
  relBase: string,
  onFile: (rel: string) => Promise<void>,
  signal?: AbortSignal
): Promise<void> {
  let entries: Array<{ name: string; isDirectory(): boolean; isFile(): boolean }>;
  try {
    entries = (await fs.readdir(abs, { withFileTypes: true })) as Array<{
      name: string;
      isDirectory(): boolean;
      isFile(): boolean;
    }>;
  } catch {
    return;
  }
  for (const entry of entries) {
    if (signal?.aborted) {
      return;
    }
    const name = String(entry.name);
    if (SKIP_DIRS.has(name)) {
      continue;
    }
    const childRel = `${relBase}/${name}`;
    const childAbs = path.join(abs, name);
    if (entry.isDirectory()) {
      await walkDir(childAbs, childRel, onFile, signal);
    } else if (entry.isFile()) {
      await onFile(normalisePath(childRel));
    }
  }
}

function basename(p: string): string {
  const n = normalisePath(p);
  const i = n.lastIndexOf('/');
  return i >= 0 ? n.slice(i + 1) : n;
}
