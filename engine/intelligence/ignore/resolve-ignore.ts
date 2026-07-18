import * as fs from 'fs/promises';
import * as path from 'path';
import ignore from 'ignore';
import type { Ignore } from 'ignore';
import type { ExclusionReason } from '../contracts/types';

export interface IgnoreDecision {
  readonly ignored: boolean;
  readonly reason?: ExclusionReason;
  readonly detail?: string;
}

export interface IgnoreMatcher {
  /** True when the relative path should be skipped (not indexed). */
  ignores(relPath: string): boolean;
}

interface Layer {
  readonly dirRel: string;
  readonly git: Ignore;
  readonly mergecore: Ignore;
}

/**
 * Nested gitignore + .mergecoreignore resolver.
 * Each directory may contribute patterns; .mergecoreignore always adds exclusions.
 */
export class NestedIgnoreResolver {
  private readonly layers = new Map<string, Layer>();

  constructor(private readonly workspaceRoot: string) {}

  async ensureDir(dirRel: string): Promise<void> {
    const key = normaliseDir(dirRel);
    if (this.layers.has(key)) {
      return;
    }
    const git = ignore();
    const mergecore = ignore();
    const absDir = key ? path.join(this.workspaceRoot, key) : this.workspaceRoot;
    await loadIgnoreFile(path.join(absDir, '.gitignore'), git);
    await loadIgnoreFile(path.join(absDir, '.mergecoreignore'), mergecore);
    this.layers.set(key, { dirRel: key, git, mergecore });
  }

  /**
   * Test whether `relPath` (file or directory, forward slashes) is ignored.
   * Checks all ancestor layers from root down to the parent directory.
   */
  async decide(relPath: string, isDirectory = false): Promise<IgnoreDecision> {
    const normalised = relPath.replace(/\\/g, '/').replace(/^\.\//, '');
    if (!normalised || normalised === '.') {
      return { ignored: false };
    }

    const parts = normalised.split('/');
    await this.ensureDir('');
    const ancestors: string[] = [''];
    let accum = '';
    const limit = isDirectory ? parts.length : Math.max(0, parts.length - 1);
    for (let i = 0; i < limit; i++) {
      accum = accum ? `${accum}/${parts[i]}` : parts[i]!;
      await this.ensureDir(accum);
      ancestors.push(accum);
    }

    const testPath = isDirectory && !normalised.endsWith('/') ? `${normalised}/` : normalised;

    for (const dir of ancestors) {
      const layer = this.layers.get(dir);
      if (!layer) {
        continue;
      }
      const relativeToLayer = pathRelativeTo(dir, testPath);
      if (!relativeToLayer) {
        continue;
      }
      try {
        if (layer.mergecore.ignores(relativeToLayer)) {
          return {
            ignored: true,
            reason: 'mergecoreignore',
            detail: dir ? `.mergecoreignore in ${dir}` : '.mergecoreignore at root',
          };
        }
      } catch {
        // ignore malformed
      }
      try {
        if (layer.git.ignores(relativeToLayer)) {
          return {
            ignored: true,
            reason: 'gitignore',
            detail: dir ? `.gitignore in ${dir}` : '.gitignore at root',
          };
        }
      } catch {
        // ignore malformed
      }
    }

    return { ignored: false };
  }
}

/**
 * Root-level sync matcher for legacy walk callers.
 * Prefers NestedIgnoreResolver for full nested behaviour.
 */
export async function createIgnoreMatcher(workspaceRoot: string): Promise<IgnoreMatcher> {
  const git = ignore();
  const mergecore = ignore();
  await loadIgnoreFile(path.join(workspaceRoot, '.gitignore'), git);
  await loadIgnoreFile(path.join(workspaceRoot, '.mergecoreignore'), mergecore);
  return {
    ignores(relPath: string): boolean {
      const normalised = relPath.replace(/\\/g, '/').replace(/^\.\//, '');
      if (!normalised || normalised === '.') {
        return false;
      }
      try {
        if (mergecore.ignores(normalised) || mergecore.ignores(`${normalised}/`)) {
          return true;
        }
      } catch {
        // ignore
      }
      try {
        if (git.ignores(normalised) || git.ignores(`${normalised}/`)) {
          return true;
        }
      } catch {
        // ignore
      }
      return false;
    },
  };
}

/**
 * Resolve a path and ensure it stays inside the workspace (no symlink escape).
 */
export async function resolveInsideWorkspace(
  workspaceRoot: string,
  absOrRel: string
): Promise<string | undefined> {
  let rootReal: string;
  try {
    rootReal = await fs.realpath(workspaceRoot);
  } catch {
    rootReal = path.resolve(workspaceRoot);
  }
  const candidate = path.isAbsolute(absOrRel)
    ? absOrRel
    : path.join(workspaceRoot, absOrRel);
  let real: string;
  try {
    real = await fs.realpath(candidate);
  } catch {
    real = path.resolve(candidate);
  }
  const rel = path.relative(rootReal, real);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    return undefined;
  }
  return rel.replace(/\\/g, '/');
}

async function loadIgnoreFile(abs: string, ig: Ignore): Promise<void> {
  try {
    const content = await fs.readFile(abs, 'utf8');
    ig.add(content);
  } catch {
    // optional
  }
}

function normaliseDir(dirRel: string): string {
  return dirRel.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/$/, '');
}

function pathRelativeTo(dirRel: string, fileRel: string): string {
  if (!dirRel) {
    return fileRel;
  }
  if (fileRel === dirRel || fileRel === `${dirRel}/`) {
    return '';
  }
  if (fileRel.startsWith(`${dirRel}/`)) {
    return fileRel.slice(dirRel.length + 1);
  }
  return fileRel;
}
