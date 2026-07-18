import { tokenize } from '../rag/retrieve';

const GENERATED_PATH_RE =
  /(^|\/)(generated|gen|\.generated|__generated__|dist|build|out|coverage|\.next)(\/|$)/i;
const GENERATED_NAME_RE =
  /\.(generated|min|bundle|chunk)\.[a-z0-9]+$/i;
const LARGE_FILE_BYTES = 200_000;

/** Paths that look like generated / build output. */
export function isGeneratedPath(relPath: string): boolean {
  const n = relPath.replace(/\\/g, '/');
  return GENERATED_PATH_RE.test(n) || GENERATED_NAME_RE.test(n);
}

/**
 * Heuristic: highly repetitive chunk text (e.g. minified dumps) should be down-ranked.
 * Returns a 0–1 repetition ratio.
 */
export function repetitionRatio(text: string): number {
  if (text.length < 200) {
    return 0;
  }
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 8) {
    // Character n-gram style for minified single-line blobs
    const sample = text.slice(0, 4000);
    const grams = new Map<string, number>();
    for (let i = 0; i + 8 <= sample.length; i += 4) {
      const g = sample.slice(i, i + 8);
      grams.set(g, (grams.get(g) ?? 0) + 1);
    }
    let dup = 0;
    let total = 0;
    for (const c of grams.values()) {
      total += c;
      if (c > 1) {
        dup += c - 1;
      }
    }
    return total === 0 ? 0 : dup / total;
  }
  const counts = new Map<string, number>();
  for (const line of lines) {
    const key = line.trim().slice(0, 120);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  let dup = 0;
  for (const c of counts.values()) {
    if (c > 1) {
      dup += c - 1;
    }
  }
  return dup / lines.length;
}

export function generatedPenalty(input: {
  readonly path: string;
  readonly byteLength?: number;
  readonly textSample?: string;
}): number {
  let penalty = 0;
  if (isGeneratedPath(input.path)) {
    penalty += 40;
  }
  if ((input.byteLength ?? 0) > LARGE_FILE_BYTES) {
    penalty += 25;
  }
  if (input.textSample) {
    const r = repetitionRatio(input.textSample);
    if (r > 0.45) {
      penalty += Math.round(30 * r);
    }
  }
  return penalty;
}

export function queryTerms(query: string): string[] {
  return tokenize(query);
}

/** Split identifiers like partialSubscriptionRefund → tokens. */
export function expandIdentifierTokens(name: string): string[] {
  const parts = name
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_./:-]+/g, ' ')
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 1);
  return [...new Set(parts)];
}

export function pathBasenameScore(query: string, filePath: string): number {
  const terms = queryTerms(query);
  if (terms.length === 0) {
    return 0;
  }
  const norm = filePath.replace(/\\/g, '/').toLowerCase();
  const base = norm.split('/').pop() ?? norm;
  const stem = base.replace(/\.[^.]+$/, '');
  const pathTokens = [
    ...expandIdentifierTokens(stem),
    ...norm.split('/').flatMap((p) => expandIdentifierTokens(p)),
  ];
  const set = new Set(pathTokens);
  let hits = 0;
  for (const t of terms) {
    if (set.has(t) || stem.includes(t) || norm.includes(t)) {
      hits++;
    }
  }
  if (hits === 0) {
    return 0;
  }
  return Math.min(50, Math.round((hits / terms.length) * 50));
}

export function lexicalOverlapScore(query: string, text: string): number {
  const q = queryTerms(query);
  if (q.length === 0 || !text) {
    return 0;
  }
  const doc = new Set(tokenize(text));
  let hits = 0;
  for (const t of q) {
    if (doc.has(t)) {
      hits++;
    }
  }
  if (hits === 0) {
    return 0;
  }
  return Math.min(40, Math.round((hits / q.length) * 40));
}

export function symbolNameScore(query: string, symbolName: string): {
  exact: number;
  alias: number;
} {
  const q = query.trim();
  const name = symbolName.trim();
  if (!q || !name) {
    return { exact: 0, alias: 0 };
  }
  if (q === name || q.toLowerCase() === name.toLowerCase()) {
    return { exact: 100, alias: 0 };
  }
  const qTerms = new Set([...queryTerms(q), ...expandIdentifierTokens(q)]);
  const nTerms = new Set(expandIdentifierTokens(name));
  let overlap = 0;
  for (const t of qTerms) {
    if (nTerms.has(t) || name.toLowerCase().includes(t)) {
      overlap++;
    }
  }
  if (overlap === 0) {
    return { exact: 0, alias: 0 };
  }
  const ratio = overlap / Math.max(qTerms.size, 1);
  if (ratio >= 0.6) {
    return { exact: 0, alias: Math.round(55 * ratio) };
  }
  return { exact: 0, alias: Math.round(30 * ratio) };
}

export function sumBreakdown(b: {
  exactSymbol?: number;
  symbolAlias?: number;
  lexical?: number;
  path?: number;
  importDistance?: number;
  callGraph?: number;
  testRelation?: number;
  instructionScope?: number;
  architecture?: number;
  recency?: number;
  userSelected?: number;
  generatedPenalty?: number;
}): number {
  return (
    (b.exactSymbol ?? 0) +
    (b.symbolAlias ?? 0) +
    (b.lexical ?? 0) +
    (b.path ?? 0) +
    (b.importDistance ?? 0) +
    (b.callGraph ?? 0) +
    (b.testRelation ?? 0) +
    (b.instructionScope ?? 0) +
    (b.architecture ?? 0) +
    (b.recency ?? 0) +
    (b.userSelected ?? 0) -
    (b.generatedPenalty ?? 0)
  );
}

export function confidenceFromScore(
  score: number,
  analysis: 'deterministic' | 'heuristic'
): 'high' | 'medium' | 'low' | 'uncertain' {
  if (score >= 80) {
    return analysis === 'deterministic' ? 'high' : 'medium';
  }
  if (score >= 45) {
    return 'medium';
  }
  if (score >= 20) {
    return 'low';
  }
  return 'uncertain';
}

export function approxTokens(chars: number): number {
  return Math.ceil(chars / 4);
}

export function rangeKey(path: string, start: number, end: number): string {
  return `${path.replace(/\\/g, '/')}:${start}-${end}`;
}

/** Prefer the tighter range when spans overlap heavily. */
export function rangesOverlap(
  a: { path: string; startLine: number; endLine: number },
  b: { path: string; startLine: number; endLine: number }
): boolean {
  if (a.path.replace(/\\/g, '/') !== b.path.replace(/\\/g, '/')) {
    return false;
  }
  return !(a.endLine < b.startLine || b.endLine < a.startLine);
}

export function spanSize(start: number, end: number): number {
  return Math.max(1, end - start + 1);
}
