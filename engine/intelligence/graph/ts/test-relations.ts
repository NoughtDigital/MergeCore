import * as path from 'path';
import ts from 'typescript';
import type { DependencyEdge, SymbolRecord } from '../../contracts';
import type { TsProgramHost } from './program-host';
import { absToRel, normaliseRel } from './paths';
import { edgeId } from './symbol-id';

const TEST_DIR_MARKERS = [
  '/__tests__/',
  '/tests/',
  '/test/',
  '/e2e/',
  '/playwright/',
  '/integration/',
];

export function isLikelyTestPath(relPath: string): boolean {
  const n = normaliseRel(relPath).toLowerCase();
  const base = path.posix.basename(n);
  if (base.endsWith('.test.ts') || base.endsWith('.test.tsx') || base.endsWith('.test.js')) {
    return true;
  }
  if (base.endsWith('.spec.ts') || base.endsWith('.spec.tsx') || base.endsWith('.spec.js')) {
    return true;
  }
  return TEST_DIR_MARKERS.some((m) => n.includes(m));
}

function collectDescribeStrings(sf: ts.SourceFile): string[] {
  const out: string[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      (node.expression.text === 'describe' ||
        node.expression.text === 'context' ||
        node.expression.text === 'it' ||
        node.expression.text === 'test')
    ) {
      const arg0 = node.arguments[0];
      if (arg0 && ts.isStringLiteral(arg0)) {
        out.push(arg0.text);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

function moduleBasename(rel: string): string {
  const base = path.posix.basename(normaliseRel(rel));
  return base.replace(/\.(test|spec)\.(tsx?|jsx?|mjs|cjs)$/i, '').replace(/\.(tsx?|jsx?|mjs|cjs)$/i, '');
}

/**
 * Emit likelyTestCoverage edges with stacked evidence.
 * Path/name similarity alone never yields more than low/heuristic confidence,
 * and is never the sole claim that a symbol is tested.
 */
export function detectTestCoverageEdges(
  host: TsProgramHost,
  testRelPath: string,
  sf: ts.SourceFile,
  _checker: ts.TypeChecker,
  _localSymbols: readonly SymbolRecord[]
): DependencyEdge[] {
  if (!isLikelyTestPath(testRelPath)) {
    return [];
  }

  const rel = normaliseRel(testRelPath);
  const edges: DependencyEdge[] = [];
  const describeStrings = collectDescribeStrings(sf);
  const importedSut = new Map<
    string,
    { resolvedRel: string; startLine: number; startColumn?: number }
  >();

  for (const stmt of sf.statements) {
    if (
      !ts.isImportDeclaration(stmt) ||
      !stmt.moduleSpecifier ||
      !ts.isStringLiteral(stmt.moduleSpecifier)
    ) {
      continue;
    }
    const specifier = stmt.moduleSpecifier.text;
    if (!specifier.startsWith('.') && !specifier.startsWith('@/')) {
      // Still resolve path aliases
    }
    const resolved = host.resolveModule(rel, specifier);
    if (!resolved.resolvedRel || isLikelyTestPath(resolved.resolvedRel)) {
      continue;
    }
    const loc = sf.getLineAndCharacterOfPosition(stmt.getStart(sf));
    importedSut.set(resolved.resolvedRel, {
      resolvedRel: resolved.resolvedRel,
      startLine: loc.line + 1,
      startColumn: loc.character + 1,
    });
  }

  // Also check require()
  const visitReq = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'require' &&
      node.arguments[0] &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      const specifier = node.arguments[0].text;
      const resolved = host.resolveModule(rel, specifier);
      if (resolved.resolvedRel && !isLikelyTestPath(resolved.resolvedRel)) {
        const loc = sf.getLineAndCharacterOfPosition(node.getStart(sf));
        importedSut.set(resolved.resolvedRel, {
          resolvedRel: resolved.resolvedRel,
          startLine: loc.line + 1,
          startColumn: loc.character + 1,
        });
      }
    }
    ts.forEachChild(node, visitReq);
  };
  visitReq(sf);

  for (const [sutPath, info] of importedSut) {
    const evidence: string[] = [`imports:${sutPath}`];
    let confidence: DependencyEdge['confidence'] = 'high';
    let resolutionMethod: DependencyEdge['resolutionMethod'] = 'import-graph';

    const sutBase = moduleBasename(sutPath);
    const matchingDescribe = describeStrings.filter(
      (d) =>
        d.toLowerCase().includes(sutBase.toLowerCase()) ||
        sutBase.toLowerCase().includes(d.toLowerCase().replace(/\s+/g, ''))
    );
    if (matchingDescribe.length > 0) {
      evidence.push(...matchingDescribe.map((d) => `describe:${d}`));
      confidence = 'certain';
      resolutionMethod = 'typescript-ast';
    }

    // Link to symbols in SUT that appear in describe/it or are referenced
    const sutSf = host.getSourceFile(sutPath);
    const sutChecker = host.getChecker(sutPath);
    const targetSymbolIds: string[] = [];
    if (sutSf && sutChecker) {
      for (const d of describeStrings) {
        // Find exported symbols whose names appear in describe text
        for (const stmt of sutSf.statements) {
          const name =
            (ts.isFunctionDeclaration(stmt) ||
              ts.isClassDeclaration(stmt) ||
              ts.isInterfaceDeclaration(stmt)) &&
            stmt.name
              ? stmt.name.text
              : undefined;
          if (name && d.toLowerCase().includes(name.toLowerCase())) {
            const start = sutSf.getLineAndCharacterOfPosition(stmt.getStart(sutSf));
            const kind = ts.isClassDeclaration(stmt)
              ? 'class'
              : ts.isInterfaceDeclaration(stmt)
                ? 'interface'
                : 'function';
            const lang = sutPath.endsWith('.js') ? 'javascript' : 'typescript';
            targetSymbolIds.push(
              `${lang}:${normaliseRel(sutPath)}:${name}:${kind}:${start.line + 1}:${start.character + 1}`
            );
            evidence.push(`describe-symbol:${name}`);
          }
        }
      }
    }

    if (targetSymbolIds.length === 0) {
      // Module-level coverage edge (file → file) with import evidence
      edges.push({
        id: edgeId([rel, 'likelyTestCoverage', sutPath, info.startLine]),
        fromPath: rel,
        toPath: sutPath,
        kind: 'likelyTestCoverage',
        specifier: sutPath,
        startLine: info.startLine,
        startColumn: info.startColumn,
        confidence,
        resolutionMethod,
        evidence,
      });
    } else {
      for (const toSymbol of targetSymbolIds) {
        edges.push({
          id: edgeId([rel, 'likelyTestCoverage', toSymbol, info.startLine]),
          fromPath: rel,
          toPath: sutPath,
          kind: 'likelyTestCoverage',
          specifier: sutPath,
          toSymbol,
          startLine: info.startLine,
          startColumn: info.startColumn,
          confidence,
          resolutionMethod,
          evidence,
        });
      }
    }
  }

  // Naming-only heuristic: never claim "tested" alone — emit low confidence only when
  // there is also some other weak signal (describe mentions basename) and no imports.
  if (importedSut.size === 0) {
    const testBase = moduleBasename(rel);
    const matchingDescribe = describeStrings.filter((d) =>
      d.toLowerCase().includes(testBase.toLowerCase())
    );
    if (matchingDescribe.length > 0) {
      // Guess sibling SUT path (foo.spec.ts → foo.ts) — heuristic only
      const guess = rel
        .replace(/\.test\.(tsx?|jsx?)$/i, '.$1')
        .replace(/\.spec\.(tsx?|jsx?)$/i, '.$1')
        .replace(/\/__tests__\//, '/')
        .replace(/\/tests\//, '/')
        .replace(/\/test\//, '/');
      if (guess !== rel) {
        edges.push({
          id: edgeId([rel, 'likelyTestCoverage', 'naming', guess]),
          fromPath: rel,
          toPath: guess,
          kind: 'likelyTestCoverage',
          specifier: guess,
          confidence: 'heuristic',
          resolutionMethod: 'naming-heuristic',
          evidence: [
            `path-pattern:${rel}`,
            ...matchingDescribe.map((d) => `describe:${d}`),
            'note:not-sufficient-alone-without-import',
          ],
        });
      }
    }
  }

  void absToRel;
  return edges;
}
