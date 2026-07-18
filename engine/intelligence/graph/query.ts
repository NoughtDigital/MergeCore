import type {
  DependencyEdge,
  DependencyEdgeKind,
  RelationshipPath,
  SymbolRecord,
  TraverseBudget,
} from '../contracts';
import type { RagStore } from '../rag/store';
import type { TsJsCodeGraphService } from './ts/service';
import { normaliseRel } from './ts/paths';
import {
  traverseRelationshipPaths,
  type TraverseStart,
} from './paths/traverse';

export interface SymbolPosition {
  readonly line: number;
  readonly column: number;
}

export interface FindSymbolOptions {
  readonly exact?: boolean;
  readonly kind?: string;
  readonly pathPrefix?: string;
}

export interface TraverseOptions {
  readonly maxDepth?: number;
  readonly direction?: 'outgoing' | 'incoming' | 'both';
  readonly kinds?: readonly DependencyEdgeKind[];
}

export interface TraverseNode {
  readonly symbolId?: string;
  readonly path?: string;
  readonly depth: number;
  readonly via?: DependencyEdge;
}

export interface RelatedTestResult {
  readonly edge: DependencyEdge;
  readonly evidence: readonly string[];
  readonly confidence: DependencyEdge['confidence'];
}

export interface CodeGraphQuery {
  getSymbolAtPosition(file: string, position: SymbolPosition): SymbolRecord | undefined;
  findSymbol(name: string, options?: FindSymbolOptions): readonly SymbolRecord[];
  getSymbolDefinition(symbolId: string): SymbolRecord | undefined;
  getCallers(symbolId: string): readonly DependencyEdge[];
  getCallees(symbolId: string): readonly DependencyEdge[];
  getDependencies(
    symbolId: string,
    kinds?: readonly DependencyEdgeKind[]
  ): readonly DependencyEdge[];
  getDependents(
    symbolId: string,
    kinds?: readonly DependencyEdgeKind[]
  ): readonly DependencyEdge[];
  getRelatedTests(symbolId: string): readonly RelatedTestResult[];
  /** @deprecated Prefer traverseRelationshipPaths for explainable paths. */
  traverseGraph(start: string, options?: TraverseOptions): readonly TraverseNode[];
  traverseRelationshipPaths(
    start: TraverseStart,
    budget?: TraverseBudget
  ): readonly RelationshipPath[];
}

function ragToSymbol(sym: {
  id: string;
  name: string;
  kind: string;
  path: string;
  startLine: number;
  endLine: number;
  language: string;
  exported?: boolean;
  containerName?: string;
  startColumn?: number;
  endColumn?: number;
  parametersJson?: string;
  returnTypeText?: string;
  jsdocSummary?: string;
  signatureText?: string;
  overloadIndex?: number;
  adapterId?: string;
}): SymbolRecord {
  let parameters: SymbolRecord['parameters'];
  if (sym.parametersJson) {
    try {
      parameters = JSON.parse(sym.parametersJson) as SymbolRecord['parameters'];
    } catch {
      parameters = undefined;
    }
  }
  return {
    id: sym.id,
    name: sym.name,
    kind: sym.kind,
    location: {
      path: sym.path,
      startLine: sym.startLine,
      endLine: sym.endLine,
      startColumn: sym.startColumn,
      endColumn: sym.endColumn,
    },
    exported: sym.exported,
    containerName: sym.containerName,
    language: sym.language,
    adapterId: sym.adapterId ?? sym.language,
    parameters,
    returnTypeText: sym.returnTypeText,
    jsdocSummary: sym.jsdocSummary,
    signatureText: sym.signatureText,
    overloadIndex: sym.overloadIndex,
  };
}

function symbolContainsPosition(
  sym: SymbolRecord,
  file: string,
  position: SymbolPosition
): boolean {
  if (normaliseRel(sym.location.path) !== normaliseRel(file)) {
    return false;
  }
  const { startLine, endLine, startColumn, endColumn } = sym.location;
  if (position.line < startLine || position.line > endLine) {
    return false;
  }
  if (position.line === startLine && startColumn !== undefined && position.column < startColumn) {
    return false;
  }
  if (position.line === endLine && endColumn !== undefined && position.column > endColumn) {
    return false;
  }
  return true;
}

/**
 * Query façade over RagStore (+ optional live Program for position resolution).
 */
