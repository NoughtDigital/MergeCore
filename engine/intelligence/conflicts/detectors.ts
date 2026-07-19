import * as fs from 'fs/promises';
import * as path from 'path';
import { isDeterministicEdgeResolution } from '../contracts';
import { pathMatchesGlob } from '../instructions/frontmatter';
import type { RagStore } from '../rag/store';
import type {
  ConflictConfidence,
  ConflictRule,
} from './types';

export interface DetectorHit {
  readonly evidence: {
    readonly path: string;
    readonly startLine: number;
    readonly endLine: number;
    readonly excerpt: string;
    readonly detail: string;
  };
  readonly confidence: ConflictConfidence;
}

export interface RunDetectorsOptions {
  readonly workspaceRoot: string;
  readonly rule: ConflictRule;
  readonly candidatePaths: readonly string[];
  readonly store?: RagStore;
}

function pathMatchesAny(relPath: string, globs: readonly string[]): boolean {
  return globs.some((g) => pathMatchesGlob(relPath, g));
}

function lineOf(content: string, index: number): number {
  if (index <= 0) return 1;
  return content.slice(0, index).split(/\r?\n/).length;
}

function excerptAround(content: string, index: number, len = 120): string {
  const start = Math.max(0, index - 40);
  const end = Math.min(content.length, index + len);
  return content.slice(start, end).replace(/\s+/g, ' ').trim();
}

function isCommentLine(content: string, index: number): boolean {
  const lineStart = content.lastIndexOf('\n', index) + 1;
  const lineEnd = content.indexOf('\n', index);
  const line = content.slice(lineStart, lineEnd < 0 ? content.length : lineEnd);
  return /^\s*\/\//.test(line) || /^\s*\*/.test(line) || /^\s*#/.test(line);
}

async function readRel(
  workspaceRoot: string,
  rel: string
): Promise<string | undefined> {
  try {
    return await fs.readFile(path.join(workspaceRoot, rel), 'utf8');
  } catch {
    return undefined;
  }
}

function importSpecifiersFromStore(
  store: RagStore,
  relPath: string
): readonly { specifier: string; startLine: number }[] {
  return store
    .edgesFrom(relPath)
    .filter((e) => {
      if (e.kind !== 'import' && e.kind !== 'require') return false;
      if (!e.resolutionMethod) return true;
      return (
        isDeterministicEdgeResolution(e.resolutionMethod) ||
        e.confidence === 'high' ||
        e.confidence === 'medium'
      );
    })
    .map((e) => ({
      specifier: e.specifier,
      startLine: e.startLine ?? 1,
    }));
}

