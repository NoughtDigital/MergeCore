import * as fs from 'fs/promises';
import * as path from 'path';
import ignore from 'ignore';
import type { Ignore } from 'ignore';

const IGNORE_FILENAMES = ['.gitignore', '.mergecoreignore'] as const;

export interface IgnoreMatcher {
  /** True when the relative path should be skipped (not indexed). */
  ignores(relPath: string): boolean;
}

/**
 * Build an ignore matcher from `.gitignore` and `.mergecoreignore` under the
 * workspace root (root-level files only for V0.1). Always-ignored directory
 * names are layered on top by the walker.
 */
export async function createIgnoreMatcher(workspaceRoot: string): Promise<IgnoreMatcher> {
  const ig: Ignore = ignore();
  for (const name of IGNORE_FILENAMES) {
    const abs = path.join(workspaceRoot, name);
    try {
      const content = await fs.readFile(abs, 'utf8');
      ig.add(content);
    } catch {
      // file optional
    }
  }
  return {
    ignores(relPath: string): boolean {
      const normalised = relPath.replace(/\\/g, '/').replace(/^\.\//, '');
      if (!normalised || normalised === '.') {
        return false;
      }
      try {
        return ig.ignores(normalised);
      } catch {
        return false;
      }
    },
  };
}

/**
 * Resolve a path and ensure it stays inside the workspace (no symlink escape).
 * Returns the relative path using forward slashes, or undefined if outside.
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
    // Dangling symlink or missing file — resolve without following
    real = path.resolve(candidate);
  }
  const rel = path.relative(rootReal, real);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    return undefined;
  }
  return rel.replace(/\\/g, '/');
}
