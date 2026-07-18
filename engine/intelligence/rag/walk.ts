import type { IgnoreMatcher } from '../ignore/resolve-ignore';

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
  '.mjs',
  '.cjs',
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

/** Extensions that are treated as binary / non-indexable even if listed elsewhere. */
const BINARY_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.ico',
  '.pdf',
  '.zip',
  '.gz',
  '.tar',
  '.woff',
  '.woff2',
  '.ttf',
  '.eot',
  '.mp4',
  '.mp3',
  '.wasm',
  '.exe',
  '.dll',
  '.so',
  '.dylib',
]);

export function shouldIndexPath(relPath: string): boolean {
  const normalised = relPath.replace(/\\/g, '/');
  const base = normalised.split('/').pop() ?? normalised;
  const lowerBase = base.toLowerCase();
  const dot = lowerBase.lastIndexOf('.');
  if (dot >= 0) {
    const ext = lowerBase.slice(dot);
    if (BINARY_EXTENSIONS.has(ext)) {
      return false;
    }
  }
  if (INDEX_BASENAMES.has(base)) {
    return true;
  }
  const lower = normalised.toLowerCase();
  if (lower.endsWith('.blade.php')) {
    return true;
  }
  if (dot < 0) {
    return false;
  }
  const ext = lowerBase.slice(dot);
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
  if (p.startsWith('src/')) return 65;
  if (p.endsWith('.ts') || p.endsWith('.tsx') || p.endsWith('.js') || p.endsWith('.jsx')) return 60;
  return 40;
}

export interface WalkIndexableOptions {
  readonly ignoreMatcher?: IgnoreMatcher;
}

export async function walkIndexableFiles(
  workspaceRoot: string,
  fs: {
    readdir: (
      path: string,
      opts: { withFileTypes: true }
    ) => Promise<
      ReadonlyArray<{
        name: string;
        isDirectory(): boolean;
        isFile(): boolean;
        isSymbolicLink?: () => boolean;
      }>
    >;
    realpath?: (path: string) => Promise<string>;
  },
  pathJoin: (...parts: string[]) => string,
  options: WalkIndexableOptions = {}
): Promise<string[]> {
  const out: string[] = [];
  const ignoreMatcher = options.ignoreMatcher;
  let rootReal = workspaceRoot;
  if (fs.realpath) {
    try {
      rootReal = await fs.realpath(workspaceRoot);
    } catch {
      rootReal = workspaceRoot;
    }
  }

  async function isOutsideWorkspace(absPath: string): Promise<boolean> {
    if (!fs.realpath) {
      return false;
    }
    try {
      const real = await fs.realpath(absPath);
      const rel = real.startsWith(rootReal)
        ? real.slice(rootReal.length).replace(/^[\\/]/, '')
        : undefined;
      if (rel === undefined && real !== rootReal) {
        // path.relative style check
        const pathMod = await import('path');
        const r = pathMod.relative(rootReal, real);
        return r.startsWith('..') || pathMod.isAbsolute(r);
      }
      return false;
    } catch {
      return true;
    }
  }

  async function recurse(dirRel: string): Promise<void> {
    if (out.length >= WALK_HARD_LIMIT) {
      return;
    }
    let entries: ReadonlyArray<{
      name: string;
      isDirectory(): boolean;
      isFile(): boolean;
      isSymbolicLink?: () => boolean;
    }>;
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
      const normalised = rel.replace(/\\/g, '/');

      if (ignoreMatcher?.ignores(normalised)) {
        continue;
      }
      // Directory patterns in gitignore often omit trailing slash; also check as dir
      if (entry.isDirectory() && ignoreMatcher?.ignores(`${normalised}/`)) {
        continue;
      }

      const abs = pathJoin(workspaceRoot, rel);
      if (entry.isSymbolicLink?.()) {
        if (await isOutsideWorkspace(abs)) {
          continue;
        }
      }

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
        out.push(rel.replace(/\\/g, '/'));
      }
    }
  }

  await recurse('');
  return out.sort((a, b) => indexPriority(b) - indexPriority(a) || a.localeCompare(b));
}
