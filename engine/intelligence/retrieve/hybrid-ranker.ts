import type { SourceReference } from '../contracts';
import { isDeterministicEdgeResolution } from '../contracts';
import { createSourceReference } from '../attribution/index';
import { createCodeGraphQuery } from '../graph/query';
import type { InstructionResolver } from '../instructions/resolver';
import { classificationAllowsModelEvidence } from '../privacy/filter-evidence';
import { retrieve as lexicalRetrieve } from '../rag/retrieve';
import { sha256 } from '../rag/hash';
import type { RagStore } from '../rag/store';
import type { RagSymbolRecord } from '../rag/types';
import {
  approxTokens,
  confidenceFromScore,
  generatedPenalty,
  lexicalOverlapScore,
  pathBasenameScore,
  queryTerms,
  rangesOverlap,
  spanSize,
  sumBreakdown,
  symbolNameScore,
} from './signals';
import type {
  FilteringDecision,
  RepositoryContextResult,
  RetrievalDebugInfo,
  RetrievalHit,
  ScoreBreakdown,
  SearchRepositoryContextOptions,
} from './types';
import { DEFAULT_RETRIEVAL_BUDGETS } from './types';
import { confidenceFromRetrieval, createAttributedClaim } from '../attribution/index';

interface Candidate {
  id: string;
  resultType: RetrievalHit['resultType'];
  path: string;
  symbolId?: string;
  symbolName?: string;
  startLine: number;
  endLine: number;
  excerpt?: string;
  sourceType: SourceReference['sourceType'];
  breakdown: ScoreBreakdown;
  reasonParts: string[];
  analysis: RetrievalHit['analysis'];
  charEstimate: number;
}

function normalise(p: string): string {
  return p.replace(/\\/g, '/');
}

function buildImportDistanceMap(
  store: RagStore,
  seeds: readonly string[],
  maxDepth: number
): Map<string, number> {
  const dist = new Map<string, number>();
  const queue: Array<{ path: string; d: number }> = [];
  for (const s of seeds) {
    const key = normalise(s);
    dist.set(key, 0);
    queue.push({ path: key, d: 0 });
  }
  while (queue.length > 0) {
    const cur = queue.shift()!;
    if (cur.d >= maxDepth) {
      continue;
    }
    const neighbours = new Set<string>();
    for (const e of store.edgesFrom(cur.path)) {
      if (
        e.kind === 'import' ||
        e.kind === 'require' ||
        e.kind === 'fileDependency' ||
        e.kind === 'export'
      ) {
        neighbours.add(normalise(e.toPath));
      }
    }
    for (const e of store.edgesTo(cur.path)) {
      if (
        e.kind === 'import' ||
        e.kind === 'require' ||
        e.kind === 'fileDependency' ||
        e.kind === 'export'
      ) {
        neighbours.add(normalise(e.fromPath));
      }
    }
    for (const n of neighbours) {
      if (dist.has(n)) {
        continue;
      }
      dist.set(n, cur.d + 1);
      queue.push({ path: n, d: cur.d + 1 });
    }
  }
  return dist;
}

/** Inverse-degree damping so high-connectivity hubs do not swamp candidates. */
function hubDamp(degree: number): number {
  return 1 / Math.log2(2 + Math.max(0, degree));
}

function symbolCallDegree(store: RagStore, symbolId: string): number {
  let n = 0;
  for (const e of store.edgesForSymbol(symbolId)) {
    if (e.kind === 'call' || e.kind === 'import' || e.kind === 'require') {
      n++;
    }
  }
  return n;
}

function pathImportDegree(store: RagStore, filePath: string): number {
  const p = normalise(filePath);
  let n = 0;
  for (const e of store.edgesFrom(p)) {
    if (e.kind === 'import' || e.kind === 'require' || e.kind === 'export') n++;
  }
  for (const e of store.edgesTo(p)) {
    if (e.kind === 'import' || e.kind === 'require' || e.kind === 'export') n++;
  }
  return n;
}

