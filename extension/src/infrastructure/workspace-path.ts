import * as path from 'path';

/**
 * Resolve a workspace-relative path and reject anything that escapes the root
 * (e.g. relative imports like `../../../outside/secrets.env`).
 */
export function resolveInsideWorkspace(workspaceRoot: string, relPath: string): string | undefined {
  const normalised = (relPath ?? '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!normalised) {
    return undefined;
  }
  const rootResolved = path.resolve(workspaceRoot);
  const candidate = path.resolve(rootResolved, normalised);
  const rootWithSep = rootResolved.endsWith(path.sep) ? rootResolved : rootResolved + path.sep;
  if (candidate !== rootResolved && !candidate.startsWith(rootWithSep)) {
    return undefined;
  }
  return candidate;
}
