/**
 * Directories skipped when indexing. Mirrors DetectorContext walk exclusions
 * plus `.mergecore/rag` itself so we never index our own store.
 */
export const RAG_WALK_EXCLUDE = new Set<string>([
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
  'rag',
]);

const INDEX_EXTENSIONS = new Set([
  '.php',
  '.md',
  '.markdown',
  '.json',
  '.yml',
  '.yaml',
  '.env.example',
  '.cursorrules',
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.vue',
  '.blade.php',
]);

const INDEX_BASENAMES = new Set([
  'composer.json',
  'package.json',
  'artisan',
  '.cursorrules',
  'AGENTS.md',
  'agents.md',
  'README.md',
  'readme.md',
]);

const WALK_HARD_LIMIT = 8000;

export function shouldIndexPath(relPath: string): boolean {
  const normalised = relPath.replace(/\\/g, '/');
  const base = normalised.split('/').pop() ?? normalised;
  if (INDEX_BASENAMES.has(base)) {
    return true;
  }
  const lower = normalised.toLowerCase();
  if (lower.endsWith('.blade.php')) {
    return true;
  }
  const dot = base.lastIndexOf('.');
  if (dot < 0) {
    return false;
  }
  const ext = base.slice(dot).toLowerCase();
  return INDEX_EXTENSIONS.has(ext);
}

/** Prefer Laravel PHP layout; still allow other indexable files. */
export function indexPriority(relPath: string): number {
  const p = relPath.replace(/\\/g, '/').toLowerCase();
  if (p.startsWith('app/')) return 100;
  if (p.startsWith('routes/')) return 95;
  if (p.startsWith('database/')) return 90;
  if (p.startsWith('tests/') || p.startsWith('test/')) return 85;
  if (p.startsWith('config/')) return 80;
  if (p.endsWith('.md') || p.includes('.mergecore/')) return 75;
  if (p.endsWith('.php')) return 70;
  return 40;
}

export async function walkIndexableFiles(
  workspaceRoot: string,
  fs: {
    readdir: (
      path: string,
      opts: { withFileTypes: true }
    ) => Promise<ReadonlyArray<{ name: string; isDirectory(): boolean; isFile(): boolean }>>;
  },
  pathJoin: (...parts: string[]) => string
): Promise<string[]> {
  const out: string[] = [];

  async function recurse(dirRel: string): Promise<void> {
    if (out.length >= WALK_HARD_LIMIT) {
      return;
    }
    let entries: ReadonlyArray<{ name: string; isDirectory(): boolean; isFile(): boolean }>;
    try {
      entries = await fs.readdir(pathJoin(workspaceRoot, dirRel), { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (out.length >= WALK_HARD_LIMIT) {
        return;
      }
      if (entry.name === '.DS_Store') {
        continue;
      }
      const rel = dirRel ? `${dirRel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        // Allow `.mergecore` for memory markdown, but skip its rag store.
        if (entry.name === '.mergecore') {
          await recurse(rel);
          continue;
        }
        if (RAG_WALK_EXCLUDE.has(entry.name) || entry.name.startsWith('.')) {
          continue;
        }
        await recurse(rel);
      } else if (entry.isFile() && shouldIndexPath(rel)) {
        out.push(rel);
      }
    }
  }

  await recurse('');
  return out.sort((a, b) => indexPriority(b) - indexPriority(a) || a.localeCompare(b));
}