const MAX_CALL_FANOUT_PER_SEED = 12;

function recencyScore(mtimeMs: number | undefined, newest: number, oldest: number): number {
  if (mtimeMs === undefined || newest <= oldest) {
    return 0;
  }
  const t = (mtimeMs - oldest) / (newest - oldest);
  // Weak signal: max 8 points
  return Math.round(t * 8);
}

function reasonFromBreakdown(b: ScoreBreakdown, parts: string[]): string {
  if (parts.length > 0) {
    return parts.slice(0, 3).join('; ');
  }
  const labels: string[] = [];
  if ((b.exactSymbol ?? 0) > 0) labels.push('exact symbol match');
  if ((b.symbolAlias ?? 0) > 0) labels.push('symbol / export name overlap');
  if ((b.lexical ?? 0) > 0) labels.push('lexical relevance');
  if ((b.path ?? 0) > 0) labels.push('path / module name relevance');
  if ((b.importDistance ?? 0) > 0) labels.push('import / dependency neighbourhood');
  if ((b.callGraph ?? 0) > 0) labels.push('call graph relationship');
  if ((b.testRelation ?? 0) > 0) labels.push('related test evidence');
  if ((b.instructionScope ?? 0) > 0) labels.push('applicable instruction scope');
  if ((b.architecture ?? 0) > 0) labels.push('architecture / ADR relevance');
  if ((b.userSelected ?? 0) > 0) labels.push('explicitly selected by user');
  if ((b.recency ?? 0) > 0) labels.push('weak recency signal');
  if ((b.generatedPenalty ?? 0) > 0) labels.push('down-ranked generated/large content');
  return labels.slice(0, 3).join('; ') || 'combined hybrid score';
}

function toHit(c: Candidate, store: RagStore): RetrievalHit {
  const score = sumBreakdown(c.breakdown);
  const file = store.getFile(c.path);
  const workspaceId = store.workspaceId ?? sha256(store.root).slice(0, 16);
  return {
    id: c.id,
    resultType: c.resultType,
    score,
    breakdown: c.breakdown,
    reference: createSourceReference({
      workspaceId,
      path: c.path,
      startLine: c.startLine,
      endLine: c.endLine,
      sourceType: c.sourceType,
      sourceFingerprint: file?.hash ?? '',
      symbolId: c.symbolId,
      symbol: c.symbolName,
      excerpt: c.excerpt?.slice(0, 240),
      extraction: c.analysis,
    }),
    reason: reasonFromBreakdown(c.breakdown, c.reasonParts),
    confidence: confidenceFromScore(score, c.analysis),
    analysis: c.analysis,
    path: c.path,
    symbolId: c.symbolId,
    symbolName: c.symbolName,
    charEstimate: c.charEstimate,
  };
}

function mergeBreakdown(a: ScoreBreakdown, b: ScoreBreakdown): ScoreBreakdown {
  return {
    exactSymbol: Math.max(a.exactSymbol ?? 0, b.exactSymbol ?? 0) || undefined,
    symbolAlias: Math.max(a.symbolAlias ?? 0, b.symbolAlias ?? 0) || undefined,
    lexical: Math.max(a.lexical ?? 0, b.lexical ?? 0) || undefined,
    path: Math.max(a.path ?? 0, b.path ?? 0) || undefined,
    importDistance: Math.max(a.importDistance ?? 0, b.importDistance ?? 0) || undefined,
    callGraph: Math.max(a.callGraph ?? 0, b.callGraph ?? 0) || undefined,
    testRelation: Math.max(a.testRelation ?? 0, b.testRelation ?? 0) || undefined,
    instructionScope: Math.max(a.instructionScope ?? 0, b.instructionScope ?? 0) || undefined,
    architecture: Math.max(a.architecture ?? 0, b.architecture ?? 0) || undefined,
    recency: Math.max(a.recency ?? 0, b.recency ?? 0) || undefined,
    userSelected: Math.max(a.userSelected ?? 0, b.userSelected ?? 0) || undefined,
    generatedPenalty:
      Math.max(a.generatedPenalty ?? 0, b.generatedPenalty ?? 0) || undefined,
  };
}

