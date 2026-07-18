import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  assembleTaskContextPack,
  collectProjectProfile,
  createCodeGraphQuery,
  createInstructionResolver,
  createRepositorySearchEngine,
  detectTaskRiskIndicators,
  MEMORY_DIR,
  parseTaskContextDepth,
  RAG_DIR,
  scanProdRisks,
  writeTaskContextPack,
  type DependencyEdgeKind,
  type ExplanationMode,
  type IntelligenceProfile,
  type TaskContextDepth,
} from '@mergecore/intelligence';
import { errorResult, logMeta, textResult } from './errors.js';
import { openSharedIndex, requireNonEmptyIndex, STORE_SCHEMA_VERSION } from './open-index.js';
import { assertWorkspacePermitted, filterIgnoredPaths, safeRelPath } from './security.js';
import {
  loadPackRegistry,
  locateRulesRegistry,
  readPackAgents,
  readPackManifest,
  resolveWorkspaceRoot,
} from './workspace.js';

const RELATIONSHIP_KINDS = [
  'import',
  'require',
  'export',
  'reference',
  'call',
  'extends',
  'implements',
  'typeUsage',
  'fileDependency',
  'likelyTestCoverage',
] as const satisfies readonly DependencyEdgeKind[];

type RelationshipKind = (typeof RELATIONSHIP_KINDS)[number];

function isRelationshipKind(value: string): value is RelationshipKind {
  return (RELATIONSHIP_KINDS as readonly string[]).includes(value);
}

async function withOpenedIndex(
  tool: string,
  requireChunks: boolean,
  run: (opened: Awaited<ReturnType<typeof openSharedIndex>> & { ok: true }) => Promise<
    ReturnType<typeof textResult> | ReturnType<typeof errorResult>
  >
) {
  const opened = await openSharedIndex(tool);
  if (!opened.ok) return opened.response;
  try {
    if (requireChunks) {
      const empty = await requireNonEmptyIndex(opened.opened);
      if (empty) return empty;
    }
    return await run(opened as Awaited<ReturnType<typeof openSharedIndex>> & { ok: true });
  } finally {
    await opened.opened.close();
  }
}

function serialiseHit(hit: {
  path: string;
  score: number;
  reason: string;
  confidence: string;
  resultType: string;
  symbolName?: string;
  symbolId?: string;
  reference: {
    path: string;
    startLine: number;
    endLine: number;
    sourceType: string;
    symbol?: string;
    excerpt?: string;
  };
}) {
  return {
    path: hit.path,
    symbol: hit.symbolName ?? hit.reference.symbol,
    symbolId: hit.symbolId,
    kind: hit.resultType,
    score: hit.score,
    reason: hit.reason,
    confidence: hit.confidence,
    reference: {
      path: hit.reference.path,
      startLine: hit.reference.startLine,
      endLine: hit.reference.endLine,
      sourceType: hit.reference.sourceType,
      symbol: hit.reference.symbol,
      excerpt: hit.reference.excerpt?.slice(0, 400),
    },
  };
}

export async function buildIndexStatusPayload() {
  return withOpenedIndex('index_status', false, async ({ opened }) => {
    const status = await opened.indexer.getIndexStatus();
    const exclusions = status.exclusions ?? [];
    const parseFailureCount = exclusions.filter(
      (e) => e.reason === 'unsupported' || e.detail?.includes('parse')
    ).length;
    const exclusionFailureCount = exclusions.length || status.filesSkipped;
    const storeDir = status.storeDir || join(opened.workspaceRoot, RAG_DIR);
    logMeta('index_status', opened.workspaceRoot, {
      chunks: status.chunkCount,
      files: status.fileCount,
    });
    return textResult({
      workspaceRoot: status.workspaceRoot,
      ready: status.ready,
      busy: status.busy,
      phase: status.phase,
      updatedAt: status.updatedAt,
      fileCount: status.fileCount,
      chunkCount: status.chunkCount,
      symbolCount: status.symbolCount,
      edgeCount: status.edgeCount,
      filesIndexed: status.filesIndexed,
      filesSkipped: status.filesSkipped,
      filesPending: status.filesPending,
      hasSqlite: status.hasSqlite,
      storeDir,
      schemaVersion: status.schemaVersion ?? STORE_SCHEMA_VERSION,
      STORE_SCHEMA_VERSION,
      fingerprint: status.fingerprint,
      lastError: status.lastError,
      parseFailureCount,
      exclusionFailureCount,
      exclusions: exclusions.slice(0, 50),
    });
  });
}

