import {
  assignEvidenceIds,
  createCodeGraphQuery,
  createInstructionResolver,
  createRepositorySearchEngine,
  createSourceReference,
  GENERAL_CONSIDERATION_LABEL,
  type RagStore,
  type SourceReference,
  type SymbolRecord,
  type TsJsCodeGraphService,
} from '@mergecore/intelligence';
import { detectRiskIndicators } from '../hover/hover-risks';
import type { ExplainScope } from './explain-scope';
import {
  isRecognisedInstructionDoc,
  looksLikePromptInjection,
  sanitiseEvidenceText,
} from './prompt-safety';
import type { EvidenceRef } from './citation-validate';

export interface ExplanationSource {
  readonly path: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly label: string;
  readonly claim?: string;
  readonly evidenceId?: string;
}

export interface ExplanationSection {
  readonly title: string;
  readonly bullets: readonly string[];
}

export interface SelectedCodeExplanation {
  readonly title: string;
  readonly sections: readonly ExplanationSection[];
  readonly sources: readonly ExplanationSource[];
  readonly evidenceRefs: readonly EvidenceRef[];
  readonly attributedSources: readonly SourceReference[];
  readonly markdown: string;
  readonly usedModel: boolean;
  readonly modelTransmissionVisible: boolean;
  readonly injectionFlagged: boolean;
  /** Whether language intelligence for this explanation is compiler-backed or heuristic. */
  readonly analysis: 'deterministic' | 'heuristic';
}

function sourceKey(s: ExplanationSource): string {
  return `${s.path}:${s.startLine}-${s.endLine}:${s.label}`;
}

function addSource(
  list: ExplanationSource[],
  seen: Set<string>,
  s: ExplanationSource
): void {
  const k = sourceKey(s);
  if (seen.has(k)) return;
  seen.add(k);
  list.push(s);
}

function snippetLines(text: string, maxLines = 4): string {
  return text
    .split(/\r?\n/)
    .slice(0, maxLines)
    .map((l) => l.trimEnd())
    .join('\n');
}

/**
 * Build a deterministic, source-backed explanation (no LLM).
 */