export function createCodeGraphQuery(
  store: RagStore,
  graphService?: TsJsCodeGraphService
): CodeGraphQuery {
  const allSymbols = (): SymbolRecord[] => store.allSymbols().map(ragToSymbol);
  const allEdges = (): readonly DependencyEdge[] => store.allEdges();

  const getSymbolDefinition = (symbolId: string): SymbolRecord | undefined => {
    const raw = store.getSymbol(symbolId);
    return raw ? ragToSymbol(raw) : undefined;
  };

  return {
    getSymbolAtPosition(file, position) {
      const rel = normaliseRel(file);
      if (graphService) {
        const id = graphService.getSymbolAtPosition(rel, position);
        if (id) {
          const def = getSymbolDefinition(id);
          if (def) {
            return def;
          }
          // ID known from Program but not yet persisted — synthesise minimal record
          const parts = id.split(':');
          return {
            id,
            name: parts[2] ?? id,
            kind: parts[3] ?? 'unknown',
            location: {
              path: rel,
              startLine: position.line,
              endLine: position.line,
              startColumn: position.column,
              endColumn: position.column,
            },
            language: parts[0] === 'javascript' ? 'javascript' : parts[0] === 'php' ? 'php' : 'typescript',
            adapterId: parts[0] === 'javascript' ? 'javascript' : parts[0] === 'php' ? 'php' : 'typescript',
          };
        }
      }
      // Store range fallback: tightest spanning symbol
      const hits = allSymbols()
        .filter((s) => symbolContainsPosition(s, rel, position))
        .sort((a, b) => {
          const aSpan =
            (a.location.endLine - a.location.startLine) * 1000 +
            ((a.location.endColumn ?? 0) - (a.location.startColumn ?? 0));
          const bSpan =
            (b.location.endLine - b.location.startLine) * 1000 +
            ((b.location.endColumn ?? 0) - (b.location.startColumn ?? 0));
          return aSpan - bSpan;
        });
      return hits[0];
    },

    findSymbol(name, options) {
      const exact = options?.exact !== false;
      const lower = name.toLowerCase();
      return allSymbols().filter((s) => {
        const nameOk = exact
          ? s.name.toLowerCase() === lower
          : s.name.toLowerCase().includes(lower) || s.id.toLowerCase().includes(lower);
        if (!nameOk) {
          return false;
        }
        if (options?.kind && s.kind !== options.kind) {
          return false;
        }
        if (options?.pathPrefix && !s.location.path.startsWith(options.pathPrefix)) {
          return false;
        }
        return true;
      });
    },

    getSymbolDefinition,

    getCallers(symbolId) {
      return allEdges().filter((e) => e.kind === 'call' && e.toSymbol === symbolId);
    },

    getCallees(symbolId) {
      return allEdges().filter((e) => e.kind === 'call' && e.fromSymbol === symbolId);
    },

    getDependencies(symbolId, kinds) {
      const kindSet = kinds ? new Set(kinds) : undefined;
      return allEdges().filter((e) => {
        if (e.fromSymbol !== symbolId) {
          return false;
        }
        return kindSet ? kindSet.has(e.kind) : true;
      });
    },

    getDependents(symbolId, kinds) {
      const kindSet = kinds ? new Set(kinds) : undefined;
      return allEdges().filter((e) => {
        if (e.toSymbol !== symbolId) {
          return false;
        }
        return kindSet ? kindSet.has(e.kind) : true;
      });
    },

    getRelatedTests(symbolId) {
      const sym = getSymbolDefinition(symbolId);
      const filePath = sym?.location.path;
      const results: RelatedTestResult[] = [];
      for (const e of allEdges()) {
        if (e.kind !== 'likelyTestCoverage') {
          continue;
        }
        const matchesSymbol = e.toSymbol === symbolId;
        const matchesFile = Boolean(filePath && e.toPath === filePath && !e.toSymbol);
        if (!matchesSymbol && !matchesFile) {
          continue;
        }
        results.push({
          edge: e,
          evidence: e.evidence ?? [],
          confidence: e.confidence,
        });
      }
      return results;
    },

    traverseGraph(start, options) {
      const maxDepth = options?.maxDepth ?? 3;
      const direction = options?.direction ?? 'outgoing';
      const kindSet = options?.kinds ? new Set(options.kinds) : undefined;
      const edges = allEdges();
      const visited = new Set<string>();
      const out: TraverseNode[] = [];
      const queue: Array<{ id: string; depth: number }> = [{ id: start, depth: 0 }];
      visited.add(start);

      while (queue.length > 0) {
        const cur = queue.shift()!;
        out.push({ symbolId: cur.id, depth: cur.depth });
        if (cur.depth >= maxDepth) {
          continue;
        }
        for (const e of edges) {
          if (kindSet && !kindSet.has(e.kind)) {
            continue;
          }
          let next: string | undefined;
          if (
            (direction === 'outgoing' || direction === 'both') &&
            e.fromSymbol === cur.id &&
            e.toSymbol
          ) {
            next = e.toSymbol;
          } else if (
            (direction === 'incoming' || direction === 'both') &&
            e.toSymbol === cur.id &&
            e.fromSymbol
          ) {
            next = e.fromSymbol;
          }
          if (!next || visited.has(next)) {
            continue;
          }
          visited.add(next);
          queue.push({ id: next, depth: cur.depth + 1 });
          out.push({ symbolId: next, depth: cur.depth + 1, via: e });
        }
      }
      return out;
    },

    traverseRelationshipPaths(start, budget) {
      return traverseRelationshipPaths({
        store,
        start,
        budget,
      });
    },
  };
}