export async function toolIndexStatus() {
  return buildIndexStatusPayload();
}

export async function toolIndexRepository() {
  return withOpenedIndex('mergecore_index', false, async ({ opened }) => {
    const profile = await collectProjectProfile(opened.workspaceRoot);
    const status = await opened.indexer.startInitialIndex();
    logMeta('mergecore_index', opened.workspaceRoot, {
      chunks: status.chunkCount,
      files: status.fileCount,
    });
    return textResult({
      workspaceRoot: status.workspaceRoot,
      filesIndexed: status.fileCount,
      chunks: status.chunkCount,
      symbols: status.symbolCount,
      edges: status.edgeCount,
      storeDir: status.storeDir,
      schemaVersion: status.schemaVersion ?? STORE_SCHEMA_VERSION,
      fingerprint: profile.fingerprint,
      signals: profile.signals,
      stacks: profile.stacks,
    });
  });
}

export async function toolSearchRepositoryContext(args: {
  query: string;
  k?: number;
  pathHint?: string;
  maxFiles?: number;
  maxSymbols?: number;
  maxDependencyDepth?: number;
  preferMemory?: boolean;
  mode?: ExplanationMode;
  profile?: IntelligenceProfile;
}) {
  if (!args.query?.trim()) {
    return errorResult('malformed_request', 'query is required');
  }
  return withOpenedIndex('search_repository_context', true, async ({ opened }) => {
    let pathHint = args.pathHint;
    if (pathHint) {
      const safe = await safeRelPath(opened.workspaceRoot, pathHint);
      if (!safe.ok) return safe.response;
      pathHint = safe.rel;
    }
    const engine = await createRepositorySearchEngine({ store: opened.store });
    const result = await engine.searchRepositoryContext(args.query, {
      k: args.k ?? 12,
      pathHint,
      preferMemory: args.preferMemory ?? true,
      mode: args.mode,
      profile: args.profile,
      budgets: {
        maxFiles: args.maxFiles,
        maxSymbols: args.maxSymbols,
        maxDependencyDepth: args.maxDependencyDepth,
      },
    });
    const paths = await filterIgnoredPaths(
      opened.workspaceRoot,
      result.results.map((h) => h.path)
    );
    const allowed = new Set(paths);
    const hits = result.results.filter((h) => allowed.has(h.path)).map(serialiseHit);
    logMeta('search_repository_context', opened.workspaceRoot, { hits: hits.length });
    return textResult({
      workspaceRoot: result.workspaceRoot,
      query: result.query,
      incomplete: result.incomplete,
      notes: result.notes,
      hits,
      storeDir: opened.store.storeDirectory,
    });
  });
}

/** Alias: hybrid search (not lexical-only retrieve). */
export async function toolRetrieve(args: {
  query: string;
  k?: number;
  pathHint?: string;
  mode?: ExplanationMode;
  profile?: IntelligenceProfile;
  preferMemory?: boolean;
}) {
  return toolSearchRepositoryContext(args);
}

