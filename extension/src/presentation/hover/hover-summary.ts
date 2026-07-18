import type {
  ClaimConfidence,
  DependencyEdge,
  SourceReference,
  SymbolRecord,
} from '@mergecore/intelligence';
import {
  computeClaimConfidence,
  createSourceReference,
  formatClaimAttributionLabel,
  GENERAL_CONSIDERATION_LABEL,
} from '@mergecore/intelligence';
import { detectRiskIndicators, type RiskIndicator } from './hover-risks';

export type ClaimKind = 'evidence' | 'inference';

export interface HoverClaim {
  readonly text: string;
  readonly kind: ClaimKind;
  readonly references: readonly SourceReference[];
  /** When true (or references empty), not a repository fact. */
  readonly generalConsideration?: boolean;
  readonly confidenceDetail: ClaimConfidence;
}

export interface HoverSummary {
  readonly symbolId: string;
  readonly name: string;
  readonly kind: string;
  readonly language: string;
  readonly path: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly startColumn?: number;
  readonly endColumn?: number;
  readonly workspaceId: string;
  readonly sourceFingerprint: string;
  readonly signature?: string;
  readonly jsdocSummary?: string;
  readonly purpose: HoverClaim;
  readonly role: HoverClaim;
  readonly inputs: HoverClaim;
  readonly output: HoverClaim;
  readonly dependencies: readonly { path: string; symbolId?: string; label: string }[];
  readonly callers: readonly { path: string; symbolId?: string; label: string; line?: number }[];
  readonly relatedTests: readonly { path: string; evidence: readonly string[]; confidence?: string }[];
  readonly instructions: readonly { path: string; title: string; excerpt: string }[];
  readonly risks: readonly RiskIndicator[];
  readonly confidence: 'high' | 'medium' | 'low';
  readonly confidenceDetail: ClaimConfidence;
  readonly analysis: 'deterministic' | 'heuristic';
  readonly callerCount: number;
  readonly dependencyCount: number;
  readonly relatedTestCount: number;
  readonly exported?: boolean;
}

export interface AssembleHoverSummaryInput {
  readonly symbol: SymbolRecord;
  readonly workspaceId: string;
  readonly sourceFingerprint?: string;
  readonly codeSample?: string;
  readonly callers: readonly DependencyEdge[];
  readonly callees: readonly DependencyEdge[];
  readonly dependencies: readonly DependencyEdge[];
  readonly relatedTests: ReadonlyArray<{
    readonly path: string;
    readonly evidence?: readonly string[];
    readonly confidence?: string;
  }>;
  readonly instructions: ReadonlyArray<{
    readonly path: string;
    readonly title: string;
    readonly excerpt?: string;
  }>;
  readonly importSpecifiers?: readonly string[];
}

function paramsText(sym: SymbolRecord): string {
  if (!sym.parameters || sym.parameters.length === 0) {
    return 'none listed';
  }
  return sym.parameters
    .map((p) => {
      const t = p.typeText ? `: ${p.typeText}` : '';
      const opt = p.optional ? '?' : '';
      const rest = p.rest ? '...' : '';
      return `${rest}${p.name}${opt}${t}`;
    })
    .join(', ');
}

function symbolRef(
  workspaceId: string,
  sym: SymbolRecord,
  fingerprint: string
): SourceReference {
  return createSourceReference({
    workspaceId,
    path: sym.location.path,
    startLine: sym.location.startLine,
    endLine: sym.location.endLine,
    startColumn: sym.location.startColumn,
    endColumn: sym.location.endColumn,
    sourceType: 'symbol',
    sourceFingerprint: fingerprint,
    symbolId: sym.id,
    symbol: sym.name,
    extraction: 'deterministic',
  });
}

function makeClaim(input: {
  text: string;
  kind: ClaimKind;
  references?: readonly SourceReference[];
  generalConsideration?: boolean;
  components?: Parameters<typeof computeClaimConfidence>[0];
}): HoverClaim {
  const references = input.references ?? [];
  const generalConsideration =
    input.generalConsideration === true ||
    (input.kind === 'inference' && references.length === 0);
  const confidenceDetail = computeClaimConfidence(
    input.components ?? {
      parserCertainty: references.length > 0 ? 'high' : 'none',
      symbolResolutionCertainty: references.length > 0 ? 'high' : 'low',
      independentSourceCount: references.length,
      sourceFreshness: fingerprintFreshness(references),
      modelGenerated: false,
    }
  );
  return {
    text: input.text,
    kind: input.kind,
    references,
    ...(generalConsideration ? { generalConsideration: true } : {}),
    confidenceDetail,
  };
}

function fingerprintFreshness(
  refs: readonly SourceReference[]
): 'fresh' | 'unknown' {
  return refs.some((r) => r.sourceFingerprint) ? 'fresh' : 'unknown';
}

/**
 * Build a compact, evidence-first hover summary (no model calls).
 */
