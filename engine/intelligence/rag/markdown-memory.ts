import * as fs from 'fs/promises';
import * as path from 'path';
import { chunkFile, isPriorityMemoryPath } from './chunker';
import { sha256 } from './hash';
import type { RagStore } from './store';

/** Project-level engineering memory filenames (case-insensitive match on basename). */
export const PRIORITY_MEMORY_BASENAMES = [
  'README.md',
  'architecture.md',
  'decisions.md',
  'agents.md',
  'AGENTS.md',
  'contributing.md',
  'coding-standards.md',
  '.cursorrules',
] as const;

export interface MarkdownMemoryOptions {
  readonly workspaceRoot: string;
  readonly store: RagStore;
  readonly isLaravel?: boolean;
  /** Absolute or workspace-relative path to extension-bundled laravel-core agents.md */
  readonly laravelAgentsPath?: string;
}

/**
 * Ingest priority markdown / rules files with elevated retrieval weight.
 * When Laravel is detected, also ingest pack `agents.md` if a path is provided.
 */
export async function ingestMarkdownMemory(opts: MarkdownMemoryOptions): Promise<number> {
  const { workspaceRoot, store } = opts;
  let ingested = 0;

  for (const name of PRIORITY_MEMORY_BASENAMES) {
    const rel = await findCaseInsensitive(workspaceRoot, name);
    if (!rel) {
      continue;
    }
    const ok = await ingestPath(workspaceRoot, store, rel);
    if (ok) {
      ingested++;
    }
  }

  // `.mergecore/**/*.md` memory
  const mergecoreDir = path.join(workspaceRoot, '.mergecore');
  try {
    const entries = await walkMd(mergecoreDir, '.mergecore');
    for (const rel of entries) {
      if (rel.includes('/rag/')) {
        continue;
      }
      const ok = await ingestPath(workspaceRoot, store, rel);
      if (ok) {
        ingested++;
      }
    }
  } catch {
    // no .mergecore folder
  }

  if (opts.isLaravel && opts.laravelAgentsPath) {
    try {
      const content = await fs.readFile(opts.laravelAgentsPath, 'utf8');
      const virtualPath = 'mergecore://packs/laravel-core/agents.md';
      const hash = sha256(content);
      const existing = store.getFile(virtualPath);
      if (!existing || existing.hash !== hash) {
        const chunks = chunkFile(virtualPath, content, 'memory').map((c) => ({
          ...c,
          weight: Math.max(c.weight, 2.2),
          kind: 'memory' as const,
        }));
        store.replaceFile(virtualPath, hash, Date.now(), chunks);
        ingested++;
      }
    } catch {
      // pack memory optional
    }
  }

  return ingested;
}

async function ingestPath(
  workspaceRoot: string,
  store: RagStore,
  relPath: string
): Promise<boolean> {
  const abs = path.join(workspaceRoot, relPath);
  let content: string;
  let stat: { mtimeMs: number };
  try {
    content = await fs.readFile(abs, 'utf8');
    const s = await fs.stat(abs);
    stat = { mtimeMs: s.mtimeMs };
  } catch {
    return false;
  }
  const hash = sha256(content);
  const existing = store.getFile(relPath);
  if (existing && existing.hash === hash) {
    return false;
  }
  const kind = isPriorityMemoryPath(relPath) ? 'memory' : 'memory';
  const chunks = chunkFile(relPath, content, kind);
  store.replaceFile(relPath, hash, stat.mtimeMs, chunks);
  return true;
}

async function findCaseInsensitive(
  workspaceRoot: string,
  basename: string
): Promise<string | undefined> {
  // Direct hit at repo root
  const direct = path.join(workspaceRoot, basename);
  try {
    await fs.access(direct);
    return basename;
  } catch {
    // fall through
  }

  // Case-insensitive scan of root only
  try {
    const entries = await fs.readdir(workspaceRoot);
    const target = basename.toLowerCase();
    const hit = entries.find((e) => e.toLowerCase() === target);
    return hit;
  } catch {
    return undefined;
  }
}

async function walkMd(absDir: string, relBase: string): Promise<string[]> {
  const out: string[] = [];
  let names: string[];
  try {
    names = await fs.readdir(absDir);
  } catch {
    return out;
  }
  for (const name of names) {
    const abs = path.join(absDir, name);
    const rel = `${relBase}/${name}`;
    let st: Awaited<ReturnType<typeof fs.stat>>;
    try {
      st = await fs.stat(abs);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      if (name === 'rag') {
        continue;
      }
      out.push(...(await walkMd(abs, rel)));
    } else if (st.isFile() && name.toLowerCase().endsWith('.md')) {
      out.push(rel);
    }
  }
  return out;
}