export async function toolExplainSymbol(args: {
  symbol: string;
  filePath?: string;
  exact?: boolean;
}) {
  if (!args.symbol?.trim()) {
    return errorResult('malformed_request', 'symbol is required');
  }
  return withOpenedIndex('explain_symbol', true, async ({ opened }) => {
    let pathPrefix: string | undefined;
    if (args.filePath) {
      const safe = await safeRelPath(opened.workspaceRoot, args.filePath);
      if (!safe.ok) return safe.response;
      pathPrefix = safe.rel;
    }
    const graph = createCodeGraphQuery(opened.store, opened.indexer.getCodeGraphService());
    const matches = graph.findSymbol(args.symbol, {
      exact: args.exact ?? false,
      pathPrefix,
    });
    if (matches.length === 0) {
      return errorResult('malformed_request', `No symbol found for "${args.symbol}"`, {
        symbol: args.symbol,
        filePath: pathPrefix,
      });
    }
    if (matches.length > 1 && !pathPrefix) {
      return errorResult(
        'ambiguous_symbol',
        `Multiple symbols named "${args.symbol}"; pass filePath to disambiguate.`,
        {
          matches: matches.slice(0, 12).map((m) => ({
            id: m.id,
            name: m.name,
            kind: m.kind,
            path: m.location.path,
            startLine: m.location.startLine,
            endLine: m.location.endLine,
            language: m.language,
          })),
        }
      );
    }
    const sym = matches[0]!;
    if (!['typescript', 'javascript', 'tsx', 'jsx', 'ts', 'js'].includes(sym.language.toLowerCase())) {
      // Still return graph evidence when present; flag unsupported for non-indexed langs with no signature.
      if (!sym.signatureText && matches.every((m) => !m.signatureText)) {
        // continue — graph may still have useful edges
      }
    }

    const callers = graph.getCallers(sym.id);
    const callees = graph.getCallees(sym.id);
    const deps = graph.getDependencies(sym.id);
    const tests = graph.getRelatedTests(sym.id);
    const resolver = await createInstructionResolver({ workspaceRoot: opened.workspaceRoot });
    const instructions = await resolver.getApplicableInstructions(sym.location.path);
    const riskBlob = [
      sym.signatureText ?? '',
      sym.jsdocSummary ?? '',
      ...callees.map((e) => e.specifier),
      ...deps.map((e) => e.specifier),
    ].join('\n');
    const risks = detectTaskRiskIndicators({
      blob: riskBlob,
      callerCount: callers.length,
      relatedTestCount: tests.length,
    });

    const purpose =
      sym.jsdocSummary?.trim() ||
      `Indexed ${sym.kind} “${sym.name}” in ${sym.location.path}:${sym.location.startLine}`;

    return textResult({
      workspaceRoot: opened.workspaceRoot,
      symbol: {
        id: sym.id,
        name: sym.name,
        kind: sym.kind,
        language: sym.language,
        exported: sym.exported,
        containerName: sym.containerName,
        path: sym.location.path,
        startLine: sym.location.startLine,
        endLine: sym.location.endLine,
        signature: sym.signatureText,
        returnType: sym.returnTypeText,
        parameters: sym.parameters,
      },
      purpose,
      dependencies: deps.slice(0, 40).map((e) => ({
        kind: e.kind,
        from: e.fromPath,
        to: e.toPath,
        specifier: e.specifier,
        confidence: e.confidence,
      })),
      callers: callers.slice(0, 40).map((e) => ({
        from: e.fromPath,
        fromSymbol: e.fromSymbol,
        to: e.toPath,
        confidence: e.confidence,
      })),
      callees: callees.slice(0, 40).map((e) => ({
        to: e.toPath,
        toSymbol: e.toSymbol,
        specifier: e.specifier,
        confidence: e.confidence,
      })),
      tests: tests.slice(0, 20).map((t) => ({
        path: t.edge.toPath.startsWith(sym.location.path) ? t.edge.fromPath : t.edge.toPath,
        confidence: t.confidence,
        evidence: t.evidence,
      })),
      instructions: instructions.slice(0, 20).map((i) => ({
        id: i.id,
        text: i.text,
        precedence: i.precedence,
        binding: i.binding,
        sourceFile: i.sourceFile,
        startLine: i.startLine,
        endLine: i.endLine,
      })),
      risks,
      sources: [
        {
          path: sym.location.path,
          startLine: sym.location.startLine,
          endLine: sym.location.endLine,
          sourceType: 'symbol',
          symbol: sym.name,
        },
      ],
      modelProvider: 'none',
    });
  });
}

export async function toolExplainContext(args: {
  symbol: string;
  filePath?: string;
  k?: number;
}) {
  return toolExplainSymbol({
    symbol: args.symbol,
    filePath: args.filePath,
  });
}

