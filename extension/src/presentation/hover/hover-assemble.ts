import * as path from 'path';
import {
  createCodeGraphQuery,
  createInstructionResolver,
  type RagStore,
  type SymbolRecord,
} from '@mergecore/intelligence';
import { assembleHoverSummary, type HoverSummary } from './hover-summary';

const TS_JS_LANGS = new Set([
  'typescript',
  'typescriptreact',
  'javascript',
  'javascriptreact',
]);

export function isTsJsLanguage(languageId: string): boolean {
  return TS_JS_LANGS.has(languageId);
}

export async function resolveSymbolForHover(
  store: RagStore,
  graphService: {
    getSymbolAtPosition(
      file: string,
      position: { line: number; column: number }
    ): string | undefined;
  } | undefined,
  relPath: string,
  position: { line: number; column: number }
): Promise<SymbolRecord | undefined> {
  const query = createCodeGraphQuery(store, graphService as never);
  const hit = query.getSymbolAtPosition(relPath, position);
  if (hit) {
    return hit;
  }
  // Fallback: any symbol spanning the line
  const symbols = store.allSymbols().filter((s) => {
    const p = s.path.replace(/\\/g, '/');
    return (
      p === relPath &&
      s.startLine <= position.line &&
      s.endLine >= position.line
    );
  });
  if (symbols.length === 0) {
    return undefined;
  }
  symbols.sort(
    (a, b) =>
      b.endLine - b.startLine - (a.endLine - a.startLine) ||
      a.startLine - b.startLine
  );
  // Prefer tightest span
  symbols.sort(
    (a, b) => a.endLine - a.startLine - (b.endLine - b.startLine)
  );
  const best = symbols[0]!;
  return {
    id: best.id,
    name: best.name,
    kind: best.kind,
    location: {
      path: best.path,
      startLine: best.startLine,
      endLine: best.endLine,
      startColumn: best.startColumn,
      endColumn: best.endColumn,
    },
    exported: best.exported,
    containerName: best.containerName,
    language: best.language,
    parameters: best.parametersJson
      ? (JSON.parse(best.parametersJson) as SymbolRecord['parameters'])
      : undefined,
    returnTypeText: best.returnTypeText,
    jsdocSummary: best.jsdocSummary,
    signatureText: best.signatureText,
    overloadIndex: best.overloadIndex,
  };
}

/**
 * Load deterministic hover summary from the local index (no model).
 */
export async function buildDeterministicHoverSummary(input: {
  readonly workspaceRoot: string;
  readonly store: RagStore;
  readonly graphService?: {
    getSymbolAtPosition(
      file: string,
      position: { line: number; column: number }
    ): string | undefined;
  };
  readonly relPath: string;
  readonly position: { line: number; column: number };
  readonly codeSample?: string;
  readonly signal?: AbortSignal;
}): Promise<HoverSummary | undefined> {
  if (input.signal?.aborted) {
    return undefined;
  }

  const symbol = await resolveSymbolForHover(
    input.store,
    input.graphService,
    input.relPath,
    input.position
  );
  if (!symbol) {
    return undefined;
  }
  if (input.signal?.aborted) {
    return undefined;
  }

  const graph = createCodeGraphQuery(input.store, input.graphService as never);
  const callers = graph.getCallers(symbol.id);
  const callees = graph.getCallees(symbol.id);
  const dependencies = graph.getDependencies(symbol.id);
  const related = graph.getRelatedTests(symbol.id).map((r) => ({
    path: r.edge.fromPath,
    evidence: r.evidence,
    confidence: r.confidence,
  }));

  // Also file-level test edges targeting this path
  for (const e of input.store.allEdges()) {
    if (
      e.kind === 'likelyTestCoverage' &&
      e.toPath.replace(/\\/g, '/') === symbol.location.path.replace(/\\/g, '/') &&
      !related.some((r) => r.path === e.fromPath)
    ) {
      related.push({
        path: e.fromPath,
        evidence: e.evidence ?? [],
        confidence: e.confidence,
      });
    }
  }

  let instructions: Array<{ path: string; title: string; excerpt?: string }> = [];
  try {
    const resolver = await createInstructionResolver({
      workspaceRoot: input.workspaceRoot,
    });
    if (input.signal?.aborted) {
      return undefined;
    }
    const docs = await resolver.getApplicableDocuments(symbol.location.path);
    instructions = docs.slice(0, 5).map((d) => ({
      path: d.path,
      title: d.title,
      excerpt: d.documentType,
    }));
  } catch {
    instructions = [];
  }

  const importSpecifiers = input.store
    .edgesFrom(symbol.location.path)
    .filter((e) => e.kind === 'import' || e.kind === 'require')
    .map((e) => e.specifier);

  return assembleHoverSummary({
    symbol,
    codeSample: input.codeSample,
    callers,
    callees,
    dependencies,
    relatedTests: related,
    instructions,
    importSpecifiers,
  });
}

export function relativeWorkspacePath(workspaceRoot: string, absPath: string): string {
  return path.relative(workspaceRoot, absPath).replace(/\\/g, '/');
}
