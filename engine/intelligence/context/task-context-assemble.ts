import * as fs from 'fs/promises';
import * as path from 'path';
import { createCodeGraphQuery } from '../graph/query';
import { formatRelationshipPathLabel } from '../graph/paths/rank';
import { traverseRelationshipPaths } from '../graph/paths/traverse';
import { createInstructionResolver } from '../instructions/resolver';
import type { RagStore } from '../rag/store';
import { createRepositorySearchEngine } from '../retrieve/search';
import type { RetrievalHit } from '../retrieve/types';
import { fingerprintFile } from '../memory/provenance';
import { budgetsForDepth } from './task-context-budgets';
import { buildTaskContextPack } from './task-context-markdown';
import { detectTaskRiskIndicators } from './task-risks';
import type {
  TaskContextInput,
  TaskContextPack,
  TaskContextSection,
  TaskContextSourceRef,
} from './task-context-types';

function isRecognisedInstruction(pathRel: string, documentType?: string): boolean {
  const p = pathRel.replace(/\\/g, '/').toLowerCase();
  const base = p.split('/').pop() ?? p;
  if (
    base === 'agents.md' ||
    base === 'claude.md' ||
    base.endsWith('.mdc') ||
    p.includes('/.cursor/rules/')
  ) {
    return true;
  }
  return documentType === 'instruction' || documentType === 'convention';
}

function isAdrOrArchitecture(hit: RetrievalHit): boolean {
  if (hit.resultType === 'architecture') return true;
  const p = hit.path.replace(/\\/g, '/').toLowerCase();
  return (
    p.includes('/adr/') ||
    p.includes('/adrs/') ||
    /architecture|decision/.test(p)
  );
}

function sourceKey(s: TaskContextSourceRef): string {
  return `${s.path}:${s.startLine}-${s.endLine}`;
}

function addSource(
  list: TaskContextSourceRef[],
  seen: Set<string>,
  s: TaskContextSourceRef
): void {
  const k = sourceKey(s);
  if (seen.has(k)) return;
  seen.add(k);
  list.push(s);
}

function excerptFromStore(
  store: RagStore,
  filePath: string,
  startLine: number,
  endLine: number,
  maxLines = 6
): string {
  const chunks = store
    .allChunks()
    .filter((c) => c.path.replace(/\\/g, '/') === filePath.replace(/\\/g, '/'));
  const overlapping = chunks.filter(
    (c) => c.endLine >= startLine && c.startLine <= endLine
  );
  if (overlapping.length === 0) {
    return '';
  }
  const text = overlapping
    .sort((a, b) => a.startLine - b.startLine)[0]!
    .text.split(/\r?\n/)
    .slice(0, maxLines)
    .join('\n')
    .trim();
  return text.slice(0, 400);
}

function confidenceFromHits(hits: readonly RetrievalHit[]): number {
  if (hits.length === 0) return 0.15;
  const highs = hits.filter((h) => h.confidence === 'high').length;
  const meds = hits.filter((h) => h.confidence === 'medium').length;
  const score =
    0.25 +
    Math.min(0.55, hits.length / 20) +
    highs * 0.03 +
    meds * 0.015;
  return Math.max(0.1, Math.min(0.95, score));
}

/**
 * Assemble a deterministic, budgeted, source-backed task context pack.
 */