export async function toolGetRelevantInstructions(args: {
  targetFile: string;
}) {
  if (!args.targetFile?.trim()) {
    return errorResult('malformed_request', 'targetFile is required');
  }
  const permitted = assertWorkspacePermitted();
  if (!permitted.ok) return permitted.response;
  const safe = await safeRelPath(permitted.workspaceRoot, args.targetFile);
  if (!safe.ok) return safe.response;

  logMeta('get_relevant_instructions', permitted.workspaceRoot);
  try {
    const resolver = await createInstructionResolver({
      workspaceRoot: permitted.workspaceRoot,
    });
    const instructions = await resolver.getApplicableInstructions(safe.rel);
    const conflicts = await resolver.findInstructionConflicts(safe.rel);
    const precedence = await resolver.explainInstructionPrecedence(safe.rel);
    return textResult({
      workspaceRoot: permitted.workspaceRoot,
      targetFile: safe.rel,
      instructions: instructions.map((i) => ({
        id: i.id,
        text: i.text,
        precedence: i.precedence,
        binding: i.binding,
        documentType: i.documentType,
        sourceFile: i.sourceFile,
        startLine: i.startLine,
        endLine: i.endLine,
      })),
      conflicts,
      precedence,
      sources: instructions.map((i) => ({
        path: i.sourceFile,
        startLine: i.startLine,
        endLine: i.endLine,
        sourceType: 'instruction',
      })),
    });
  } catch (err) {
    return errorResult(
      'malformed_request',
      `Instruction resolution failed: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

export async function toolGetRelatedFiles(args: {
  query?: string;
  filePath?: string;
  symbol?: string;
  maxDepth?: number;
  relationshipKinds?: string[];
  k?: number;
}) {
  const kinds = (args.relationshipKinds ?? []).filter(isRelationshipKind);
  return withOpenedIndex('get_related_files', true, async ({ opened }) => {
    let seedPath = args.filePath;
    if (seedPath) {
      const safe = await safeRelPath(opened.workspaceRoot, seedPath);
      if (!safe.ok) return safe.response;
      seedPath = safe.rel;
    }

    const graph = createCodeGraphQuery(opened.store, opened.indexer.getCodeGraphService());
    const engine = await createRepositorySearchEngine({ store: opened.store });
    const maxDepth = args.maxDepth ?? 2;
    const related = new Map<
      string,
      {
        path: string;
        relationshipPaths: string[];
        confidence: string;
        sources: Array<{ path: string; kind: string; confidence?: string }>;
        score: number;
      }
    >();

    const add = (
      path: string,
      relationshipPath: string,
      confidence: string,
      source: { path: string; kind: string; confidence?: string },
      score: number
    ) => {
      const key = path.replace(/\\/g, '/');
      const existing = related.get(key);
      if (!existing) {
        related.set(key, {
          path: key,
          relationshipPaths: [relationshipPath],
          confidence,
          sources: [source],
          score,
        });
        return;
      }
      if (!existing.relationshipPaths.includes(relationshipPath)) {
        existing.relationshipPaths.push(relationshipPath);
      }
      existing.sources.push(source);
      if (score > existing.score) existing.score = score;
    };

    if (args.symbol || seedPath) {
      let symbolId: string | undefined;
      if (args.symbol) {
        const matches = graph.findSymbol(args.symbol, {
          pathPrefix: seedPath,
          exact: false,
        });
        if (matches.length > 1 && !seedPath) {
          return errorResult(
            'ambiguous_symbol',
            `Multiple symbols named "${args.symbol}"; pass filePath.`,
            {
              matches: matches.slice(0, 8).map((m) => ({
                id: m.id,
                path: m.location.path,
                startLine: m.location.startLine,
              })),
            }
          );
        }
        symbolId = matches[0]?.id;
        if (matches[0]) seedPath = matches[0].location.path;
      }

      if (symbolId) {
        const nodes = graph.traverseGraph(symbolId, {
          maxDepth,
          direction: 'both',
          kinds: kinds.length > 0 ? kinds : undefined,
        });
        for (const node of nodes) {
          const via = node.via;
          const p =
            via?.toPath && via.toPath !== seedPath
              ? via.toPath
              : via?.fromPath && via.fromPath !== seedPath
                ? via.fromPath
                : undefined;
          if (!p || p === seedPath) continue;
          const kind = via?.kind ?? 'fileDependency';
          if (kinds.length > 0 && !kinds.includes(kind as RelationshipKind)) continue;
          add(
            p,
            `${seedPath} -[${kind}/${node.depth}]-> ${p}`,
            via?.confidence ?? 'medium',
            { path: p, kind, confidence: via?.confidence },
            1 / (1 + node.depth)
          );
        }
      }

      if (seedPath) {
        const kindSet = kinds.length > 0 ? new Set(kinds) : undefined;
        const edges = opened.store.allEdges();
        const queue: Array<{ path: string; depth: number }> = [{ path: seedPath, depth: 0 }];
        const seenPaths = new Set<string>([seedPath]);
        while (queue.length > 0) {
          const cur = queue.shift()!;
          if (cur.depth >= maxDepth) continue;
          for (const e of edges) {
            if (kindSet && !kindSet.has(e.kind as RelationshipKind)) continue;
            let next: string | undefined;
            if (e.fromPath === cur.path) next = e.toPath;
            else if (e.toPath === cur.path) next = e.fromPath;
            if (!next || seenPaths.has(next)) continue;
            seenPaths.add(next);
            queue.push({ path: next, depth: cur.depth + 1 });
            add(
              next,
              `${seedPath} -[${e.kind}/${cur.depth + 1}]-> ${next}`,
              e.confidence ?? 'medium',
              { path: next, kind: e.kind, confidence: e.confidence },
              1 / (1 + cur.depth + 1)
            );
          }
        }
      }
    }

    const query = args.query?.trim() || args.symbol || seedPath || '';
    if (query) {
      const hits = await engine.findRelevantFiles(query, {
        k: args.k ?? 16,
        pathHint: seedPath,
        budgets: { maxDependencyDepth: maxDepth },
      });
      for (const hit of hits) {
        add(
          hit.path,
          `hybrid:${hit.reason}`,
          hit.confidence,
          {
            path: hit.reference.path,
            kind: hit.resultType,
            confidence: hit.confidence,
          },
          hit.score
        );
      }
    }

    if (related.size === 0 && !query && !seedPath && !args.symbol) {
      return errorResult(
        'malformed_request',
        'Provide query, filePath, and/or symbol for get_related_files'
      );
    }

    const paths = await filterIgnoredPaths(opened.workspaceRoot, [...related.keys()]);
    const files = paths
      .map((p) => related.get(p)!)
      .filter(Boolean)
      .sort((a, b) => b.score - a.score)
      .slice(0, args.k ?? 24)
      .map(({ score: _score, ...rest }) => rest);

    logMeta('get_related_files', opened.workspaceRoot, { files: files.length });
    return textResult({
      workspaceRoot: opened.workspaceRoot,
      seedPath: seedPath ?? null,
      maxDepth,
      relationshipKinds: kinds.length > 0 ? kinds : RELATIONSHIP_KINDS,
      files,
    });
  });
}

export async function toolGenerateTaskContext(args: {
  task: string;
  selectedFiles?: string[];
  depth?: TaskContextDepth | string;
  persist?: boolean;
}) {
  if (!args.task?.trim()) {
    return errorResult('malformed_request', 'task is required');
  }
  return withOpenedIndex('generate_task_context', true, async ({ opened }) => {
    const selected: string[] = [];
    for (const f of args.selectedFiles ?? []) {
      const safe = await safeRelPath(opened.workspaceRoot, f);
      if (!safe.ok) return safe.response;
      selected.push(safe.rel);
    }
    const depth = parseTaskContextDepth(
      typeof args.depth === 'string' ? args.depth : undefined
    );
    const pack = await assembleTaskContextPack({
      workspaceRoot: opened.workspaceRoot,
      store: opened.store,
      task: args.task,
      depth,
      selectedFiles: selected.length > 0 ? selected : undefined,
      graphService: opened.indexer.getCodeGraphService(),
    });

    let incomplete = pack.meta.incomplete === true;
    let markdown = pack.markdown;
    const maxChars = 120_000;
    if (markdown.length > maxChars) {
      markdown = `${markdown.slice(0, maxChars)}\n\n… truncated (context budget)\n`;
      incomplete = true;
    }

    let savedPath: string | undefined;
    if (args.persist !== false) {
      const written = await writeTaskContextPack(opened.workspaceRoot, {
        ...pack,
        markdown,
        meta: { ...pack.meta, incomplete },
      });
      savedPath = written.relativePath;
    }

    logMeta('generate_task_context', opened.workspaceRoot, {
      incomplete: incomplete ? 1 : 0,
    });
    return textResult({
      workspaceRoot: opened.workspaceRoot,
      savedPath,
      incomplete,
      meta: {
        ...pack.meta,
        incomplete,
        modelProvider: 'none',
        dataLeftMachine: false,
      },
      markdown,
      storeDir: opened.store.storeDirectory,
    });
  });
}

export async function toolGetArchitectureSummary(args: {
  directory?: string;
  k?: number;
}) {
  return withOpenedIndex('get_architecture_summary', true, async ({ opened }) => {
    let directory = args.directory;
    if (directory) {
      const safe = await safeRelPath(opened.workspaceRoot, directory);
      if (!safe.ok) return safe.response;
      directory = safe.rel;
    }

    const uncertainty: string[] = [];
    const sources: Array<{
      path: string;
      startLine: number;
      endLine: number;
      sourceType: string;
      excerpt?: string;
    }> = [];

    let architectureMd: string | null = null;
    const archPath = join(MEMORY_DIR, 'architecture.md');
    try {
      architectureMd = await readFile(join(opened.workspaceRoot, archPath), 'utf8');
      sources.push({
        path: archPath,
        startLine: 1,
        endLine: Math.min(40, architectureMd.split('\n').length),
        sourceType: 'memory',
        excerpt: architectureMd.slice(0, 500),
      });
    } catch {
      uncertainty.push(`No shareable ${archPath} present`);
    }

    const engine = await createRepositorySearchEngine({ store: opened.store });
    const queryParts = [
      'architecture overview entry points',
      directory ? `directory ${directory}` : '',
      'ADR design decisions',
    ].filter(Boolean);
    const result = await engine.searchRepositoryContext(queryParts.join(' '), {
      k: args.k ?? 16,
      pathHint: directory,
      preferMemory: true,
      budgets: { maxFiles: 12, maxSymbols: 16, maxDependencyDepth: 2 },
    });

    const adrHits = result.results.filter(
      (h) =>
        /adr|architecture/i.test(h.path) ||
        h.resultType === 'architecture' ||
        h.resultType === 'instruction'
    );
    const entryPoints = result.results.filter(
      (h) =>
        h.resultType === 'symbol' &&
        /main|index|app|bootstrap|createServer|export/i.test(h.symbolName ?? h.path)
    );

    for (const hit of result.results.slice(0, 20)) {
      sources.push({
        path: hit.reference.path,
        startLine: hit.reference.startLine,
        endLine: hit.reference.endLine,
        sourceType: hit.reference.sourceType,
        excerpt: hit.reference.excerpt?.slice(0, 240),
      });
    }

    if (result.incomplete) {
      uncertainty.push('Hybrid search marked incomplete under current budgets');
    }
    if (adrHits.length === 0) {
      uncertainty.push('No ADR/architecture instruction hits found in the index');
    }

    const summaryParts: string[] = [];
    if (architectureMd) {
      summaryParts.push(architectureMd.trim().slice(0, 4000));
    }
    if (adrHits.length > 0) {
      summaryParts.push(
        'ADR / architecture evidence:\n' +
          adrHits
            .slice(0, 8)
            .map(
              (h) =>
                `- ${h.path}:${h.reference.startLine} (${h.confidence}) — ${h.reason}`
            )
            .join('\n')
      );
    }
    if (entryPoints.length > 0) {
      summaryParts.push(
        'Likely entry-point symbols:\n' +
          entryPoints
            .slice(0, 8)
            .map(
              (h) =>
                `- ${h.symbolName ?? '(file)'} @ ${h.path}:${h.reference.startLine}`
            )
            .join('\n')
      );
    }
    if (summaryParts.length === 0) {
      uncertainty.push('Insufficient indexed evidence to compose an architecture summary');
    }

    logMeta('get_architecture_summary', opened.workspaceRoot, {
      sources: sources.length,
    });
    return textResult({
      workspaceRoot: opened.workspaceRoot,
      directory: directory ?? null,
      summary: summaryParts.join('\n\n') || null,
      architectureMemoryPresent: Boolean(architectureMd),
      adrHits: adrHits.slice(0, 12).map(serialiseHit),
      entryPoints: entryPoints.slice(0, 12).map(serialiseHit),
      uncertainty,
      sources,
      modelProvider: 'none',
      incomplete: result.incomplete || summaryParts.length === 0,
    });
  });
}

export async function toolScanProdRisks(args: { files?: string[] }) {
  const permitted = assertWorkspacePermitted();
  if (!permitted.ok) return permitted.response;
  const workspaceRoot = permitted.workspaceRoot;
  try {
    const files: string[] = [];
    for (const f of args.files ?? []) {
      const safe = await safeRelPath(workspaceRoot, f);
      if (!safe.ok) return safe.response;
      files.push(safe.rel);
    }
    const profile = await collectProjectProfile(workspaceRoot);
    const registryPath = await locateRulesRegistry(workspaceRoot);
    const scan = await scanProdRisks({
      workspaceRoot,
      profile,
      rulesRegistryPath: registryPath,
      files: files.length > 0 ? files : undefined,
      progress: {
        onFile: (_rel, index, total) => {
          if (index % 50 === 0) {
            console.error(`[mergecore-mcp] prod-risk ${index + 1}/${total}`);
          }
        },
      },
    });
    return textResult({
      workspaceRoot,
      registryPath: registryPath ?? null,
      scannedFiles: scan.scannedFiles,
      skippedFiles: scan.skippedFiles,
      durationMs: scan.durationMs,
      ruleSetFingerprint: scan.ruleSetFingerprint,
      activeRuleIds: scan.activeRuleIds,
      summary: scan.summary,
      findings: scan.findings.slice(0, 100),
      truncated: scan.findings.length > 100,
    });
  } catch (err) {
    return errorResult(
      'malformed_request',
      `Prod-risk scan failed for ${workspaceRoot}: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

export async function toolListPacks() {
  const permitted = assertWorkspacePermitted();
  if (!permitted.ok) return permitted.response;
  const workspaceRoot = permitted.workspaceRoot;
  try {
    const loaded = await loadPackRegistry(workspaceRoot);
    if (!loaded) {
      return textResult({
        workspaceRoot,
        packs: [],
        note: 'No rules/registry.json found. Built-in prod-risk rules still apply.',
      });
    }
    const packs = [];
    for (const pack of loaded.registry.packs) {
      const manifest = await readPackManifest(loaded.registryPath, pack);
      packs.push({
        id: pack.id,
        path: pack.path,
        version: pack.version,
        tags: pack.tags ?? [],
        suggested_when: pack.suggested_when ?? [],
        title: typeof manifest?.title === 'string' ? manifest.title : undefined,
      });
    }
    return textResult({
      workspaceRoot,
      registryPath: loaded.registryPath,
      registry_version: loaded.registry.registry_version,
      packs,
    });
  } catch (err) {
    return errorResult(
      'malformed_request',
      `List packs failed for ${workspaceRoot}: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

export async function toolReadPackGuidance(args: { packId: string }) {
  if (!args.packId?.trim()) {
    return errorResult('malformed_request', 'packId is required');
  }
  const permitted = assertWorkspacePermitted();
  if (!permitted.ok) return permitted.response;
  const workspaceRoot = permitted.workspaceRoot;
  try {
    const loaded = await loadPackRegistry(workspaceRoot);
    if (!loaded) {
      return errorResult('malformed_request', 'No rules/registry.json found in the workspace.');
    }
    const pack = loaded.registry.packs.find((p) => p.id === args.packId);
    if (!pack) {
      const ids = loaded.registry.packs.map((p) => p.id).join(', ');
      return errorResult(
        'malformed_request',
        `Unknown packId "${args.packId}". Available: ${ids || '(none)'}`
      );
    }
    const agents = await readPackAgents(loaded.registryPath, pack);
    const manifest = await readPackManifest(loaded.registryPath, pack);
    return textResult({
      workspaceRoot,
      packId: pack.id,
      version: pack.version,
      path: pack.path,
      manifest,
      agentsMd: agents,
    });
  } catch (err) {
    return errorResult(
      'malformed_request',
      `Read pack guidance failed: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

export async function toolWorkspaceProfile() {
  const permitted = assertWorkspacePermitted();
  if (!permitted.ok) return permitted.response;
  const workspaceRoot = permitted.workspaceRoot;
  try {
    const profile = await collectProjectProfile(workspaceRoot);
    return textResult({
      workspaceRoot,
      collectedAt: profile.collectedAt,
      fingerprint: profile.fingerprint,
      stacks: profile.stacks,
      conventions: profile.conventions,
      signals: profile.signals.slice(0, 40),
    });
  } catch (err) {
    return errorResult(
      'malformed_request',
      `Profile failed for ${workspaceRoot}: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

export { resolveWorkspaceRoot };
