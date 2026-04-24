import * as fs from 'fs/promises';
import * as path from 'path';
import type {
  JavascriptStackInfo,
  PhpStackInfo,
  ProjectConvention,
  ProjectProfile,
} from './types';
import { emptyJsStack, emptyPhpStack } from './types';

export interface DetectorContext {
  readonly workspaceRoot: string;
  readonly php: PhpStackInfo;
  readonly javascript: JavascriptStackInfo;
  /** Detectors append stable tags (e.g. path:artisan). */
  readonly extraSignals: string[];
  /**
   * Detected project conventions. Detectors push to this list as they find
   * evidence; duplicates (same id) keep the highest-confidence entry.
   */
  readonly conventions: ProjectConvention[];
  /**
   * Recursively list workspace files whose path matches at least one of the
   * given lowercase glob-ish fragments (simple substring match on the
   * relative path, normalised to forward slashes). Bounded at `limit` to
   * keep detection cheap on large monorepos. Binary / heavy directories
   * (node_modules, vendor, .git, …) are excluded automatically.
   */
  listFiles(fragments: readonly string[], limit?: number): Promise<readonly string[]>;
  exists(rel: string): Promise<boolean>;
  readUtf8(rel: string): Promise<string | undefined>;
  readJson<T>(rel: string): Promise<T | undefined>;
}

/**
 * Directories we skip when walking the workspace. Keeps detection cheap on
 * large monorepos and prevents node_modules / vendor heuristics from
 * accidentally counting third-party patterns as project conventions.
 */
const WALK_EXCLUDE = new Set<string>([
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
]);

/** Hard cap on files walked even when a detector asks for more. */
const WALK_HARD_LIMIT = 5000;

export function createDetectorContext(workspaceRoot: string): DetectorContext {
  const php = emptyPhpStack();
  const javascript = emptyJsStack();
  const extraSignals: string[] = [];
  const conventions: ProjectConvention[] = [];
  const walkCache: { files: string[] | undefined } = { files: undefined };

  async function exists(rel: string): Promise<boolean> {
    try {
      await fs.access(path.join(workspaceRoot, rel));
      return true;
    } catch {
      return false;
    }
  }

  async function readUtf8(rel: string): Promise<string | undefined> {
    try {
      return await fs.readFile(path.join(workspaceRoot, rel), 'utf8');
    } catch {
      return undefined;
    }
  }

  async function readJson<T>(rel: string): Promise<T | undefined> {
    const raw = await readUtf8(rel);
    if (raw === undefined) {
      return undefined;
    }
    try {
      return JSON.parse(raw) as T;
    } catch {
      return undefined;
    }
  }

  async function walk(): Promise<readonly string[]> {
    if (walkCache.files !== undefined) {
      return walkCache.files;
    }
    const out: string[] = [];
    async function recurse(dirRel: string): Promise<void> {
      if (out.length >= WALK_HARD_LIMIT) {
        return;
      }
      let entries: ReadonlyArray<{ name: string; isDirectory: boolean; isFile: boolean }>;
      try {
        const raw = await fs.readdir(path.join(workspaceRoot, dirRel), { withFileTypes: true });
        entries = raw.map((e) => ({
          name: e.name,
          isDirectory: e.isDirectory(),
          isFile: e.isFile(),
        }));
      } catch {
        return;
      }
      for (const entry of entries) {
        if (out.length >= WALK_HARD_LIMIT) {
          return;
        }
        if (entry.name.startsWith('.DS_Store')) {
          continue;
        }
        const rel = dirRel ? `${dirRel}/${entry.name}` : entry.name;
        if (entry.isDirectory) {
          if (WALK_EXCLUDE.has(entry.name) || entry.name.startsWith('.')) {
            continue;
          }
          await recurse(rel);
        } else if (entry.isFile) {
          out.push(rel);
        }
      }
    }
    await recurse('');
    walkCache.files = out;
    return out;
  }

  async function listFiles(fragments: readonly string[], limit = 200): Promise<readonly string[]> {
    if (fragments.length === 0) {
      return [];
    }
    const all = await walk();
    const needles = fragments.map((f) => f.toLowerCase()).filter((f) => f.length > 0);
    if (needles.length === 0) {
      return [];
    }
    const out: string[] = [];
    for (const rel of all) {
      const lower = rel.toLowerCase();
      if (needles.some((n) => lower.includes(n))) {
        out.push(rel);
        if (out.length >= limit) {
          break;
        }
      }
    }
    return out;
  }

  return {
    workspaceRoot,
    php,
    javascript,
    extraSignals,
    conventions,
    listFiles,
    exists,
    readUtf8,
    readJson,
  };
}

function dedupeConventions(list: readonly ProjectConvention[]): ProjectConvention[] {
  const byId = new Map<string, ProjectConvention>();
  const weight: Record<ProjectConvention['confidence'], number> = { high: 3, medium: 2, low: 1 };
  for (const c of list) {
    const existing = byId.get(c.id);
    if (!existing || weight[c.confidence] > weight[existing.confidence]) {
      byId.set(c.id, c);
    }
  }
  return [...byId.values()].sort((a, b) => {
    const delta = weight[b.confidence] - weight[a.confidence];
    if (delta !== 0) {
      return delta;
    }
    return a.id.localeCompare(b.id);
  });
}

function collectSignals(php: PhpStackInfo, js: JavascriptStackInfo, extra: string[]): string[] {
  const s = new Set<string>(extra);
  if (php.hasComposerJson) {
    s.add('php:composer');
  }
  if (php.filament) {
    s.add('filament');
  }
  if (php.livewire) {
    s.add('livewire');
  }
  if (php.pest) {
    s.add('pest');
  }
  if (php.phpunit) {
    s.add('phpunit');
  }
  if (js.hasPackageJson) {
    s.add('js:package-json');
  }
  if (js.typeScript) {
    s.add('typescript');
  }
  if (js.react) {
    s.add('react');
  }
  if (js.vue) {
    s.add('vue');
  }
  if (js.vite) {
    s.add('vite');
  }
  if (js.inertia) {
    s.add('inertia');
  }
  return [...s].sort((a, b) => a.localeCompare(b));
}

function buildFingerprint(signals: readonly string[]): string {
  return signals.join('|') || 'generic';
}

export function finalizeProfile(ctx: DetectorContext): ProjectProfile {
  const conventions = dedupeConventions(ctx.conventions);
  // Namespace convention signals so they can't clash with stack signals and
  // so existing detectors that look for e.g. "react" keep working.
  for (const c of conventions) {
    ctx.extraSignals.push(`convention:${c.id}`);
  }
  const signals = collectSignals(ctx.php, ctx.javascript, ctx.extraSignals);
  return {
    workspaceRoot: ctx.workspaceRoot,
    collectedAt: Date.now(),
    stacks: {
      php: { ...ctx.php },
      javascript: { ...ctx.javascript },
    },
    signals,
    conventions,
    fingerprint: buildFingerprint(signals),
  };
}