/**
 * Deterministic hybrid ranker over RagStore (+ optional instruction resolver).
 * No embedding dependency required.
 */
export async function hybridSearchRepositoryContext(
  store: RagStore,
  query: string,
  options: SearchRepositoryContextOptions = {},
  instructionResolver?: InstructionResolver
): Promise<RepositoryContextResult> {
  const started = Date.now();
  const budgets = { ...DEFAULT_RETRIEVAL_BUDGETS, ...options.budgets };
  const maxCharBudget =
    options.budgets?.maxChars ??
    (options.budgets?.maxTokensApprox !== undefined
      ? options.budgets.maxTokensApprox * 4
      : budgets.maxChars);
  const expand = options.expandContextLines ?? 0;
  const selectedSet = new Set(
    (options.selectedFiles ?? []).map((p) => normalise(p))
  );
  const pathHint = options.pathHint ? normalise(options.pathHint) : undefined;
  const q = query.trim();
  const candidates = new Map<string, Candidate>();
  const filtering: FilteringDecision[] = [];
  const rejected: FilteringDecision[] = [];

  const upsert = (c: Candidate): void => {
    const existing = candidates.get(c.id);
    if (!existing) {
      candidates.set(c.id, c);
      return;
    }
    candidates.set(c.id, {
      ...existing,
      breakdown: mergeBreakdown(existing.breakdown, c.breakdown),
      reasonParts: [...new Set([...existing.reasonParts, ...c.reasonParts])],
      analysis:
        existing.analysis === 'deterministic' || c.analysis === 'deterministic'
          ? 'deterministic'
          : 'heuristic',
      excerpt: existing.excerpt ?? c.excerpt,
      charEstimate: Math.min(existing.charEstimate, c.charEstimate),
      startLine: Math.min(existing.startLine, c.startLine),
      endLine: Math.max(existing.endLine, c.endLine),
    });
  };

  const files = store.allFilePaths();
  let newest = 0;
  let oldest = Number.POSITIVE_INFINITY;
  for (const p of files) {
    const f = store.getFile(p);
    if (!f) continue;
    newest = Math.max(newest, f.mtimeMs);
    oldest = Math.min(oldest, f.mtimeMs);
  }
  if (!Number.isFinite(oldest)) {
    oldest = newest;
  }

  const seedPaths = new Set<string>();
  if (pathHint) seedPaths.add(pathHint);
  for (const s of selectedSet) seedPaths.add(s);

  // --- 1) Exact + alias symbol matches
  const allSymbols = store.allSymbols();
  for (const sym of allSymbols) {
    const { exact, alias } = symbolNameScore(q, sym.name);
    if (exact === 0 && alias === 0) {
      continue;
    }
    const file = store.getFile(sym.path);
    const penalty = generatedPenalty({
      path: sym.path,
      byteLength: file?.byteLength,
    });
    const breakdown: ScoreBreakdown = {
      exactSymbol: exact || undefined,
      symbolAlias: alias || undefined,
      path: pathBasenameScore(q, sym.path) || undefined,
      recency: recencyScore(file?.mtimeMs, newest, oldest) || undefined,
      userSelected: selectedSet.has(normalise(sym.path)) ? 120 : undefined,
      generatedPenalty: penalty || undefined,
    };
    const reasonParts: string[] = [];
    if (exact) reasonParts.push(`exact symbol match for "${sym.name}"`);
    if (alias) reasonParts.push(`exported/symbol name overlap with "${sym.name}"`);
    upsert({
      id: `sym:${sym.id}`,
      resultType: 'symbol',
      path: normalise(sym.path),
      symbolId: sym.id,
      symbolName: sym.name,
      startLine: Math.max(1, sym.startLine - expand),
      endLine: sym.endLine + expand,
      sourceType: 'symbol',
      breakdown,
      reasonParts,
      analysis: exact > 0 ? 'deterministic' : 'heuristic',
      charEstimate: Math.max(80, (sym.endLine - sym.startLine + 1) * 40),
    });
    seedPaths.add(normalise(sym.path));
  }

  // Also match query against exported const / alias via graph edges (export kind)
  for (const edge of store.allEdges()) {
    if (edge.kind !== 'export' && edge.kind !== 'import') continue;
    if (!edge.specifier) continue;
    const { alias } = symbolNameScore(q, edge.specifier);
    if (alias < 20) continue;
    upsert({
      id: `alias:${edge.id}`,
      resultType: 'dependency',
      path: normalise(edge.fromPath),
      startLine: edge.startLine ?? 1,
      endLine: edge.endLine ?? edge.startLine ?? 1,
      sourceType: 'dependency',
      symbolName: edge.specifier,
      breakdown: {
        symbolAlias: alias,
        path: pathBasenameScore(q, edge.fromPath) || undefined,
      },
      reasonParts: [`export/import alias "${edge.specifier}" overlaps query`],
      analysis: isDeterministicEdgeResolution(edge.resolutionMethod)
        ? 'deterministic'
        : 'heuristic',
      charEstimate: 120,
    });
  }

  // --- 2) Path / module relevance for files
  for (const p of files) {
    const pathScore = pathBasenameScore(q, p);
    const userBoost = selectedSet.has(normalise(p)) ? 120 : 0;
    if (pathScore === 0 && userBoost === 0 && pathHint !== normalise(p)) {
      continue;
    }
    const file = store.getFile(p);
    const penalty = generatedPenalty({
      path: p,
      byteLength: file?.byteLength,
    });
    const reasonParts: string[] = [];
    if (pathScore > 0) reasonParts.push(`path/module tokens match "${p}"`);
    if (userBoost > 0) reasonParts.push(`explicitly selected file ${p}`);
    upsert({
      id: `file:${normalise(p)}`,
      resultType: 'file',
      path: normalise(p),
      startLine: 1,
      endLine: 1,
      sourceType: 'source',
      breakdown: {
        path: pathScore || undefined,
        userSelected: userBoost || undefined,
        recency: recencyScore(file?.mtimeMs, newest, oldest) || undefined,
        generatedPenalty: penalty || undefined,
      },
      reasonParts,
      analysis: userBoost > 0 ? 'deterministic' : 'heuristic',
      charEstimate: Math.min(file?.byteLength ?? 400, 2000),
    });
    if (pathScore >= 20 || userBoost > 0) {
      seedPaths.add(normalise(p));
    }
  }

  // --- 3) Lexical chunk hits
  const lexHits = lexicalRetrieve(store, q, {
    k: Math.max(budgets.maxChunks * 2, 16),
    pathHint,
    preferMemory: options.preferMemory ?? true,
  });
  for (const hit of lexHits) {
    const chunk = hit.chunk;
    const lex = Math.min(45, hit.score * 3 + lexicalOverlapScore(q, chunk.text));
    const penalty = generatedPenalty({
      path: chunk.path,
      textSample: chunk.text,
      byteLength: store.getFile(chunk.path)?.byteLength,
    });
    if (penalty >= 50 && lex < 25) {
      rejected.push({
        id: `chunk:${chunk.id}`,
        path: chunk.path,
        action: 'reject',
        reason: 'generated/repetitive content dominated lexical hit',
      });
      continue;
    }
    upsert({
      id: `chunk:${chunk.id}`,
      resultType: 'chunk',
      path: normalise(chunk.path),
      symbolName: chunk.symbol,
      startLine: Math.max(1, chunk.startLine - expand),
      endLine: chunk.endLine + expand,
      excerpt: chunk.text.slice(0, 240),
      sourceType:
        chunk.kind === 'memory' ? 'memory' : chunk.symbol ? 'symbol' : 'lexical',
      breakdown: {
        lexical: lex,
        path: pathBasenameScore(q, chunk.path) || undefined,
        generatedPenalty: penalty || undefined,
        userSelected: selectedSet.has(normalise(chunk.path)) ? 120 : undefined,
      },
      reasonParts: [
        `lexical match in ${chunk.path} (lines ${chunk.startLine}–${chunk.endLine})`,
      ],
      analysis: 'heuristic',
      charEstimate: Math.min(chunk.text.length, 1500),
    });
  }

  // --- 4) Import distance from seeds
  const importDist = buildImportDistanceMap(
    store,
    [...seedPaths],
    budgets.maxDependencyDepth
  );
  for (const [p, d] of importDist) {
    if (d === 0) continue;
    const score = Math.max(5, 35 - (d - 1) * 12);
    const damp = hubDamp(pathImportDegree(store, p));
    upsert({
      id: `dep:${p}`,
      resultType: 'dependency',
      path: p,
      startLine: 1,
      endLine: 1,
      sourceType: 'dependency',
      breakdown: {
        importDistance: Math.max(1, Math.round(score * damp)),
        path: pathBasenameScore(q, p) || undefined,
        generatedPenalty: generatedPenalty({ path: p }) || undefined,
      },
      reasonParts: [
        `dependency distance ${d} from seed files`,
        damp < 0.85 ? 'hub-damped' : '',
      ].filter(Boolean),
      analysis: 'deterministic',
      charEstimate: 200,
    });
  }

  // --- 5) Call graph + test relations via code graph query
  const graph = createCodeGraphQuery(store);
  const seedSymbols: RagSymbolRecord[] = [];
  for (const sym of allSymbols) {
    const { exact, alias } = symbolNameScore(q, sym.name);
    if (exact > 0 || alias >= 35) {
      seedSymbols.push(sym);
    }
  }
  for (const sym of seedSymbols.slice(0, 12)) {
    const seedDegree = symbolCallDegree(store, sym.id);
    const callers = graph.getCallers(sym.id).slice(0, MAX_CALL_FANOUT_PER_SEED);
    for (const edge of callers) {
      const targetDegree = edge.fromSymbol
        ? symbolCallDegree(store, edge.fromSymbol)
        : pathImportDegree(store, edge.fromPath);
      const damp = hubDamp(Math.max(seedDegree, targetDegree));
      const base = edge.confidence === 'certain' ? 40 : 22;
      upsert({
        id: `call:${edge.id}`,
        resultType: 'symbol',
        path: normalise(edge.fromPath),
        symbolId: edge.fromSymbol,
        startLine: edge.startLine ?? 1,
        endLine: edge.endLine ?? edge.startLine ?? 1,
        sourceType: 'dependency',
        breakdown: {
          callGraph: Math.max(1, Math.round(base * damp)),
        },
        reasonParts: [
          `caller of ${sym.name} at ${edge.fromPath}`,
          damp < 0.85 ? 'hub-damped' : '',
        ].filter(Boolean),
        analysis:
          edge.confidence === 'certain' ||
          isDeterministicEdgeResolution(edge.resolutionMethod)
            ? 'deterministic'
            : 'heuristic',
        charEstimate: 160,
      });
    }
    const callees = graph.getCallees(sym.id).slice(0, MAX_CALL_FANOUT_PER_SEED);
    for (const edge of callees) {
      const targetDegree = edge.toSymbol
        ? symbolCallDegree(store, edge.toSymbol)
        : pathImportDegree(store, edge.toPath);
      const damp = hubDamp(Math.max(seedDegree, targetDegree));
      const base = edge.confidence === 'certain' ? 35 : 18;
      upsert({
        id: `callee:${edge.id}`,
        resultType: 'symbol',
        path: normalise(edge.toPath),
        symbolId: edge.toSymbol,
        startLine: edge.startLine ?? 1,
        endLine: edge.endLine ?? edge.startLine ?? 1,
        sourceType: 'dependency',
        breakdown: {
          callGraph: Math.max(1, Math.round(base * damp)),
        },
        reasonParts: [
          `callee of ${sym.name}`,
          damp < 0.85 ? 'hub-damped' : '',
        ].filter(Boolean),
        analysis:
          edge.confidence === 'certain' ||
          isDeterministicEdgeResolution(edge.resolutionMethod)
            ? 'deterministic'
            : 'heuristic',
        charEstimate: 160,
      });
    }
    for (const rel of graph.getRelatedTests(sym.id)) {
      const confBoost =
        rel.confidence === 'certain' || rel.confidence === 'high' ? 45 : 20;
      upsert({
        id: `test:${rel.edge.id}`,
        resultType: 'test',
        path: normalise(rel.edge.fromPath),
        startLine: rel.edge.startLine ?? 1,
        endLine: rel.edge.endLine ?? rel.edge.startLine ?? 1,
        sourceType: 'dependency',
        breakdown: {
          testRelation: confBoost,
        },
        reasonParts: [
          `related test ${rel.edge.fromPath} (${(rel.evidence ?? []).slice(0, 2).join(', ') || rel.confidence})`,
        ],
        analysis:
          rel.confidence === 'heuristic' ||
          !isDeterministicEdgeResolution(rel.edge.resolutionMethod)
            ? 'heuristic'
            : 'deterministic',
        charEstimate: 400,
      });
    }
  }

  // Also surface likelyTestCoverage edges whose toPath matches path-relevant files
  for (const edge of store.allEdges()) {
    if (edge.kind !== 'likelyTestCoverage') continue;
    const pathScore = Math.max(
      pathBasenameScore(q, edge.toPath),
      pathBasenameScore(q, edge.fromPath)
    );
    if (pathScore < 15 && !seedPaths.has(normalise(edge.toPath))) continue;
    upsert({
      id: `testcov:${edge.id}`,
      resultType: 'test',
      path: normalise(edge.fromPath),
      startLine: edge.startLine ?? 1,
      endLine: edge.endLine ?? edge.startLine ?? 1,
      sourceType: 'dependency',
      breakdown: {
        testRelation: edge.confidence === 'heuristic' ? 18 : 38,
        path: pathScore || undefined,
      },
      reasonParts: [
        `test coverage edge → ${edge.toPath} [${(edge.evidence ?? []).slice(0, 2).join(', ')}]`,
      ],
      analysis:
        edge.confidence === 'heuristic' ||
        !isDeterministicEdgeResolution(edge.resolutionMethod)
          ? 'heuristic'
          : 'deterministic',
      charEstimate: 400,
    });
  }

  // --- 6) Instructions + architecture/ADR for top seed paths
  if (instructionResolver) {
    const targets = [...seedPaths].slice(0, 6);
    if (targets.length === 0 && pathHint) {
      targets.push(pathHint);
    }
    // Fallback: pick best path-scored files
    if (targets.length === 0) {
      const rankedFiles = files
        .map((p) => ({ p, s: pathBasenameScore(q, p) }))
        .filter((x) => x.s > 0)
        .sort((a, b) => b.s - a.s)
        .slice(0, 3);
      for (const f of rankedFiles) targets.push(f.p);
    }
    for (const target of targets) {
      try {
        const docs = await instructionResolver.getApplicableDocuments(target);
        for (const doc of docs.slice(0, 8)) {
          const isArch =
            doc.documentType === 'architecture' || doc.documentType === 'decision';
          const isInstruction =
            doc.documentType === 'instruction' || doc.documentType === 'convention';
          const isReadme = /readme/i.test(doc.path);
          // Unrelated README should not dominate conceptual queries
          const lex = lexicalOverlapScore(q, doc.title + ' ' + (doc.path ?? ''));
          if (isReadme && lex < 12 && pathBasenameScore(q, doc.path) < 10) {
            rejected.push({
              id: `doc:${doc.id}`,
              path: doc.path,
              action: 'reject',
              reason: 'unrelated README/contextual doc without query overlap',
            });
            continue;
          }
          const archScore = isArch ? 28 + Math.min(lex, 15) : 0;
          const instrScore = isInstruction ? 32 : lex > 10 ? 12 : 0;
          if (archScore === 0 && instrScore === 0) continue;
          upsert({
            id: `doc:${doc.id}`,
            resultType: isArch ? 'architecture' : 'instruction',
            path: normalise(doc.path),
            startLine: 1,
            endLine: 40,
            sourceType: 'instruction',
            excerpt: doc.title,
            breakdown: {
              instructionScope: instrScore || undefined,
              architecture: archScore || undefined,
              lexical: lex || undefined,
            },
            reasonParts: [
              isArch
                ? `architecture/ADR document applicable to ${target}`
                : `scoped instruction document for ${target}`,
            ],
            analysis: 'deterministic',
            charEstimate: 800,
          });
        }
      } catch {
        // instruction discovery optional
      }
    }
  }

  // --- Rank, dedupe overlapping spans, apply budgets
  let ranked = [...candidates.values()]
    .map((c) => toHit(c, store))
    .filter((h) => h.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      // Deterministic tie-break
      if (a.path !== b.path) return a.path.localeCompare(b.path);
      if (a.reference.startLine !== b.reference.startLine) {
        return a.reference.startLine - b.reference.startLine;
      }
      return a.id.localeCompare(b.id);
    });

  const candidateCount = ranked.length;

  // Dedupe overlapping evidence — keep tighter useful range
  const kept: RetrievalHit[] = [];
  for (const hit of ranked) {
    const overlapIdx = kept.findIndex((k) =>
      rangesOverlap(
        {
          path: k.path,
          startLine: k.reference.startLine,
          endLine: k.reference.endLine,
        },
        {
          path: hit.path,
          startLine: hit.reference.startLine,
          endLine: hit.reference.endLine,
        }
      )
    );
    if (overlapIdx >= 0) {
      const existing = kept[overlapIdx]!;
      const existingSpan = spanSize(
        existing.reference.startLine,
        existing.reference.endLine
      );
      const hitSpan = spanSize(hit.reference.startLine, hit.reference.endLine);
      // Prefer higher score; if close, prefer smaller span
      if (
        hit.score > existing.score + 5 ||
        (Math.abs(hit.score - existing.score) <= 5 && hitSpan < existingSpan)
      ) {
        filtering.push({
          id: existing.id,
          path: existing.path,
          action: 'dedupe',
          reason: `replaced by tighter/higher ${hit.id}`,
        });
        kept[overlapIdx] = hit;
      } else {
        filtering.push({
          id: hit.id,
          path: hit.path,
          action: 'dedupe',
          reason: `overlaps ${existing.id}; kept smaller/higher-scoring range`,
        });
      }
      continue;
    }
    kept.push(hit);
  }
  ranked = kept;

  // Type budgets + char/token budget
  const selected: RetrievalHit[] = [];
  let filesN = 0;
  let symbolsN = 0;
  let chunksN = 0;
  let chars = 0;
  const maxTokens = budgets.maxTokensApprox;
  const k = options.k ?? Math.max(budgets.maxFiles, budgets.maxSymbols, 16);

  for (const hit of ranked) {
    if (selected.length >= k) {
      rejected.push({
        id: hit.id,
        path: hit.path,
        action: 'budget',
        reason: `truncated after k=${k}`,
      });
      continue;
    }
    if (hit.resultType === 'file' && filesN >= budgets.maxFiles) {
      rejected.push({
        id: hit.id,
        path: hit.path,
        action: 'budget',
        reason: 'maxFiles budget',
      });
      continue;
    }
    if (hit.resultType === 'symbol' && symbolsN >= budgets.maxSymbols) {
      rejected.push({
        id: hit.id,
        path: hit.path,
        action: 'budget',
        reason: 'maxSymbols budget',
      });
      continue;
    }
    if (hit.resultType === 'chunk' && chunksN >= budgets.maxChunks) {
      rejected.push({
        id: hit.id,
        path: hit.path,
        action: 'budget',
        reason: 'maxChunks budget',
      });
      continue;
    }
    const nextChars = chars + hit.charEstimate;
    if (nextChars > maxCharBudget || approxTokens(nextChars) > maxTokens) {
      rejected.push({
        id: hit.id,
        path: hit.path,
        action: 'budget',
        reason: 'character/token budget',
      });
      continue;
    }
    selected.push(hit);
    chars = nextChars;
    if (hit.resultType === 'file') filesN++;
    if (hit.resultType === 'symbol') symbolsN++;
    if (hit.resultType === 'chunk') chunksN++;
    filtering.push({
      id: hit.id,
      path: hit.path,
      action: 'keep',
      reason: hit.reason,
    });
  }

  const notes: string[] = [];
  if (selected.length === 0) {
    notes.push('No matching evidence in the local index; answer with uncertainty.');
  }
  // Never put full file contents in notes
  notes.push(
    `Hybrid retrieval considered ${candidateCount} candidates; selected ${selected.length}.`
  );

  let modelFiltered = selected;
  if (options.forModelEvidence) {
    const before = modelFiltered.length;
    modelFiltered = modelFiltered.filter((hit) => {
      const file = store.getFile(hit.path);
      return classificationAllowsModelEvidence(file?.privacy);
    });
    if (modelFiltered.length < before) {
      notes.push(
        `Filtered ${before - modelFiltered.length} hit(s) blocked for model evidence by privacy classification.`
      );
    }
  }

  let debug: RetrievalDebugInfo | undefined;
  if (options.debug) {
    debug = {
      candidateCount,
      selectedCount: modelFiltered.length,
      rejected,
      filtering,
      scoreComponents: ranked.slice(0, 40).map((h) => ({
        id: h.id,
        breakdown: h.breakdown,
        total: h.score,
      })),
      selectedIds: modelFiltered.map((h) => h.id),
      rejectedIds: rejected.map((r) => r.id),
      elapsedMs: Date.now() - started,
      notes: [
        `queryTerms=${queryTerms(q).join(',')}`,
        `seedPaths=${[...seedPaths].slice(0, 12).join(',')}`,
        `budgets files=${budgets.maxFiles} symbols=${budgets.maxSymbols} chunks=${budgets.maxChunks} chars=${maxCharBudget}`,
      ],
    };
  }

  return {
    workspaceRoot: store.root,
    query: q,
    results: modelFiltered,
    incomplete:
      modelFiltered.length === 0 ||
      modelFiltered.every((h) => h.confidence === 'uncertain'),
    notes,
    debug,
  };
}

/** Map hybrid hits into ContextClaim shape for RepositoryIndex.retrieve. */
export function hitsToClaims(hits: readonly RetrievalHit[]): {
  claims: import('../contracts').ContextClaim[];
  references: SourceReference[];
} {
  const claims = hits.map((h, i) =>
    createAttributedClaim({
      id: h.id || `claim:${i}`,
      text: `${h.reason} (${h.resultType} · score ${h.score.toFixed(1)} · ${h.analysis}).`,
      references: [h.reference],
      confidenceDetail: confidenceFromRetrieval({
        analysis: h.analysis,
        hitConfidence: h.confidence,
        independentSourceCount: 1,
      }),
      score: h.score,
    })
  );
  return {
    claims,
    references: hits.map((h) => h.reference),
  };
}