export function assembleHoverSummary(input: AssembleHoverSummaryInput): HoverSummary {
  const { symbol: sym } = input;
  const fingerprint = input.sourceFingerprint ?? '';
  const selfRef = symbolRef(input.workspaceId, sym, fingerprint);

  const callerEdges = input.callers;
  const depEdges = [
    ...input.callees.filter((e) => e.kind === 'call'),
    ...input.dependencies.filter(
      (e) =>
        e.kind === 'import' ||
        e.kind === 'fileDependency' ||
        e.kind === 'extends' ||
        e.kind === 'implements' ||
        e.kind === 'typeUsage'
    ),
  ];

  const purpose = sym.jsdocSummary
    ? makeClaim({
        text: sym.jsdocSummary,
        kind: 'evidence',
        references: [selfRef],
      })
    : makeClaim({
        text: `${sym.kind} \`${sym.name}\`${sym.exported ? ' (exported)' : ''}`,
        kind: 'inference',
        references: [selfRef],
        components: {
          parserCertainty: 'high',
          symbolResolutionCertainty: 'high',
          independentSourceCount: 1,
          sourceFreshness: fingerprint ? 'fresh' : 'unknown',
        },
      });

  const role = makeClaim({
    text: sym.containerName
      ? `Member of \`${sym.containerName}\` in \`${sym.location.path}\``
      : `Defined in \`${sym.location.path}\`${sym.exported ? ' · module export' : ''}`,
    kind: 'evidence',
    references: [selfRef],
  });

  const inputs = makeClaim({
    text: paramsText(sym),
    kind: sym.parameters && sym.parameters.length > 0 ? 'evidence' : 'inference',
    references: sym.parameters && sym.parameters.length > 0 ? [selfRef] : [],
    generalConsideration: !(sym.parameters && sym.parameters.length > 0),
  });

  const output = sym.returnTypeText
    ? makeClaim({
        text: sym.returnTypeText,
        kind: 'evidence',
        references: [selfRef],
      })
    : makeClaim({
        text: 'unknown',
        kind: 'inference',
        generalConsideration: true,
      });

  const dependencies = depEdges.slice(0, 8).map((e) => ({
    path: e.toPath,
    symbolId: e.toSymbol,
    label: e.specifier || e.toSymbol || e.toPath,
  }));

  const callers = callerEdges.slice(0, 8).map((e) => ({
    path: e.fromPath,
    symbolId: e.fromSymbol,
    label: e.fromSymbol?.split(':')[2] ?? e.fromPath,
    line: e.startLine,
  }));

  const relatedTests = input.relatedTests.slice(0, 6).map((t) => ({
    path: t.path,
    evidence: t.evidence ?? [],
    confidence: t.confidence,
  }));

  const instructions = input.instructions.slice(0, 4).map((i) => ({
    path: i.path,
    title: i.title,
    excerpt: (i.excerpt ?? '').slice(0, 120),
  }));

  const risks = detectRiskIndicators({
    symbolName: sym.name,
    filePath: sym.location.path,
    codeSample: input.codeSample,
    importSpecifiers: input.importSpecifiers,
    callerCount: callerEdges.length,
    relatedTestCount: relatedTests.length,
  });

  const confidenceDetail = computeClaimConfidence({
    parserCertainty: 'high',
    symbolResolutionCertainty: 'high',
    independentSourceCount:
      1 + (callerEdges.length > 0 ? 1 : 0) + (relatedTests.length > 0 ? 1 : 0),
    sourceFreshness: fingerprint ? 'fresh' : 'unknown',
    modelGenerated: false,
  });

  const analysis: 'deterministic' | 'heuristic' =
    sym.adapterId === 'typescript' || sym.adapterId === 'javascript'
      ? 'deterministic'
      : sym.language === 'typescript' || sym.language === 'javascript'
        ? 'deterministic'
        : 'heuristic';

  return {
    symbolId: sym.id,
    name: sym.name,
    kind: sym.kind,
    language: sym.language,
    path: sym.location.path,
    startLine: sym.location.startLine,
    endLine: sym.location.endLine,
    startColumn: sym.location.startColumn,
    endColumn: sym.location.endColumn,
    workspaceId: input.workspaceId,
    sourceFingerprint: fingerprint,
    signature: sym.signatureText,
    jsdocSummary: sym.jsdocSummary,
    purpose,
    role,
    inputs,
    output,
    dependencies,
    callers,
    relatedTests,
    instructions,
    risks,
    confidence: confidenceDetail.level,
    confidenceDetail,
    analysis,
    callerCount: callerEdges.length,
    dependencyCount: dependencies.length,
    relatedTestCount: relatedTests.length,
    exported: sym.exported,
  };
}

export function claimLabel(claim: HoverClaim): string {
  if (claim.generalConsideration || claim.references.length === 0) {
    return `${claim.text} _(${GENERAL_CONSIDERATION_LABEL})_`;
  }
  const attr = formatClaimAttributionLabel({
    id: 'hover',
    text: claim.text,
    confidence: claim.confidenceDetail.level,
    confidenceDetail: claim.confidenceDetail,
    references: claim.references,
  });
  if (claim.kind === 'inference') {
    return `${claim.text} _(inference · ${attr})_`;
  }
  return `${claim.text} _(${attr})_`;
}
