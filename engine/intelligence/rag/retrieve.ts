import type { RagChunk, RagHit, RetrieveOptions } from './types';
import type { RagStore } from './store';

const STOP = new Set([
  'a',
  'an',
  'the',
  'and',
  'or',
  'to',
  'of',
  'in',
  'on',
  'for',
  'is',
  'are',
  'was',
  'were',
  'be',
  'this',
  'that',
  'with',
  'as',
  'by',
  'from',
  'at',
  'it',
  'its',
  'into',
  'function',
  'class',
  'public',
  'private',
  'protected',
  'return',
  'void',
  'string',
  'int',
  'bool',
  'array',
  'null',
  'true',
  'false',
  'use',
  'namespace',
]);

/** Tokenise for BM25-style lexical retrieval. */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9_]+/g)
    .filter((t) => t.length > 1 && !STOP.has(t));
}

function bm25Score(
  queryTerms: readonly string[],
  docTokens: readonly string[],
  avgDl: number,
  df: Map<string, number>,
  docCount: number
): number {
  if (queryTerms.length === 0 || docTokens.length === 0) {
    return 0;
  }
  const k1 = 1.2;
  const b = 0.75;
  const tf = new Map<string, number>();
  for (const t of docTokens) {
    tf.set(t, (tf.get(t) ?? 0) + 1);
  }
  const dl = docTokens.length;
  let score = 0;
  for (const term of queryTerms) {
    const f = tf.get(term) ?? 0;
    if (f === 0) {
      continue;
    }
    const n = df.get(term) ?? 0;
    const idf = Math.log(1 + (docCount - n + 0.5) / (n + 0.5));
    const denom = f + k1 * (1 - b + b * (dl / Math.max(avgDl, 1)));
    score += idf * ((f * (k1 + 1)) / denom);
  }
  return score;
}

function cosine(a: readonly number[], b: readonly number[]): number {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) {
    return 0;
  }
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  if (na === 0 || nb === 0) {
    return 0;
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function pathBoost(chunkPath: string, pathHint?: string): number {
  if (!pathHint) {
    return 1;
  }
  const a = chunkPath.replace(/\\/g, '/');
  const b = pathHint.replace(/\\/g, '/');
  if (a === b) {
    return 1.35;
  }
  const aDir = a.includes('/') ? a.slice(0, a.lastIndexOf('/')) : '';
  const bDir = b.includes('/') ? b.slice(0, b.lastIndexOf('/')) : '';
  if (aDir && aDir === bDir) {
    return 1.2;
  }
  const role =
    /(Controller|Service|Job|Model|Request|Policy|Listener|Event|Provider|Middleware)\.php$/i;
  if (role.test(a) && role.test(b)) {
    return 1.1;
  }
  return 1;
}

function memoryBoost(chunk: RagChunk, preferMemory: boolean): number {
  if (chunk.kind === 'memory') {
    return preferMemory ? 1.45 : 1.25;
  }
  return chunk.weight;
}

/**
 * Hybrid retrieve: SQLite FTS4 (when available) + BM25 + optional vectors.
 */
export function retrieve(
  store: RagStore,
  query: string,
  opts: RetrieveOptions = {},
  queryEmbedding?: readonly number[]
): RagHit[] {
  const k = opts.k ?? 8;
  const chunks = store.allChunks();
  if (chunks.length === 0) {
    return [];
  }

  const byId = new Map(chunks.map((c) => [c.id, c]));
  const preferMemory = opts.preferMemory !== false;

  // FTS5 path
  const ftsHits = store.ftsSearch(query, k * 3);
  const lexical = new Map<string, number>();
  for (const hit of ftsHits) {
    const chunk = byId.get(hit.id);
    if (!chunk) {
      continue;
    }
    lexical.set(
      hit.id,
      Math.max(hit.rank, 0.01) * memoryBoost(chunk, preferMemory) * pathBoost(chunk.path, opts.pathHint)
    );
  }

  // Always-on BM25 (fills gaps / no-sqlite fallback)
  const queryTerms = tokenize(query);
  const docs = chunks.map((c) => ({
    chunk: c,
    tokens: tokenize(`${c.symbol ?? ''} ${c.path} ${c.text}`),
  }));
  const df = new Map<string, number>();
  let totalLen = 0;
  for (const d of docs) {
    totalLen += d.tokens.length;
    const seen = new Set(d.tokens);
    for (const t of seen) {
      df.set(t, (df.get(t) ?? 0) + 1);
    }
  }
  const avgDl = totalLen / docs.length;
  for (const d of docs) {
    const base = bm25Score(queryTerms, d.tokens, avgDl, df, docs.length);
    if (base <= 0) {
      continue;
    }
    const score =
      base * memoryBoost(d.chunk, preferMemory) * pathBoost(d.chunk.path, opts.pathHint);
    const prev = lexical.get(d.chunk.id) ?? 0;
    // Prefer the stronger of FTS vs BM25
    lexical.set(d.chunk.id, Math.max(prev, score));
  }

  const vector = new Map<string, number>();
  if (queryEmbedding && queryEmbedding.length > 0) {
    for (const c of chunks) {
      if (!c.embedding || c.embedding.length === 0) {
        continue;
      }
      const sim = cosine(queryEmbedding, c.embedding);
      if (sim <= 0.05) {
        continue;
      }
      vector.set(
        c.id,
        sim * memoryBoost(c, preferMemory) * pathBoost(c.path, opts.pathHint)
      );
    }
  }

  const ids = new Set([...lexical.keys(), ...vector.keys()]);
  const usedFts = ftsHits.length > 0;
  const hits: RagHit[] = [];
  for (const id of ids) {
    const chunk = byId.get(id);
    if (!chunk) {
      continue;
    }
    const lex = lexical.get(id) ?? 0;
    const vec = vector.get(id) ?? 0;
    let score: number;
    let source: RagHit['source'];
    if (lex > 0 && vec > 0) {
      score = lex * 0.65 + vec * 0.35;
      source = 'hybrid';
    } else if (vec > 0) {
      score = vec;
      source = 'vector';
    } else if (usedFts && ftsHits.some((h) => h.id === id)) {
      score = lex;
      source = 'fts';
    } else {
      score = lex;
      source = 'lexical';
    }
    hits.push({ chunk, score, source });
  }

  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, k);
}
