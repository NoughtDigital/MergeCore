import * as path from 'path';

export function normaliseRel(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.\//, '');
}

export function toPosix(p: string): string {
  return p.replace(/\\/g, '/');
}

export function absToRel(workspaceRoot: string, absPath: string): string {
  const root = path.resolve(workspaceRoot);
  const abs = path.resolve(absPath);
  let rel = path.relative(root, abs);
  if (rel.startsWith('..')) {
    return toPosix(abs);
  }
  return normaliseRel(rel);
}

export function relToAbs(workspaceRoot: string, relPath: string): string {
  return path.resolve(workspaceRoot, relPath);
}

export function isTsJsPath(filePath: string): boolean {
  const lower = filePath.replace(/\\/g, '/').toLowerCase();
  return (
    lower.endsWith('.ts') ||
    lower.endsWith('.tsx') ||
    lower.endsWith('.js') ||
    lower.endsWith('.jsx') ||
    lower.endsWith('.mjs') ||
    lower.endsWith('.cjs')
  );
}

export function languageForTsJs(filePath: string): 'typescript' | 'javascript' {
  const lower = filePath.replace(/\\/g, '/').toLowerCase();
  if (
    lower.endsWith('.js') ||
    lower.endsWith('.jsx') ||
    lower.endsWith('.mjs') ||
    lower.endsWith('.cjs')
  ) {
    return 'javascript';
  }
  return 'typescript';
}
