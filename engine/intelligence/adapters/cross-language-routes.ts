import type { DependencyEdge } from '../contracts';
import { sha256 } from '../rag/hash';

/**
 * Link HTTP route evidence across languages when a client string matches a
 * `route:METHOD /path` specifier produced by the PHP (or other) adapter.
 * Always heuristic — string equality is not a type-checker.
 */
export function linkCrossLanguageRouteEdges(
  edges: readonly DependencyEdge[],
  fileContents: ReadonlyMap<string, string>
): DependencyEdge[] {
  const routes = edges.filter((e) => e.specifier.startsWith('route:'));
  if (routes.length === 0) {
    return [];
  }

  const out: DependencyEdge[] = [];
  for (const [filePath, content] of fileContents) {
    const normalised = filePath.replace(/\\/g, '/');
    // Only link from TS/JS clients (or any non-PHP file containing the path)
    if (/\.php$/i.test(normalised)) {
      continue;
    }
    for (const route of routes) {
      const pathPart = route.specifier.replace(/^route:[A-Z]+\s+/, '');
      if (!pathPart || pathPart.length < 2) continue;
      if (!content.includes(`'${pathPart}'`) && !content.includes(`"${pathPart}"`)) {
        continue;
      }
      const id = sha256(`xref|${normalised}|${route.specifier}`).slice(0, 24);
      out.push({
        id: `xref:${id}`,
        fromPath: normalised,
        toPath: route.fromPath,
        kind: 'reference',
        specifier: route.specifier,
        toSymbol: route.toSymbol,
        confidence: 'heuristic',
        resolutionMethod: 'convention',
        evidence: ['cross-language-route-string', 'not-compiler-certain'],
      });
    }
  }
  return out;
}
