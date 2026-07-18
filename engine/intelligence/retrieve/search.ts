import type { ContextClaim, SourceReference } from '../contracts';
import { createSourceReference } from '../attribution/index';
import {
  hashRelativePath,
  inspectionFromResult,
  recordUsageEvent,
  saveLastInspection,
  setSessionLastInspection,
} from '../diagnostics/index';
import { createCodeGraphQuery } from '../graph/query';
import type { InstructionResolver } from '../instructions/resolver';
import { createInstructionResolver } from '../instructions/resolver';
import { sha256 } from '../rag/hash';
import type { RagStore } from '../rag/store';
import {
  hitsToClaims,
  hybridSearchRepositoryContext,
} from './hybrid-ranker';
import type {
  RepositoryContextResult,
  RetrievalHit,
  SearchRepositoryContextOptions,
} from './types';

export interface RepositorySearchEngine {
  searchRepositoryContext(
    query: string,
    options?: SearchRepositoryContextOptions
  ): Promise<RepositoryContextResult>;
  findRelevantFiles(
    task: string,
    options?: SearchRepositoryContextOptions
  ): Promise<readonly RetrievalHit[]>;
  findRelevantSymbols(
    task: string,
    options?: SearchRepositoryContextOptions
  ): Promise<readonly RetrievalHit[]>;
  getContextForFile(file: string): Promise<RepositoryContextResult>;
  getContextForSymbol(symbolId: string): Promise<RepositoryContextResult>;
}

export interface CreateRepositorySearchEngineOptions {
  readonly store: RagStore;
  readonly instructionResolver?: InstructionResolver;
  /** When true (default), discover scoped instructions for ranking. */
  readonly useInstructions?: boolean;
}

/**
 * Create the local hybrid repository search engine (no embeddings required).
 */
export async function createRepositorySearchEngine(
  options: CreateRepositorySearchEngineOptions
): Promise<RepositorySearchEngine> {
  const store = options.store;
  let resolver = options.instructionResolver;
  if (!resolver && options.useInstructions !== false) {
    try {
      resolver = await createInstructionResolver({
        workspaceRoot: store.root,
      });
    } catch {
      resolver = undefined;
    }
  }

  const search = async (
    query: string,
    opts?: SearchRepositoryContextOptions
  ): Promise<RepositoryContextResult> => {
    const result = await hybridSearchRepositoryContext(
      store,
      query,
      opts ?? {},
      resolver
    );
    if (result.debug) {
      const inspection = inspectionFromResult(result, query);
      if (inspection) {
        setSessionLastInspection(inspection);
        void saveLastInspection(store.root, inspection).catch(() => undefined);
      }
      void recordUsageEvent(store.root, {
        kind: 'retrieval_latency',
        latencyMs: result.debug.elapsedMs,
      }).catch(() => undefined);
      if (
        result.incomplete ||
        result.results.every(
          (h) => h.confidence === 'low' || h.confidence === 'uncertain'
        )
      ) {
        void recordUsageEvent(store.root, {
          kind: 'low_confidence_query',
          queryFingerprint: result.debug.queryFingerprint,
        }).catch(() => undefined);
      }
      for (const hit of result.results.slice(0, 12)) {
        void recordUsageEvent(store.root, {
          kind: 'frequent_source',
          pathHash: hashRelativePath(hit.path),
        }).catch(() => undefined);
      }
    }
    return result;
  };

  return {
    searchRepositoryContext: search,

    async findRelevantFiles(task, options) {
      const result = await search(task, options);
      const files = new Map<string, RetrievalHit>();
      for (const hit of result.results) {
        const key = hit.path;
        const existing = files.get(key);
        if (!existing || hit.score > existing.score) {
          files.set(key, {
            ...hit,
            resultType: hit.resultType === 'test' ? 'test' : 'file',
            id: `file:${key}`,
          });
        }
      }
      return [...files.values()].sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return a.path.localeCompare(b.path);
      });
    },

    async findRelevantSymbols(task, options) {
      const result = await search(task, {
        ...options,
        budgets: {
          maxFiles: options?.budgets?.maxFiles ?? 8,
          maxSymbols: options?.budgets?.maxSymbols ?? 30,
          maxChunks: options?.budgets?.maxChunks ?? 8,
          ...options?.budgets,
        },
      });
      return result.results
        .filter((h) => h.resultType === 'symbol' || h.symbolId || h.symbolName)
        .sort((a, b) => {
          if (b.score !== a.score) return b.score - a.score;
          return a.id.localeCompare(b.id);
        });
    },

    async getContextForFile(file) {
      const rel = file.replace(/\\/g, '/');
      return search(rel, {
        pathHint: rel,
        selectedFiles: [rel],
        k: 24,
      });
    },

    async getContextForSymbol(symbolId) {
      const graph = createCodeGraphQuery(store);
      const def = graph.getSymbolDefinition(symbolId);
      if (!def) {
        return {
          workspaceRoot: store.root,
          query: symbolId,
          results: [],
          incomplete: true,
          notes: [`Symbol ${symbolId} not found in local index.`],
        };
      }
      const result = await search(def.name, {
        pathHint: def.location.path,
        selectedFiles: [def.location.path],
        k: 24,
      });
      // Ensure the definition itself is present with a strong reason
      const hasDef = result.results.some((r) => r.symbolId === symbolId);
      if (!hasDef) {
        const file = store.getFile(def.location.path);
        const workspaceId = store.workspaceId ?? sha256(store.root).slice(0, 16);
        const hit: RetrievalHit = {
          id: `sym:${symbolId}`,
          resultType: 'symbol',
          score: 200,
          breakdown: { exactSymbol: 100, userSelected: 100 },
          reference: createSourceReference({
            workspaceId,
            path: def.location.path,
            startLine: def.location.startLine,
            endLine: def.location.endLine,
            startColumn: def.location.startColumn,
            endColumn: def.location.endColumn,
            sourceType: 'symbol',
            sourceFingerprint: file?.hash ?? '',
            symbolId,
            symbol: def.name,
            extraction: 'deterministic',
          }),
          reason: `definition of ${def.name} (${symbolId})`,
          confidence: 'high',
          analysis: 'deterministic',
          path: def.location.path,
          symbolId,
          symbolName: def.name,
          charEstimate: 200,
        };
        return {
          ...result,
          results: [hit, ...result.results],
          incomplete: false,
        };
      }
      return result;
    },
  };
}

/** Convenience wrapper matching the requested API name. */
export async function searchRepositoryContext(
  store: RagStore,
  query: string,
  options: SearchRepositoryContextOptions = {}
): Promise<RepositoryContextResult> {
  const engine = await createRepositorySearchEngine({ store });
  return engine.searchRepositoryContext(query, options);
}

export function repositoryContextToClaims(result: RepositoryContextResult): {
  claims: ContextClaim[];
  references: SourceReference[];
  incomplete: boolean;
  notes?: readonly string[];
} {
  const mapped = hitsToClaims(result.results);
  return {
    ...mapped,
    incomplete: result.incomplete,
    notes: result.notes,
  };
}
