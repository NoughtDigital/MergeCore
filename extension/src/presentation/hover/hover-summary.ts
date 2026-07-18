import type { DependencyEdge, SymbolRecord } from '@mergecore/intelligence';
import { detectRiskIndicators, type RiskIndicator } from './hover-risks';

export type ClaimKind = 'evidence' | 'inference';

export interface HoverClaim {
  readonly text: string;
  readonly kind: ClaimKind;
}

export interface HoverSummary {
  readonly symbolId: string;
  readonly name: string;
  readonly kind: string;
  readonly language: string;
  readonly path: string;
  readonly startLine: number;
  readonly endLine: number;
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
  readonly confidence: 'high' | 'medium' | 'low' | 'uncertain';
  readonly analysis: 'deterministic' | 'heuristic';
  readonly callerCount: number;
  readonly dependencyCount: number;
  readonly relatedTestCount: number;
  readonly exported?: boolean;
}

export interface AssembleHoverSummaryInput {
  readonly symbol: SymbolRecord;
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

/**
 * Build a compact, evidence-first hover summary (no model calls).
 */
export function assembleHoverSummary(input: AssembleHoverSummaryInput): HoverSummary {
  const { symbol: sym } = input;
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

  const purpose: HoverClaim = sym.jsdocSummary
    ? { text: sym.jsdocSummary, kind: 'evidence' }
    : {
        text: `${sym.kind} \`${sym.name}\`${sym.exported ? ' (exported)' : ''}`,
        kind: 'inference',
      };

  const role: HoverClaim = {
    text: sym.containerName
      ? `Member of \`${sym.containerName}\` in \`${sym.location.path}\``
      : `Defined in \`${sym.location.path}\`${sym.exported ? ' · module export' : ''}`,
    kind: 'evidence',
  };

  const inputs: HoverClaim = {
    text: paramsText(sym),
    kind: sym.parameters && sym.parameters.length > 0 ? 'evidence' : 'inference',
  };

  const output: HoverClaim = sym.returnTypeText
    ? { text: sym.returnTypeText, kind: 'evidence' }
    : { text: 'unknown', kind: 'inference' };

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

  const hasJsdoc = Boolean(sym.jsdocSummary);
  const confidence: HoverSummary['confidence'] =
    hasJsdoc && callerEdges.length >= 0 ? 'high' : sym.exported ? 'medium' : 'medium';

  return {
    symbolId: sym.id,
    name: sym.name,
    kind: sym.kind,
    language: sym.language,
    path: sym.location.path,
    startLine: sym.location.startLine,
    endLine: sym.location.endLine,
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
    confidence,
    analysis: 'deterministic',
    callerCount: callerEdges.length,
    dependencyCount: dependencies.length,
    relatedTestCount: relatedTests.length,
    exported: sym.exported,
  };
}

export function claimLabel(claim: HoverClaim): string {
  return claim.kind === 'inference' ? `${claim.text} _(inference)_` : claim.text;
}
