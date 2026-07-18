import * as path from 'path';
import type { DependencyEdge, SymbolRecord } from '../contracts';
import { sha256 } from '../rag/hash';

function normalisePath(p: string): string {
  return p.replace(/\\/g, '/');
}

function findBlockEnd(lines: readonly string[], start: number): number {
  let depth = 0;
  let seen = false;
  for (let i = start; i < lines.length; i++) {
    const line = lines[i] ?? '';
    for (const ch of line) {
      if (ch === '{') {
        depth++;
        seen = true;
      } else if (ch === '}') {
        depth--;
        if (seen && depth <= 0) {
          return i;
        }
      }
    }
  }
  return Math.min(lines.length - 1, start + 40);
}

/**
 * Heuristic TypeScript / JavaScript symbol extraction (no compiler host).
 */
export function extractJsTsSymbols(
  filePath: string,
  content: string,
  language: 'typescript' | 'javascript'
): SymbolRecord[] {
  const rel = normalisePath(filePath);
  const lines = content.split(/\r?\n/);
  const out: SymbolRecord[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const exported = /^\s*export\s+/.test(line);

    const classMatch = line.match(
      /^\s*(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/
    );
    if (classMatch) {
      const name = classMatch[1]!;
      const end = findBlockEnd(lines, i);
      out.push({
        id: `${language}:${rel}:${name}:${i + 1}`,
        name,
        kind: 'class',
        location: { path: rel, startLine: i + 1, endLine: end + 1 },
        exported,
        language,
      });
      continue;
    }

    const funcMatch = line.match(
      /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)\s*\(/
    );
    if (funcMatch) {
      const name = funcMatch[1]!;
      const end = findBlockEnd(lines, i);
      out.push({
        id: `${language}:${rel}:${name}:${i + 1}`,
        name,
        kind: 'function',
        location: { path: rel, startLine: i + 1, endLine: end + 1 },
        exported,
        language,
      });
      continue;
    }

    const constFn = line.match(
      /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/
    );
    if (constFn) {
      const name = constFn[1]!;
      const end = findBlockEnd(lines, i);
      out.push({
        id: `${language}:${rel}:${name}:${i + 1}`,
        name,
        kind: 'function',
        location: { path: rel, startLine: i + 1, endLine: end + 1 },
        exported,
        language,
      });
      continue;
    }

    const interfaceMatch = line.match(
      /^\s*(?:export\s+)?(?:default\s+)?interface\s+([A-Za-z_$][\w$]*)/
    );
    if (interfaceMatch && language === 'typescript') {
      const name = interfaceMatch[1]!;
      const end = findBlockEnd(lines, i);
      out.push({
        id: `${language}:${rel}:${name}:${i + 1}`,
        name,
        kind: 'interface',
        location: { path: rel, startLine: i + 1, endLine: end + 1 },
        exported,
        language,
      });
      continue;
    }

    const typeMatch = line.match(/^\s*(?:export\s+)?type\s+([A-Za-z_$][\w$]*)\s*=/);
    if (typeMatch && language === 'typescript') {
      const name = typeMatch[1]!;
      out.push({
        id: `${language}:${rel}:${name}:${i + 1}`,
        name,
        kind: 'type',
        location: { path: rel, startLine: i + 1, endLine: i + 1 },
        exported,
        language,
      });
      continue;
    }

    const enumMatch = line.match(/^\s*(?:export\s+)?enum\s+([A-Za-z_$][\w$]*)/);
    if (enumMatch && language === 'typescript') {
      const name = enumMatch[1]!;
      const end = findBlockEnd(lines, i);
      out.push({
        id: `${language}:${rel}:${name}:${i + 1}`,
        name,
        kind: 'enum',
        location: { path: rel, startLine: i + 1, endLine: end + 1 },
        exported,
        language,
      });
    }
  }

  return out;
}

/**
 * Resolve a relative import specifier to a normalised path guess (no FS check).
 */
export function resolveImportSpecifier(fromPath: string, specifier: string): string {
  if (!specifier.startsWith('.')) {
    return specifier;
  }
  const dir = path.posix.dirname(normalisePath(fromPath));
  let resolved = path.posix.normalize(path.posix.join(dir, specifier));
  if (resolved.startsWith('./')) {
    resolved = resolved.slice(2);
  }
  // Strip extensionless — keep as-is; indexer may match .ts/.js later
  return resolved;
}

export function extractJsTsDependencies(filePath: string, content: string): DependencyEdge[] {
  const rel = normalisePath(filePath);
  const lines = content.split(/\r?\n/);
  const out: DependencyEdge[] = [];

  const patterns: Array<{
    re: RegExp;
    kind: DependencyEdge['kind'];
    group: number;
  }> = [
    { re: /^\s*import\s+[\s\S]*?\s+from\s+['"]([^'"]+)['"]/, kind: 'import', group: 1 },
    { re: /^\s*import\s+['"]([^'"]+)['"]/, kind: 'import', group: 1 },
    { re: /^\s*export\s+[\s\S]*?\s+from\s+['"]([^'"]+)['"]/, kind: 'export', group: 1 },
    { re: /require\s*\(\s*['"]([^'"]+)['"]\s*\)/, kind: 'require', group: 1 },
  ];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    // Skip obvious comments
    if (/^\s*\/\//.test(line) || /^\s*\*/.test(line)) {
      continue;
    }
    for (const { re, kind, group } of patterns) {
      const m = line.match(re);
      if (!m) {
        continue;
      }
      const specifier = m[group] ?? '';
      if (!specifier) {
        continue;
      }
      const toPath = resolveImportSpecifier(rel, specifier);
      const id = sha256(`${rel}|${kind}|${specifier}|${i + 1}`).slice(0, 24);
      out.push({
        id: `edge:${id}`,
        fromPath: rel,
        toPath,
        kind,
        specifier,
        startLine: i + 1,
      });
      break;
    }
  }

  return out;
}
