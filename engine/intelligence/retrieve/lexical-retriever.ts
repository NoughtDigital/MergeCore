import type {
  ContextClaim,
  RepositoryRetriever,
  RetrieveQueryOptions,
  SourceReference,
} from '../contracts';
import { retrieve } from '../rag/retrieve';
import type { RagHit, RetrieveOptions } from '../rag/types';
import type { SqlJsIndexStore } from '../store/sqljs-index-store';

function hitToClaim(hit: RagHit, index: number): ContextClaim {
  const ref: SourceReference = {
    path: hit.chunk.path,
    startLine: hit.chunk.startLine,
    endLine: hit.chunk.endLine,
    sourceType:
      hit.chunk.kind === 'memory'
        ? 'memory'
        : hit.chunk.kind === 'config'
          ? 'config'
          : hit.chunk.symbol
            ? 'symbol'
            : 'lexical',
    symbol: hit.chunk.symbol,
    excerpt: hit.chunk.text.slice(0, 240),
  };
  const confidence =
    hit.score >= 8 ? 'high' : hit.score >= 3 ? 'medium' : hit.score > 0 ? 'low' : 'uncertain';
  return {
    id: `claim:${hit.chunk.id}:${index}`,
    text: hit.chunk.symbol
      ? `Symbol ${hit.chunk.symbol} in ${hit.chunk.path} (lines ${hit.chunk.startLine}–${hit.chunk.endLine}).`
      : `Content from ${hit.chunk.path} (lines ${hit.chunk.startLine}–${hit.chunk.endLine}).`,
    confidence,
    references: [ref],
    score: hit.score,
  };
}

/**
 * Lexical + exact-symbol + path + dependency-neighbourhood retrieval.
 * Embeddings are optional and unused unless the underlying RagStore has vectors.
 */
export class LexicalRepositoryRetriever implements RepositoryRetriever {
  constructor(private readonly indexStore: SqlJsIndexStore) {}

  async retrieve(
    query: string,
    options: RetrieveQueryOptions = {}
  ): Promise<{
    readonly claims: readonly ContextClaim[];
    readonly references: readonly SourceReference[];
    readonly incomplete: boolean;
    readonly notes?: readonly string[];
  }> {
    const store = this.indexStore.ragStore;
    const notes: string[] = [];
    const claims: ContextClaim[] = [];
    const seen = new Set<string>();

    // 1) Exact symbol matches
    const symbolHits = store.findSymbolsByName(query.trim());
    for (const sym of symbolHits.slice(0, options.k ?? 8)) {
      const key = `sym:${sym.id}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      const ref: SourceReference = {
        path: sym.path,
        startLine: sym.startLine,
        endLine: sym.endLine,
        sourceType: 'symbol',
        symbol: sym.name,
      };
      claims.push({
        id: `claim:${sym.id}`,
        text: `${sym.kind} ${sym.name} defined in ${sym.path} (lines ${sym.startLine}–${sym.endLine}).`,
        confidence: 'high',
        references: [ref],
        score: 100,
      });
    }

    // 2) Path relevance — if query looks like a path
    const pathLike = query.replace(/\\/g, '/');
    if (pathLike.includes('/') || /\.(ts|tsx|js|jsx|php|md)$/i.test(pathLike)) {
      for (const chunk of store.allChunks()) {
        if (!chunk.path.includes(pathLike) && chunk.path !== pathLike) {
          continue;
        }
        const key = `path:${chunk.id}`;
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        claims.push(hitToClaim({ chunk, score: 50, source: 'lexical' }, claims.length));
      }
    }

    // 3) Dependency neighbourhood around pathHint
    if (options.pathHint) {
      const hint = options.pathHint.replace(/\\/g, '/');
      const neighbours = new Set<string>();
      for (const e of store.edgesFrom(hint)) {
        neighbours.add(e.toPath);
      }
      for (const e of store.edgesTo(hint)) {
        neighbours.add(e.fromPath);
      }
      for (const n of neighbours) {
        const ref: SourceReference = {
          path: n,
          startLine: 1,
          endLine: 1,
          sourceType: 'dependency',
          excerpt: `Related to ${hint} via import graph`,
        };
        claims.push({
          id: `claim:dep:${hint}:${n}`,
          text: `File ${n} is related to ${hint} via a dependency edge.`,
          confidence: 'medium',
          references: [ref],
          score: 40,
        });
      }
    }

    // 4) Lexical / FTS retrieval
    const retrieveOpts: RetrieveOptions = {
      k: options.k ?? 8,
      pathHint: options.pathHint,
      preferMemory: options.preferMemory ?? true,
      mode: options.mode as RetrieveOptions['mode'],
      profile: options.profile as RetrieveOptions['profile'],
    };
    const hits = retrieve(store, query, retrieveOpts);
    for (const hit of hits) {
      const key = `lex:${hit.chunk.id}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      claims.push(hitToClaim(hit, claims.length));
    }

    const k = options.k ?? 8;
    const trimmed = claims
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
      .slice(0, Math.max(k, symbolHits.length > 0 ? k : k));

    if (trimmed.length === 0) {
      notes.push('No matching evidence in the local index; answer with uncertainty.');
    }

    const references = trimmed.flatMap((c) => c.references);
    return {
      claims: trimmed,
      references,
      incomplete: trimmed.length === 0 || trimmed.every((c) => c.confidence === 'uncertain'),
      notes: notes.length > 0 ? notes : undefined,
    };
  }
}