export async function assembleTaskContextPack(
  input: TaskContextInput
): Promise<TaskContextPack> {
  const depth = input.depth ?? 'standard';
  const { budgets, k: defaultK } = budgetsForDepth(depth);
  const k = input.k ?? defaultK;
  const store = input.store;
  const task = input.task.trim();
  const selectedFiles = [...(input.selectedFiles ?? [])].map((p) =>
    p.replace(/\\/g, '/')
  );
  const selectedSymbols = [...(input.selectedSymbols ?? [])];

  const sources: TaskContextSourceRef[] = [];
  const seen = new Set<string>();
  const pushSrc = (
    pathRel: string,
    startLine: number,
    endLine: number,
    label?: string
  ): void => {
    addSource(sources, seen, {
      path: pathRel.replace(/\\/g, '/'),
      startLine,
      endLine,
      label,
    });
  };

  const incompleteNotes: string[] = [];
  if (store.chunkCount === 0) {
    incompleteNotes.push(
      'Local MergeCore index is empty. Run Index Repository for richer evidence.'
    );
  }

  const engine = await createRepositorySearchEngine({
    store,
    useInstructions: true,
  });
  const search = await engine.searchRepositoryContext(task, {
    k,
    pathHint: input.pathHint ?? selectedFiles[0],
    selectedFiles: selectedFiles.length > 0 ? selectedFiles : undefined,
    budgets,
  });

  // Boost pinned symbols via getContextForSymbol
  let hits: RetrievalHit[] = [...search.results];
  for (const symId of selectedSymbols.slice(0, 6)) {
    try {
      const ctx = await engine.getContextForSymbol(symId);
      hits = [...ctx.results, ...hits];
    } catch {
      incompleteNotes.push(`Could not resolve pinned symbol ${symId}.`);
    }
  }

  // Deduplicate hits by id/path+lines
  const hitSeen = new Set<string>();
  hits = hits.filter((h) => {
    const key = `${h.path}:${h.reference.startLine}:${h.reference.endLine}:${h.symbolId ?? ''}`;
    if (hitSeen.has(key)) return false;
    hitSeen.add(key);
    return true;
  });

  // Cap by budgets
  const fileHits: RetrievalHit[] = [];
  const symbolHits: RetrievalHit[] = [];
  const otherHits: RetrievalHit[] = [];
  const filesUsed = new Set<string>();
  for (const h of hits) {
    if (h.resultType === 'symbol' && symbolHits.length < budgets.maxSymbols) {
      symbolHits.push(h);
    } else if (
      (h.resultType === 'file' || h.resultType === 'chunk') &&
      fileHits.length < budgets.maxFiles
    ) {
      if (!filesUsed.has(h.path) || h.resultType === 'chunk') {
        fileHits.push(h);
        filesUsed.add(h.path);
      }
    } else if (
      h.resultType === 'test' ||
      h.resultType === 'instruction' ||
      h.resultType === 'architecture' ||
      h.resultType === 'dependency'
    ) {
      otherHits.push(h);
    }
  }
  const capped = [...symbolHits, ...fileHits, ...otherHits].slice(0, k + 20);

  for (const h of capped) {
    pushSrc(h.path, h.reference.startLine, h.reference.endLine, h.resultType);
  }

  const graph = createCodeGraphQuery(store, input.graphService);
  const depBullets: string[] = [];
  const callerBullets: string[] = [];
  const testBullets: string[] = [];
  const patternBullets: string[] = [];
  let totalCallers = 0;
  let totalTests = 0;

  // Prefer explainable multi-hop relationship paths over flat edge lists
  const pathSeeds: Array<{ symbolId?: string; path?: string }> = [];
  for (const h of symbolHits.slice(0, 6)) {
    if (h.symbolId) pathSeeds.push({ symbolId: h.symbolId });
  }
  for (const f of selectedFiles.slice(0, 4)) {
    pathSeeds.push({ path: f });
  }
  if (pathSeeds.length === 0 && capped[0]) {
    pathSeeds.push({ path: capped[0].path });
  }
  const seenPathLabels = new Set<string>();
  for (const seed of pathSeeds.slice(0, 4)) {
    const relPaths = traverseRelationshipPaths({
      store,
      start: seed,
      budget: {
        maxDepth: Math.min(3, budgets.maxDependencyDepth || 3),
        maxNodes: 40,
        maxPaths: 6,
        maxFanOutPerNode: 8,
        direction: 'both',
        weightProfile: 'default',
      },
    });
    for (const rp of relPaths) {
      if (rp.steps.length < 2) continue;
      const label = formatRelationshipPathLabel(rp);
      if (seenPathLabels.has(label)) continue;
      seenPathLabels.add(label);
      depBullets.push(
        `${label} _(score ${rp.score.toFixed(0)}, ${rp.deterministic ? 'deterministic' : 'heuristic'})_`
      );
      for (const step of rp.steps) {
        const ev = step.evidence[0];
        pushSrc(
          step.node.path,
          ev?.startLine ?? step.edge?.startLine ?? 1,
          ev?.endLine ?? step.edge?.endLine ?? ev?.startLine ?? 1,
          step.edge?.kind ?? 'path'
        );
      }
    }
  }

  for (const h of symbolHits.slice(0, 12)) {
    if (!h.symbolId) continue;
    const def = graph.getSymbolDefinition(h.symbolId);
    if (!def) continue;

    if (depBullets.length < 4) {
      const deps = graph.getDependencies(h.symbolId, [
        'import',
        'call',
        'typeUsage',
        'extends',
        'implements',
        'fileDependency',
      ]);
      for (const e of deps.slice(0, budgets.maxDependencyDepth * 4)) {
        depBullets.push(
          `\`${def.name}\` → \`${e.specifier || e.toSymbol || e.toPath}\` in \`${e.toPath}\` (${e.kind})`
        );
        pushSrc(e.toPath, e.startLine ?? 1, e.endLine ?? e.startLine ?? 1, `dep:${e.kind}`);
      }
    }

    const callers = graph.getCallers(h.symbolId);
    totalCallers += callers.length;
    for (const e of callers.slice(0, 8)) {
      callerBullets.push(
        `caller of \`${def.name}\` from \`${e.fromPath}\`${e.startLine ? `:${e.startLine}` : ''}`
      );
      pushSrc(e.fromPath, e.startLine ?? 1, e.endLine ?? e.startLine ?? 1, 'caller');
    }

    const tests = graph.getRelatedTests(h.symbolId);
    totalTests += tests.length;
    for (const t of tests.slice(0, 6)) {
      testBullets.push(
        `\`${t.edge.fromPath}\` related to \`${def.name}\` (${t.confidence ?? 'n/a'}) — ${(t.evidence ?? []).slice(0, 2).join('; ') || 'indexed edge'}`
      );
      pushSrc(
        t.edge.fromPath,
        t.edge.startLine ?? 1,
        t.edge.endLine ?? t.edge.startLine ?? 1,
        'test'
      );
    }

    if (def.signatureText || def.jsdocSummary) {
      patternBullets.push(
        `\`${def.name}\` in \`${def.location.path}\`: ${def.jsdocSummary ?? def.signatureText?.slice(0, 120) ?? def.kind}`
      );
    }
  }

  // File-level test coverage edges
  for (const h of capped) {
    for (const e of store.allEdges()) {
      if (
        e.kind === 'likelyTestCoverage' &&
        e.toPath.replace(/\\/g, '/') === h.path.replace(/\\/g, '/') &&
        !testBullets.some((b) => b.includes(e.fromPath))
      ) {
        totalTests++;
        testBullets.push(
          `\`${e.fromPath}\` likely covers \`${e.toPath}\` — ${(e.evidence ?? []).slice(0, 2).join('; ')}`
        );
        pushSrc(e.fromPath, e.startLine ?? 1, e.endLine ?? e.startLine ?? 1, 'test');
      }
    }
  }

  // Instructions
  const instrBullets: string[] = [];
  try {
    const resolver = await createInstructionResolver({
      workspaceRoot: input.workspaceRoot,
    });
    const topPaths = [
      ...new Set([
        ...selectedFiles,
        ...capped.map((h) => h.path),
      ]),
    ].slice(0, 8);
    const seenInstr = new Set<string>();
    for (const target of topPaths.length > 0 ? topPaths : ['src/']) {
      const docs = await resolver.getApplicableDocuments(target);
      for (const d of docs) {
        if (!isRecognisedInstruction(d.path, d.documentType)) continue;
        if (seenInstr.has(d.path)) continue;
        seenInstr.add(d.path);
        instrBullets.push(
          `\`${d.path}\` · ${d.title} · type \`${d.documentType}\` · binding \`${d.binding}\``
        );
        pushSrc(d.path, d.startLine, Math.min(d.endLine, d.startLine + 40), 'instruction');
      }
    }
  } catch {
    incompleteNotes.push('Instruction discovery failed.');
  }

  // ADRs / architecture from hits
  for (const h of capped.filter(isAdrOrArchitecture).slice(0, 6)) {
    if (!instrBullets.some((b) => b.includes(h.path))) {
      instrBullets.push(
        `\`${h.path}\` · architecture/decision evidence — ${h.reason}`
      );
    }
  }

  // Components
  const componentBullets: string[] = [];
  for (const h of capped.slice(0, budgets.maxFiles + budgets.maxSymbols)) {
    const excerpt = excerptFromStore(
      store,
      h.path,
      h.reference.startLine,
      h.reference.endLine,
      4
    );
    const sym = h.symbolName ? ` · \`${h.symbolName}\`` : '';
    componentBullets.push(
      `\`${h.path}\`${h.reference.startLine ? `:${h.reference.startLine}` : ''}${sym} (${h.resultType}, score ${h.score.toFixed(1)}, ${h.analysis}) — ${h.reason}`
    );
    if (excerpt) {
      componentBullets.push('```');
      componentBullets.push(excerpt);
      componentBullets.push('```');
    }
  }

  // Patterns from similar high-score non-primary files
  if (patternBullets.length === 0) {
    for (const h of capped.filter((x) => x.analysis === 'deterministic').slice(0, 5)) {
      patternBullets.push(
        `Similar indexed path \`${h.path}\` — ${h.reason}`
      );
    }
  }

  // Risks
  const blob = [
    task,
    ...capped.map((h) => `${h.path} ${h.symbolName ?? ''} ${h.reason}`),
    ...depBullets,
  ].join('\n');
  const risks = detectTaskRiskIndicators({
    blob,
    callerCount: totalCallers,
    relatedTestCount: totalTests,
  });
  const riskBullets =
    risks.length === 0
      ? [
          '**Evidence:** No conservative risk indicators matched in retrieved evidence.',
          '**General consideration:** Review auth, validation, and rollback paths when changing money or permission flows _(not evidence-backed for this task)_',
        ]
      : [
          ...risks.map(
            (r) =>
              `**${r.label}** — ${r.evidence} _(indicator, not a confirmed vulnerability)_`
          ),
          '**General consideration:** Prefer smallest change that preserves existing public contracts _(engineering practice, not repository evidence)_',
        ];

  // Inspection order: pinned → definitions → deps → tests → docs
  const inspection: string[] = [];
  for (const f of selectedFiles) {
    inspection.push(`Pinned file \`${f}\``);
  }
  for (const h of symbolHits.slice(0, 8)) {
    inspection.push(
      `Symbol \`${h.symbolName ?? h.symbolId}\` in \`${h.path}:${h.reference.startLine}\``
    );
  }
  for (const h of fileHits.slice(0, 8)) {
    if (!inspection.some((i) => i.includes(h.path))) {
      inspection.push(`File \`${h.path}\` — ${h.reason}`);
    }
  }
  for (const t of testBullets.slice(0, 4)) {
    inspection.push(`Test ${t.split('—')[0]!.trim()}`);
  }
  if (inspection.length === 0) {
    inspection.push('No strong inspection targets — broaden the task or index the repository.');
  }

  // Understanding
  const paths = [...new Set(capped.map((h) => h.path))].slice(0, 8);
  const understanding: string[] = [];
  if (paths.length === 0) {
    understanding.push(
      '**Uncertain:** Insufficient indexed evidence to describe a relevant subsystem.'
    );
  } else {
    understanding.push(
      `**Evidence:** Task appears to touch ${paths.length} indexed path(s), e.g. ${paths
        .slice(0, 5)
        .map((p) => `\`${p}\``)
        .join(', ')}.`
    );
    if (symbolHits[0]) {
      understanding.push(
        `**Evidence:** Strongest symbol signal \`${symbolHits[0].symbolName ?? symbolHits[0].symbolId}\` in \`${symbolHits[0].path}\`.`
      );
    }
  }

  // Uncertainty
  const uncertainty: string[] = [...incompleteNotes];
  if (capped.length < 3) {
    uncertainty.push(
      'Few retrieval hits — repository evidence may be incomplete for this task wording.'
    );
  }
  if (search.incomplete) {
    uncertainty.push('Retrieval marked incomplete (budget or sparse index).');
  }
  if (totalTests === 0) {
    uncertainty.push('No related tests found for top symbols/files.');
  }
  const dynamic = capped.filter((h) => /dynamic|heuristic|unresolved/i.test(h.reason));
  if (dynamic.length > 0) {
    uncertainty.push(
      `Heuristic/unresolved graph signals present (${dynamic.length}) — treat call edges cautiously.`
    );
  }
  if (uncertainty.length === 0) {
    uncertainty.push('No major uncertainty flags beyond normal retrieval limits.');
  }

  // Attach fingerprints (best-effort)
  const withFp: TaskContextSourceRef[] = [];
  for (const s of sources.slice(0, 60)) {
    const fingerprint =
      s.fingerprint ?? (await fingerprintFile(input.workspaceRoot, s.path));
    withFp.push({ ...s, fingerprint });
  }

  // Char budget trim on component excerpts already limited; trim bullets if needed
  let sections: TaskContextSection[] = [
    { title: 'Task', bullets: [task] },
    { title: 'Repository understanding', bullets: understanding },
    {
      title: 'Applicable instructions',
      bullets:
        instrBullets.length > 0
          ? instrBullets
          : ['**Evidence:** No recognised AGENTS/CLAUDE/Cursor convention docs in scope.'],
    },
    {
      title: 'Relevant components',
      bullets:
        componentBullets.length > 0
          ? componentBullets
          : ['**Uncertain:** No relevant components retrieved.'],
    },
    {
      title: 'Related types and dependencies',
      bullets:
        depBullets.length > 0 || callerBullets.length > 0
          ? [...depBullets.slice(0, 20), ...callerBullets.slice(0, 12)]
          : ['**Evidence:** No dependency/caller edges indexed for top symbols.'],
    },
    {
      title: 'Existing implementation patterns',
      bullets:
        patternBullets.length > 0
          ? patternBullets
          : ['**Uncertain:** No clear similar patterns extracted from the index.'],
    },
    {
      title: 'Tests likely affected',
      bullets:
        testBullets.length > 0
          ? testBullets
          : ['**Evidence:** No related tests found in the local index.'],
    },
    { title: 'Risks and edge cases', bullets: riskBullets },
    { title: 'Suggested inspection order', bullets: inspection },
    { title: 'Uncertainty', bullets: uncertainty },
    {
      title: 'Sources',
      bullets: withFp.slice(0, 40).map((s) => {
        const lines =
          s.startLine === s.endLine
            ? `L${s.startLine}`
            : `L${s.startLine}–${s.endLine}`;
        return `[\`${s.path}:${lines}\`](${s.path}#L${s.startLine}) — ${s.label ?? 'evidence'}`;
      }),
    },
  ];

  // Soft enforce maxChars by truncating long sections
  let draft = buildTaskContextPack(
    {
      task,
      generatedAt: new Date().toISOString(),
      indexRevision: `${store.chunkCount}:${store.updatedAt}`,
      depth,
      budgets,
      k,
      selectedFiles,
      selectedSymbols,
      confidence: confidenceFromHits(capped),
      sources: withFp,
      modelProvider: 'none',
      dataLeftMachine: false,
      incomplete:
        store.chunkCount === 0 ||
        capped.length < 3 ||
        search.incomplete ||
        incompleteNotes.length > 0,
    },
    sections
  );

  if (draft.markdown.length > budgets.maxChars) {
    sections = sections.map((sec) => {
      if (sec.title === 'Relevant components' || sec.title === 'Related types and dependencies') {
        return { ...sec, bullets: sec.bullets.slice(0, Math.max(4, Math.floor(sec.bullets.length / 2))) };
      }
      return sec;
    });
    draft = buildTaskContextPack(draft.meta, sections);
  }

  return draft;
}

/** Read a short file snippet from disk when store chunks miss (optional). */
export async function readDiskExcerpt(
  workspaceRoot: string,
  relPath: string,
  startLine: number,
  endLine: number
): Promise<string> {
  try {
    const text = await fs.readFile(path.join(workspaceRoot, relPath), 'utf8');
    const lines = text.split(/\r?\n/);
    return lines
      .slice(Math.max(0, startLine - 1), Math.min(lines.length, endLine))
      .join('\n')
      .slice(0, 400);
  } catch {
    return '';
  }
}