const IMPORT_RE =
  /(?:import\s+(?:[\s\S]*?\s+from\s+)?|require\s*\(\s*|from\s+)['"]([^'"]+)['"]/g;

function importSpecifiersFromText(
  content: string
): readonly { specifier: string; startLine: number; index: number }[] {
  const out: { specifier: string; startLine: number; index: number }[] = [];
  let m: RegExpExecArray | null;
  const re = new RegExp(IMPORT_RE.source, 'g');
  while ((m = re.exec(content)) !== null) {
    out.push({
      specifier: m[1]!,
      startLine: lineOf(content, m.index),
      index: m.index,
    });
  }
  return out;
}

function matchesForbiddenImport(specifier: string, forbidden: string): boolean {
  const s = specifier.replace(/\\/g, '/');
  const f = forbidden.replace(/\\/g, '/');
  return s === f || s.startsWith(`${f}/`) || s.includes(f);
}

function resolveImports(
  store: RagStore | undefined,
  rel: string,
  content: string
): readonly {
  specifier: string;
  startLine: number;
  index: number;
  fromStore: boolean;
}[] {
  if (store) {
    const fromStore = importSpecifiersFromStore(store, rel);
    if (fromStore.length > 0) {
      return fromStore.map((s) => ({
        specifier: s.specifier,
        startLine: s.startLine,
        index: Math.max(0, content.indexOf(`'${s.specifier}'`) >= 0
          ? content.indexOf(`'${s.specifier}'`)
          : content.indexOf(`"${s.specifier}"`)),
        fromStore: true,
      }));
    }
  }
  return importSpecifiersFromText(content).map((s) => ({ ...s, fromStore: false }));
}

function dedupeHits(hits: readonly DetectorHit[]): DetectorHit[] {
  const seen = new Set<string>();
  const out: DetectorHit[] = [];
  for (const h of hits) {
    const key = `${h.evidence.path}:${h.evidence.startLine}:${h.evidence.detail}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(h);
  }
  return out;
}

/**
 * Run a single structured conflict rule against candidate paths.
 */
export async function runConflictDetectors(
  options: RunDetectorsOptions
): Promise<readonly DetectorHit[]> {
  const { workspaceRoot, rule, candidatePaths, store } = options;
  const scoped = candidatePaths.filter((p) => pathMatchesAny(p, rule.appliesTo));
  const hits: DetectorHit[] = [];

  for (const rel of scoped) {
    const content = await readRel(workspaceRoot, rel);
    if (content === undefined) continue;
    const basename = rel.split('/').pop() ?? rel;

    if (rule.detector === 'forbidden_imports') {
      for (const f of rule.forbiddenImports ?? []) {
        for (const spec of resolveImports(store, rel, content)) {
          if (!matchesForbiddenImport(spec.specifier, f)) continue;
          hits.push({
            confidence: spec.fromStore ? 'high' : 'medium',
            evidence: {
              path: rel,
              startLine: spec.startLine,
              endLine: spec.startLine,
              excerpt: excerptAround(content, Math.max(0, spec.index)),
              detail: `Imports \`${spec.specifier}\` (forbidden: \`${f}\`)`,
            },
          });
        }
      }
    }

    if (rule.detector === 'direct_database_access') {
      for (const f of rule.forbiddenImports ?? []) {
        for (const spec of resolveImports(store, rel, content)) {
          if (!matchesForbiddenImport(spec.specifier, f)) continue;
          hits.push({
            confidence: spec.fromStore ? 'high' : 'medium',
            evidence: {
              path: rel,
              startLine: spec.startLine,
              endLine: spec.startLine,
              excerpt: excerptAround(content, Math.max(0, spec.index)),
              detail: `Direct database import \`${spec.specifier}\``,
            },
          });
        }
      }
      for (const pat of rule.databaseAccessPatterns ?? []) {
        let from = 0;
        while (from < content.length) {
          const idx = content.indexOf(pat, from);
          if (idx < 0) break;
          from = idx + pat.length;
          if (isCommentLine(content, idx)) continue;
          hits.push({
            confidence: 'high',
            evidence: {
              path: rel,
              startLine: lineOf(content, idx),
              endLine: lineOf(content, idx),
              excerpt: excerptAround(content, idx),
              detail: `Direct database usage \`${pat}\``,
            },
          });
        }
      }
    }

    if (rule.detector === 'network_provider_access') {
      for (const p of rule.networkProviderPatterns ?? []) {
        for (const spec of resolveImports(store, rel, content)) {
          if (!matchesForbiddenImport(spec.specifier, p)) continue;
          hits.push({
            confidence: spec.fromStore ? 'high' : 'medium',
            evidence: {
              path: rel,
              startLine: spec.startLine,
              endLine: spec.startLine,
              excerpt: excerptAround(content, Math.max(0, spec.index)),
              detail: `Network provider import \`${spec.specifier}\``,
            },
          });
        }
      }
    }

    if (rule.detector === 'prohibited_directory_deps') {
      for (const dir of rule.prohibitedDirectories ?? []) {
        const norm = dir.replace(/\\/g, '/').replace(/\/$/, '');
        for (const spec of resolveImports(store, rel, content)) {
          const s = spec.specifier.replace(/\\/g, '/');
          if (s.includes(norm) || s.startsWith(norm)) {
            hits.push({
              confidence: 'high',
              evidence: {
                path: rel,
                startLine: spec.startLine,
                endLine: spec.startLine,
                excerpt: excerptAround(content, Math.max(0, spec.index)),
                detail: `Depends on prohibited directory \`${norm}\` via \`${s}\``,
              },
            });
          }
        }
        // Also check store toPath
        if (store) {
          for (const e of store.edgesFrom(rel)) {
            if (e.kind !== 'import' && e.kind !== 'require') continue;
            const to = e.toPath.replace(/\\/g, '/');
            if (to.includes(norm) || to.startsWith(norm + '/')) {
              hits.push({
                confidence: 'high',
                evidence: {
                  path: rel,
                  startLine: e.startLine ?? 1,
                  endLine: e.startLine ?? 1,
                  excerpt: e.specifier,
                  detail: `File dependency into prohibited directory \`${to}\``,
                },
              });
            }
          }
        }
      }
    }

    if (rule.detector === 'naming_rules' && rule.namingPattern) {
      let re: RegExp;
      try {
        re = new RegExp(rule.namingPattern);
      } catch {
        continue;
      }
      const must = rule.namingMustMatch !== false;
      const ok = re.test(basename);
      if (must ? !ok : ok) {
        hits.push({
          confidence: 'high',
          evidence: {
            path: rel,
            startLine: 1,
            endLine: 1,
            excerpt: basename,
            detail: must
              ? `Basename \`${basename}\` does not match required pattern /${rule.namingPattern}/`
              : `Basename \`${basename}\` matches prohibited pattern /${rule.namingPattern}/`,
          },
        });
      }
    }

    if (rule.detector === 'required_test_location') {
      const globs = rule.requiredTestGlobs ?? [];
      if (globs.length === 0) continue;
      if (/\.(test|spec)\./.test(rel)) continue;
      const stem = basename.replace(/\.(ts|tsx|js|jsx|mjs|cjs)$/i, '');
      const found = candidatePaths.some((p) => {
        const n = p.replace(/\\/g, '/');
        if (!/\.(test|spec)\./.test(n)) return false;
        if (globs.some((g) => pathMatchesGlob(n, g)) && n.includes(stem)) return true;
        const dir = path.posix.dirname(rel.replace(/\\/g, '/'));
        return path.posix.dirname(n) === dir && n.includes(stem);
      });
      if (!found) {
        hits.push({
          confidence: 'medium',
          evidence: {
            path: rel,
            startLine: 1,
            endLine: 1,
            excerpt: basename,
            detail: `No matching test found for required globs: ${globs.join(', ')}`,
          },
        });
      }
    }

    if (rule.detector === 'environment_variable_access') {
      for (const name of rule.environmentVariablePatterns ?? []) {
        const patterns = [
          `process.env.${name}`,
          `getenv('${name}')`,
          `getenv("${name}")`,
          `ENV['${name}']`,
          `ENV["${name}"]`,
        ];
        for (const pat of patterns) {
          const idx = content.indexOf(pat);
          if (idx < 0 || isCommentLine(content, idx)) continue;
          hits.push({
            confidence: 'high',
            evidence: {
              path: rel,
              startLine: lineOf(content, idx),
              endLine: lineOf(content, idx),
              excerpt: excerptAround(content, idx),
              detail: `Reads environment variable via \`${pat}\``,
            },
          });
        }
      }
    }
  }

  // required_abstraction: files in scope must reference at least one required symbol/import
  if (rule.detector === 'required_abstraction') {
    const needed = rule.requiredAbstractions ?? [];
    for (const rel of scoped) {
      const content = await readRel(workspaceRoot, rel);
      if (content === undefined) continue;
      const hasAny = needed.some((n) => content.includes(n));
      if (!hasAny && needed.length > 0) {
        hits.push({
          confidence: 'medium',
          evidence: {
            path: rel,
            startLine: 1,
            endLine: 1,
            excerpt: needed.join(', '),
            detail: `Missing required abstraction(s): ${needed.map((n) => `\`${n}\``).join(', ')}`,
          },
        });
      }
    }
  }

  return dedupeHits(hits);
}