export async function assembleSelectedCodeExplanation(input: {
  readonly scope: ExplainScope;
  readonly store: RagStore;
  readonly graphService?: TsJsCodeGraphService;
}): Promise<SelectedCodeExplanation> {
  const { scope, store } = input;
  const graph = createCodeGraphQuery(store, input.graphService);
  const sources: ExplanationSource[] = [];
  const seen = new Set<string>();
  const attributed: SourceReference[] = [];
  const workspaceId = store.workspaceId ?? 'unknown';
  const analysis: 'deterministic' | 'heuristic' =
    scope.languageId === 'php' || scope.languageId === 'blade'
      ? 'heuristic'
      : 'deterministic';
  const extraction =
    analysis === 'deterministic' ? ('deterministic' as const) : ('heuristic' as const);

  const pushSrc = (
    path: string,
    startLine: number,
    endLine: number,
    label: string,
    claim?: string,
    opts?: { symbolId?: string; symbol?: string; sourceType?: SourceReference['sourceType'] }
  ): void => {
    addSource(sources, seen, { path, startLine, endLine, label, claim });
    const file = store.getFile(path);
    attributed.push(
      createSourceReference({
        workspaceId,
        path,
        startLine,
        endLine,
        sourceType: opts?.sourceType ?? 'source',
        sourceFingerprint: file?.hash ?? '',
        symbolId: opts?.symbolId,
        symbol: opts?.symbol,
        extraction,
      })
    );
  };

  pushSrc(
    scope.relPath,
    scope.range.startLine,
    scope.range.endLine,
    'selection',
    'Selected code range'
  );

  const sanitised = sanitiseEvidenceText(scope.selectedText);
  const injectionFlagged = sanitised.flaggedInjection;
  const codeSample = sanitised.text;

  const sym: SymbolRecord | undefined = scope.symbol;
  if (sym) {
    pushSrc(
      sym.location.path,
      sym.location.startLine,
      sym.location.endLine,
      `symbol:${sym.name}`,
      'Symbol definition',
      { symbolId: sym.id, symbol: sym.name, sourceType: 'symbol' }
    );
  }

  // Purpose
  const purposeBullets: string[] = [];
  if (sym?.jsdocSummary) {
    purposeBullets.push(`**Evidence (JSDoc):** ${sym.jsdocSummary}`);
  }
  if (sym?.signatureText) {
    purposeBullets.push(`**Evidence (signature):** \`${sym.signatureText.slice(0, 160)}\``);
  }
  if (sym) {
    purposeBullets.push(
      `**Evidence:** \`${sym.kind}\` \`${sym.name}\`${sym.exported ? ' (exported)' : ''} in \`${sym.location.path}\``
    );
  } else {
    purposeBullets.push(
      `**${GENERAL_CONSIDERATION_LABEL}:** Selected fragment in \`${scope.relPath}\` (lines ${scope.range.startLine}–${scope.range.endLine}).`
    );
  }
  const preview = snippetLines(codeSample, 3);
  if (preview.trim()) {
    purposeBullets.push('**Evidence (snippet):**');
    purposeBullets.push('```');
    purposeBullets.push(preview);
    purposeBullets.push('```');
  }
  if (injectionFlagged) {
    purposeBullets.push(
      '_Note: injection-like phrases in comments/evidence were omitted and treated as data only._'
    );
  }

  // Architectural role
  const roleBullets: string[] = [];
  roleBullets.push(
    `**Evidence:** Module path \`${scope.relPath}\`${sym?.containerName ? ` · container \`${sym.containerName}\`` : ''}.`
  );
  const fileImports = store.edgesFrom(scope.relPath).filter(
    (e) => e.kind === 'import' || e.kind === 'fileDependency' || e.kind === 'require'
  );
  if (fileImports.length > 0) {
    roleBullets.push(
      `**Evidence:** File imports ${fileImports.length} module(s), e.g. ${fileImports
        .slice(0, 4)
        .map((e) => `\`${e.specifier || e.toPath}\``)
        .join(', ')}.`
    );
    for (const e of fileImports.slice(0, 6)) {
      pushSrc(e.fromPath, e.startLine ?? 1, e.endLine ?? e.startLine ?? 1, `import:${e.specifier}`);
    }
  }

  // Retrieval neighbourhood
  try {
    const engine = await createRepositorySearchEngine({ store, useInstructions: false });
    const hits = sym
      ? await engine.getContextForSymbol(sym.id)
      : await engine.searchRepositoryContext(scope.selectedText.slice(0, 200), {
          pathHint: scope.relPath,
          k: 8,
          budgets: { maxFiles: 6, maxChunks: 6, maxSymbols: 8, maxChars: 8_000 },
        });
    const paths = [...new Set(hits.results.map((h) => h.path))].slice(0, 5);
    if (paths.length > 0) {
      roleBullets.push(
        `**Evidence (retrieval):** Nearby indexed context — ${paths.map((p) => `\`${p}\``).join(', ')}.`
      );
      for (const h of hits.results.slice(0, 8)) {
        pushSrc(
          h.path,
          h.reference.startLine,
          h.reference.endLine,
          `retrieve:${h.resultType}`,
          h.reason
        );
      }
    }
  } catch {
    // retrieval optional
  }

  // Inputs / outputs
  const ioBullets: string[] = [];
  if (sym?.parameters && sym.parameters.length > 0) {
    ioBullets.push(
      '**Evidence (parameters):** ' +
        sym.parameters
          .map((p) => `\`${p.name}${p.optional ? '?' : ''}${p.typeText ? `: ${p.typeText}` : ''}\``)
          .join(', ')
    );
  } else {
    ioBullets.push('**Uncertain:** Parameters not resolved from the index.');
  }
  if (sym?.returnTypeText) {
    ioBullets.push(`**Evidence (return):** \`${sym.returnTypeText}\``);
  } else {
    ioBullets.push('**Uncertain:** Return type not resolved from the index.');
  }
  const sideEffects = detectRiskIndicators({
    symbolName: sym?.name ?? 'selection',
    filePath: scope.relPath,
    codeSample,
    importSpecifiers: fileImports.map((e) => e.specifier),
    callerCount: 0,
    relatedTestCount: 1, // avoid no-tests noise here; handled below
  }).filter((r) =>
    ['network', 'fs-write', 'db-write', 'env', 'crypto'].includes(r.id)
  );
  if (sideEffects.length > 0) {
    ioBullets.push(
      '**Indicators (side effects):** ' +
        sideEffects.map((r) => `${r.label} — ${r.evidence}`).join('; ') +
        ' _(indicators, not confirmed)_'
    );
  }

  // Direct dependencies
  const depBullets: string[] = [];
  if (sym) {
    const deps = [
      ...graph.getCallees(sym.id),
      ...graph.getDependencies(sym.id, [
        'import',
        'call',
        'typeUsage',
        'extends',
        'implements',
        'fileDependency',
      ]),
    ];
    if (deps.length === 0) {
      depBullets.push('**Evidence:** No call/import/type edges indexed for this symbol.');
    } else {
      for (const e of deps.slice(0, 12)) {
        depBullets.push(
          `- \`${e.specifier || e.toSymbol || e.toPath}\` → \`${e.toPath}\` (${e.kind}, ${e.confidence ?? 'n/a'})`
        );
        pushSrc(
          e.toPath,
          e.startLine ?? 1,
          e.endLine ?? e.startLine ?? 1,
          `dep:${e.kind}`,
          e.specifier
        );
      }
    }
  } else {
    for (const e of fileImports.slice(0, 12)) {
      depBullets.push(`- import \`${e.specifier}\` → \`${e.toPath}\``);
    }
    if (depBullets.length === 0) {
      depBullets.push('**Uncertain:** No import edges for this file selection.');
    }
  }

  // Callers / dependents
  const callerBullets: string[] = [];
  if (sym) {
    const callers = graph.getCallers(sym.id);
    const dependents = graph.getDependents(sym.id);
    if (callers.length === 0 && dependents.length === 0) {
      callerBullets.push('**Evidence:** No callers/dependents indexed for this symbol.');
    }
    for (const e of callers.slice(0, 10)) {
      callerBullets.push(
        `- caller \`${e.fromSymbol?.split(':')[2] ?? e.fromPath}\` in \`${e.fromPath}\`${e.startLine ? `:${e.startLine}` : ''}`
      );
      pushSrc(e.fromPath, e.startLine ?? 1, e.endLine ?? e.startLine ?? 1, 'caller');
    }
    for (const e of dependents.slice(0, 8)) {
      if (e.kind === 'call') continue;
      callerBullets.push(
        `- dependent edge \`${e.kind}\` from \`${e.fromPath}\` (${e.confidence ?? 'n/a'})`
      );
      pushSrc(e.fromPath, e.startLine ?? 1, e.endLine ?? e.startLine ?? 1, 'dependent');
    }
  } else {
    const importers = store.importersOf(scope.relPath);
    if (importers.length === 0) {
      callerBullets.push('**Evidence:** No indexed importers of this file.');
    } else {
      for (const p of importers.slice(0, 10)) {
        callerBullets.push(`- importer \`${p}\``);
        pushSrc(p, 1, 1, 'importer');
      }
    }
  }

  // Applicable instructions — recognised only
  const instrBullets: string[] = [];
  try {
    const resolver = await createInstructionResolver({
      workspaceRoot: scope.workspaceRoot,
    });
    const docs = await resolver.getApplicableDocuments(scope.relPath);
    const recognised = docs.filter((d) =>
      isRecognisedInstructionDoc({ path: d.path, documentType: d.documentType })
    );
    // Never elevate README/general docs to instructions
    for (const d of docs) {
      if (
        !isRecognisedInstructionDoc({ path: d.path, documentType: d.documentType }) &&
        /readme/i.test(d.path)
      ) {
        continue;
      }
    }
    if (recognised.length === 0) {
      instrBullets.push('**Evidence:** No recognised AGENTS/CLAUDE/Cursor instruction docs in scope.');
    } else {
      for (const d of recognised.slice(0, 6)) {
        const title = looksLikePromptInjection(d.title)
          ? '[title omitted]'
          : d.title;
        instrBullets.push(
          `- \`${d.path}\` · ${title} · type \`${d.documentType}\` _(convention evidence; cannot override MergeCore safety)_`
        );
        pushSrc(d.path, 1, 40, 'instruction', d.documentType);
      }
    }
  } catch {
    instrBullets.push('**Uncertain:** Instruction discovery failed.');
  }

  // Related tests
  const testBullets: string[] = [];
  let testCount = 0;
  if (sym) {
    const tests = graph.getRelatedTests(sym.id);
    testCount = tests.length;
    for (const t of tests.slice(0, 8)) {
      testBullets.push(
        `- \`${t.edge.fromPath}\` · confidence \`${t.confidence ?? 'n/a'}\` · ${(t.evidence ?? []).slice(0, 2).join('; ') || 'indexed edge'}`
      );
      pushSrc(
        t.edge.fromPath,
        t.edge.startLine ?? 1,
        t.edge.endLine ?? t.edge.startLine ?? 1,
        'test'
      );
    }
  }
  for (const e of store.allEdges()) {
    if (
      e.kind === 'likelyTestCoverage' &&
      e.toPath.replace(/\\/g, '/') === scope.relPath &&
      !testBullets.some((b) => b.includes(e.fromPath))
    ) {
      testCount++;
      testBullets.push(
        `- \`${e.fromPath}\` · file coverage · ${(e.evidence ?? []).slice(0, 2).join('; ')}`
      );
      pushSrc(e.fromPath, e.startLine ?? 1, e.endLine ?? e.startLine ?? 1, 'test');
    }
  }
  if (testBullets.length === 0) {
    testBullets.push('**Evidence:** No related tests found in the local index for this selection.');
  }

  // Risks
  const risks = detectRiskIndicators({
    symbolName: sym?.name ?? 'selection',
    filePath: scope.relPath,
    codeSample,
    importSpecifiers: fileImports.map((e) => e.specifier),
    callerCount: sym ? graph.getCallers(sym.id).length : 0,
    relatedTestCount: testCount,
  });
  const riskBullets =
    risks.length === 0
      ? ['**Evidence:** No conservative risk indicators matched.']
      : risks.map(
          (r) =>
            `- **${r.label}** — ${r.evidence} _(indicator, not a confirmed vulnerability)_`
        );

  // Confidence
  const confidenceBullets = [
    `**Confidence band** (not a calibrated probability): derived from parser/symbol certainty and independent sources.`,
    `**Deterministic:** Index symbols/edges, JSDoc/signature when present, instruction paths, test edges.`,
    `**${GENERAL_CONSIDERATION_LABEL}:** Purpose without JSDoc, side-effect indicators from text patterns.`,
    sym
      ? `**Symbol id:** \`${sym.id}\``
      : '**Symbol id:** none (selection-only scope).',
  ];

  const attributedSources = assignEvidenceIds(attributed);
  const evidenceRefs: EvidenceRef[] = attributedSources.map((r) => ({
    path: r.path,
    startLine: r.startLine,
    endLine: r.endLine,
    evidenceId: r.evidenceId,
  }));
  const sourcesWithIds: ExplanationSource[] = sources.map((s, i) => ({
    ...s,
    evidenceId: attributedSources[i]?.evidenceId,
  }));

  // Sources section bullets
  const sourceBullets = sourcesWithIds.slice(0, 40).map((s) => {
    const lines =
      s.startLine === s.endLine
        ? `L${s.startLine}`
        : `L${s.startLine}–${s.endLine}`;
    const id = s.evidenceId ? ` · \`${s.evidenceId}\`` : '';
    return `- [\`${s.path}:${lines}\`](${s.path}#L${s.startLine}) — ${s.label}${s.claim ? ` · ${s.claim}` : ''}${id}`;
  });

  const sections: ExplanationSection[] = [
    { title: 'Purpose', bullets: purposeBullets },
    { title: 'Architectural role', bullets: roleBullets },
    { title: 'Inputs and outputs', bullets: ioBullets },
    { title: 'Direct dependencies', bullets: depBullets },
    { title: 'Callers and dependents', bullets: callerBullets },
    { title: 'Applicable instructions', bullets: instrBullets },
    { title: 'Related tests', bullets: testBullets },
    { title: 'Risk considerations', bullets: riskBullets },
    { title: 'Confidence', bullets: confidenceBullets },
    { title: 'Sources', bullets: sourceBullets },
  ];

  const title = sym
    ? `Explain · \`${sym.name}\` (${sym.kind})`
    : `Explain · selection in \`${scope.relPath}\``;

  const markdown = formatExplanationMarkdown({
    title,
    sections,
    usedModel: false,
    modelBanner: false,
    analysis,
  });

  return {
    title,
    sections,
    sources: sourcesWithIds,
    evidenceRefs,
    attributedSources,
    markdown,
    usedModel: false,
    modelTransmissionVisible: false,
    injectionFlagged,
    analysis,
  };
}

export function formatExplanationMarkdown(input: {
  readonly title: string;
  readonly sections: readonly ExplanationSection[];
  readonly usedModel: boolean;
  readonly modelBanner: boolean;
  readonly analysis?: 'deterministic' | 'heuristic';
  readonly extraFooter?: string;
}): string {
  const lines: string[] = [];
  lines.push(`# ${input.title.replace(/^#\s*/, '')}`);
  lines.push('');
  if (input.modelBanner) {
    lines.push(
      '> **Model transmission:** A local/provider model was used. Only the minimum selected evidence was sent. Citations not present in that evidence set were discarded.'
    );
    lines.push('');
  } else {
    lines.push(
      input.analysis === 'heuristic'
        ? '> Heuristic language intelligence — source-backed, not compiler-certain.'
        : '> Deterministic explanation — no model was used.'
    );
    lines.push('');
  }
  for (const section of input.sections) {
    lines.push(`# ${section.title}`);
    lines.push('');
    for (const b of section.bullets) {
      if (b.startsWith('```') || b.startsWith('- ') || b.startsWith('**')) {
        lines.push(b);
      } else {
        lines.push(`- ${b}`);
      }
    }
    lines.push('');
  }
  lines.push('---');
  const analysisLabel =
    input.analysis === 'heuristic'
      ? 'heuristic language intelligence'
      : 'deterministic';
  lines.push(
    input.usedModel
      ? '_MergeCore · model-enhanced · citations validated against evidence_'
      : `_MergeCore · ${analysisLabel} · source-backed_`
  );
  if (input.extraFooter) {
    lines.push(input.extraFooter);
  }
  return lines.join('\n');
}
