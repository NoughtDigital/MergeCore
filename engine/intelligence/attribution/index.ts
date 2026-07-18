import type {
  ClaimConfidence,
  ConfidenceComponents,
  ConfidenceLevel,
  ComponentCertainty,
  ContextClaim,
  SourceAuthored,
  SourceExtraction,
  SourceFreshness,
  SourceReference,
  SourceType,
} from '../contracts/types';
import { isUnderGeneratedDir } from '../memory/paths';

export type SourceReferenceInput = {
  readonly workspaceId: string;
  readonly path: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly startColumn?: number;
  readonly endColumn?: number;
  readonly sourceType: SourceType;
  readonly sourceFingerprint?: string;
  readonly symbolId?: string;
  readonly symbol?: string;
  readonly authored?: SourceAuthored;
  readonly extraction?: SourceExtraction;
  readonly excerpt?: string;
  readonly evidenceId?: string;
};

/** Normalise relative paths to POSIX separators for stable attribution. */
export function normaliseSourcePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.\//, '');
}

export function inferSourceAuthored(path: string): SourceAuthored {
  return isUnderGeneratedDir(normaliseSourcePath(path)) ? 'generated' : 'human';
}

/**
 * Build a complete SourceReference. Missing fingerprint becomes empty string
 * (callers should prefer content hashes when available).
 */
export function createSourceReference(input: SourceReferenceInput): SourceReference {
  const path = normaliseSourcePath(input.path);
  const startLine = Math.max(1, Math.floor(input.startLine));
  const endLine = Math.max(startLine, Math.floor(input.endLine));
  const ref: SourceReference = {
    workspaceId: input.workspaceId || 'unknown',
    path,
    startLine,
    endLine,
    sourceType: input.sourceType,
    sourceFingerprint: input.sourceFingerprint ?? '',
    authored: input.authored ?? inferSourceAuthored(path),
    extraction: input.extraction ?? 'deterministic',
  };
  return {
    ...ref,
    ...(input.startColumn !== undefined
      ? { startColumn: Math.max(1, Math.floor(input.startColumn)) }
      : {}),
    ...(input.endColumn !== undefined
      ? { endColumn: Math.max(1, Math.floor(input.endColumn)) }
      : {}),
    ...(input.symbolId !== undefined ? { symbolId: input.symbolId } : {}),
    ...(input.symbol !== undefined ? { symbol: input.symbol } : {}),
    ...(input.excerpt !== undefined ? { excerpt: input.excerpt } : {}),
    ...(input.evidenceId !== undefined ? { evidenceId: input.evidenceId } : {}),
  };
}

const CERTAINTY_WEIGHT: Record<ComponentCertainty, number> = {
  certain: 1,
  high: 0.85,
  medium: 0.6,
  low: 0.35,
  none: 0,
};

function averageCertainty(
  values: readonly (ComponentCertainty | undefined)[]
): number | undefined {
  const present = values.filter((v): v is ComponentCertainty => v !== undefined);
  if (present.length === 0) return undefined;
  return present.reduce((s, v) => s + CERTAINTY_WEIGHT[v], 0) / present.length;
}

/**
 * Derive a normalised confidence level from explainable components.
 * The optional diagnosticScore is for tooling only — not a probability.
 */
export function computeClaimConfidence(
  components: ConfidenceComponents
): ClaimConfidence {
  const rationale: string[] = [];
  let score = 0.55;
  let weight = 0;

  const push = (label: string, value: number, w = 1): void => {
    score += value * w;
    weight += w;
    rationale.push(label);
  };

  const certAvg = averageCertainty([
    components.parserCertainty,
    components.symbolResolutionCertainty,
    components.dependencyResolutionCertainty,
    components.documentClassificationCertainty,
    components.instructionScopeCertainty,
  ]);
  if (certAvg !== undefined) {
    push(`component-certainty=${certAvg.toFixed(2)}`, certAvg, 2);
  }

  if (components.independentSourceCount !== undefined) {
    const n = components.independentSourceCount;
    const boost = Math.min(1, n / 3);
    push(`independent-sources=${n}`, boost, 1.2);
  }

  if (components.sourceFreshness === 'fresh') {
    push('source-freshness=fresh', 0.9, 0.8);
  } else if (components.sourceFreshness === 'stale') {
    push('source-freshness=stale', 0.35, 1.2);
  } else if (components.sourceFreshness === 'missing') {
    push('source-freshness=missing', 0.1, 1.5);
  } else if (components.sourceFreshness === 'unknown') {
    push('source-freshness=unknown', 0.5, 0.4);
  }

  if (components.modelGenerated) {
    push('model-generated', 0.4, 1.5);
  }

  const diagnosticScore =
    weight > 0 ? Math.max(0, Math.min(1, score / (weight + 0.55))) : 0.5;

  let level: ConfidenceLevel;
  if (
    components.sourceFreshness === 'missing' ||
    (components.modelGenerated && (components.independentSourceCount ?? 0) === 0)
  ) {
    level = 'low';
  } else if (diagnosticScore >= 0.72) {
    level = 'high';
  } else if (diagnosticScore >= 0.45) {
    level = 'medium';
  } else {
    level = 'low';
  }

  return {
    level,
    components,
    rationale,
    diagnosticScore,
  };
}

export function confidenceFromRetrieval(input: {
  readonly analysis: SourceExtraction;
  readonly hitConfidence: ConfidenceLevel | 'uncertain';
  readonly independentSourceCount?: number;
  readonly modelGenerated?: boolean;
  readonly sourceFreshness?: SourceFreshness;
}): ClaimConfidence {
  const mapped: ConfidenceLevel =
    input.hitConfidence === 'uncertain' ? 'low' : input.hitConfidence;
  const symbolResolutionCertainty: ComponentCertainty =
    input.analysis === 'deterministic'
      ? mapped === 'high'
        ? 'certain'
        : mapped
      : mapped === 'high'
        ? 'medium'
        : 'low';
  return computeClaimConfidence({
    parserCertainty: input.analysis === 'deterministic' ? 'high' : 'medium',
    symbolResolutionCertainty,
    independentSourceCount: input.independentSourceCount ?? 1,
    sourceFreshness: input.sourceFreshness ?? 'unknown',
    modelGenerated: input.modelGenerated ?? false,
  });
}

export class AttributionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AttributionError';
  }
}

/** Enforce: repository claims need sources; otherwise generalConsideration. */
export function assertClaimAttributed(claim: ContextClaim): void {
  if (claim.generalConsideration) {
    return;
  }
  if (!claim.references || claim.references.length === 0) {
    throw new AttributionError(
      `Claim "${claim.id}" has no SourceReference and is not labelled a general consideration`
    );
  }
}

export function createAttributedClaim(input: {
  readonly id: string;
  readonly text: string;
  readonly references?: readonly SourceReference[];
  readonly generalConsideration?: boolean;
  readonly components?: ConfidenceComponents;
  readonly confidenceDetail?: ClaimConfidence;
  readonly score?: number;
}): ContextClaim {
  const references = input.references ?? [];
  if (references.length === 0 && input.generalConsideration === false) {
    throw new AttributionError('Repository claims require at least one SourceReference');
  }
  const generalConsideration =
    input.generalConsideration === true || references.length === 0;
  if (!generalConsideration && references.length === 0) {
    throw new AttributionError('Repository claims require at least one SourceReference');
  }
  const confidenceDetail =
    input.confidenceDetail ??
    computeClaimConfidence(
      input.components ?? {
        independentSourceCount: references.length,
        sourceFreshness: 'unknown',
        modelGenerated: false,
        parserCertainty: references.some((r) => r.extraction === 'heuristic')
          ? 'medium'
          : 'high',
      }
    );
  const claim: ContextClaim = {
    id: input.id,
    text: input.text,
    confidence: confidenceDetail.level,
    confidenceDetail,
    references,
    ...(generalConsideration ? { generalConsideration: true } : {}),
    ...(input.score !== undefined ? { score: input.score } : {}),
  };
  assertClaimAttributed(claim);
  return claim;
}

export const GENERAL_CONSIDERATION_LABEL =
  'General consideration (not a repository fact)';

export function formatClaimAttributionLabel(claim: ContextClaim): string {
  if (claim.generalConsideration || claim.references.length === 0) {
    return GENERAL_CONSIDERATION_LABEL;
  }
  const bits = claim.references.map((r) => {
    const col =
      r.startColumn !== undefined ? `:${r.startColumn}` : '';
    return `${r.path}#L${r.startLine}${col}`;
  });
  return `Sources: ${bits.join(', ')}`;
}

/** Assign sequential evidence-N ids for model packaging. */
export function assignEvidenceIds(
  references: readonly SourceReference[],
  startIndex = 1
): readonly SourceReference[] {
  return references.map((r, i) => ({
    ...r,
    evidenceId: r.evidenceId ?? `evidence-${startIndex + i}`,
  }));
}

export function evidenceMapById(
  references: readonly SourceReference[]
): Map<string, SourceReference> {
  const map = new Map<string, SourceReference>();
  for (const r of references) {
    if (r.evidenceId) {
      map.set(r.evidenceId, r);
    }
  }
  return map;
}

export interface ModelClaimInput {
  readonly text: string;
  readonly evidenceIds: readonly string[];
  readonly certainty?: ConfidenceLevel;
}

export interface ModelClaimsBundle {
  readonly claims: readonly ModelClaimInput[];
}

export interface ModelClaimValidationResult {
  readonly accepted: readonly ContextClaim[];
  readonly rejected: readonly {
    readonly text: string;
    readonly evidenceIds: readonly string[];
    readonly reason: string;
  }[];
}

/**
 * Validate model claim JSON: every claim must cite known evidence IDs.
 * Claims with missing/unknown IDs are rejected and never enter the result.
 */
export function validateModelClaimBundle(
  bundle: ModelClaimsBundle,
  evidenceById: ReadonlyMap<string, SourceReference>
): ModelClaimValidationResult {
  const accepted: ContextClaim[] = [];
  const rejected: ModelClaimValidationResult['rejected'][number][] = [];

  for (let i = 0; i < bundle.claims.length; i++) {
    const raw = bundle.claims[i]!;
    const text = typeof raw.text === 'string' ? raw.text.trim() : '';
    const ids = Array.isArray(raw.evidenceIds)
      ? raw.evidenceIds.filter((id): id is string => typeof id === 'string' && id.length > 0)
      : [];
    if (!text) {
      rejected.push({
        text: String(raw.text ?? ''),
        evidenceIds: ids,
        reason: 'empty_text',
      });
      continue;
    }
    if (ids.length === 0) {
      rejected.push({ text, evidenceIds: ids, reason: 'missing_evidence_ids' });
      continue;
    }
    const refs: SourceReference[] = [];
    const unknown: string[] = [];
    for (const id of ids) {
      const ref = evidenceById.get(id);
      if (!ref) unknown.push(id);
      else refs.push(ref);
    }
    if (unknown.length > 0 || refs.length === 0) {
      rejected.push({
        text,
        evidenceIds: ids,
        reason: `unknown_evidence_ids:${unknown.join(',') || 'none'}`,
      });
      continue;
    }
    const uniquePaths = new Set(refs.map((r) => r.path));
    accepted.push(
      createAttributedClaim({
        id: `model-claim:${i + 1}`,
        text,
        references: refs,
        components: {
          independentSourceCount: uniquePaths.size,
          modelGenerated: true,
          parserCertainty: refs.every((r) => r.extraction === 'deterministic')
            ? 'high'
            : 'medium',
          sourceFreshness: 'unknown',
        },
      })
    );
  }

  return { accepted, rejected };
}

/**
 * Parse model JSON that matches the evidence-id claim shape.
 * Returns undefined when the payload is not usable JSON.
 */
export function parseModelClaimsJson(raw: string): ModelClaimsBundle | undefined {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced?.[1]?.trim() ?? trimmed;
  try {
    const parsed = JSON.parse(body) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return undefined;
    }
    const claims = (parsed as { claims?: unknown }).claims;
    if (!Array.isArray(claims)) {
      return undefined;
    }
    return {
      claims: claims.map((c) => {
        const row = c as Partial<ModelClaimInput>;
        return {
          text: typeof row.text === 'string' ? row.text : '',
          evidenceIds: Array.isArray(row.evidenceIds)
            ? row.evidenceIds.map(String)
            : [],
          certainty:
            row.certainty === 'high' ||
            row.certainty === 'medium' ||
            row.certainty === 'low'
              ? row.certainty
              : undefined,
        };
      }),
    };
  } catch {
    return undefined;
  }
}

export type SourceLinkStatus = 'ok' | 'stale' | 'missing' | 'wrong_workspace';

export interface WorkspaceRootRef {
  readonly workspaceId: string;
  readonly rootPath: string;
}

export interface SourceLinkInspection {
  readonly status: SourceLinkStatus;
  readonly absolutePath?: string;
  readonly workspaceRoot?: string;
  readonly message?: string;
  readonly expectedFingerprint?: string;
  readonly actualFingerprint?: string;
}

function joinRoot(root: string, rel: string): string {
  const normalisedRoot = root.replace(/[/\\]+$/, '');
  const relParts = normaliseSourcePath(rel).split('/').filter(Boolean);
  // path.join semantics without importing node:path (keep module isomorphic for tests)
  const sep = normalisedRoot.includes('\\') && !normalisedRoot.includes('/') ? '\\' : '/';
  if (sep === '\\') {
    return [normalisedRoot, ...relParts].join('\\');
  }
  return [normalisedRoot, ...relParts].join('/');
}

/**
 * Resolve a SourceReference against one or more workspace roots.
 * Does not open editors — hosts use this before revealing a range.
 */
export async function inspectSourceReference(
  roots: readonly WorkspaceRootRef[],
  ref: SourceReference,
  io: {
    readonly exists: (absolutePath: string) => Promise<boolean>;
    readonly fingerprint?: (absolutePath: string) => Promise<string | undefined>;
  }
): Promise<SourceLinkInspection> {
  const path = normaliseSourcePath(ref.path);
  const matched =
    roots.find((r) => r.workspaceId === ref.workspaceId) ??
    (roots.length === 1 ? roots[0] : undefined);

  if (!matched) {
    // Fall back: try every root for the relative path (multi-root without id match)
    for (const root of roots) {
      const abs = joinRoot(root.rootPath, path);
      if (await io.exists(abs)) {
        return inspectAt(abs, root, ref, io);
      }
    }
    return {
      status: 'wrong_workspace',
      message: `No workspace root matched workspaceId=${ref.workspaceId} for ${path}`,
      expectedFingerprint: ref.sourceFingerprint || undefined,
    };
  }

  const abs = joinRoot(matched.rootPath, path);
  if (!(await io.exists(abs))) {
    return {
      status: 'missing',
      absolutePath: abs,
      workspaceRoot: matched.rootPath,
      message: `Source file missing or deleted: ${path}`,
      expectedFingerprint: ref.sourceFingerprint || undefined,
    };
  }
  return inspectAt(abs, matched, ref, io);
}

async function inspectAt(
  abs: string,
  root: WorkspaceRootRef,
  ref: SourceReference,
  io: {
    readonly fingerprint?: (absolutePath: string) => Promise<string | undefined>;
  }
): Promise<SourceLinkInspection> {
  if (!io.fingerprint || !ref.sourceFingerprint) {
    return {
      status: 'ok',
      absolutePath: abs,
      workspaceRoot: root.rootPath,
      expectedFingerprint: ref.sourceFingerprint || undefined,
    };
  }
  const actual = await io.fingerprint(abs);
  if (!actual) {
    return {
      status: 'ok',
      absolutePath: abs,
      workspaceRoot: root.rootPath,
      expectedFingerprint: ref.sourceFingerprint,
      message: 'Could not recompute fingerprint; opening captured range',
    };
  }
  if (actual !== ref.sourceFingerprint) {
    return {
      status: 'stale',
      absolutePath: abs,
      workspaceRoot: root.rootPath,
      expectedFingerprint: ref.sourceFingerprint,
      actualFingerprint: actual,
      message: `Source fingerprint changed for ${ref.path} (stale evidence)`,
    };
  }
  return {
    status: 'ok',
    absolutePath: abs,
    workspaceRoot: root.rootPath,
    expectedFingerprint: ref.sourceFingerprint,
    actualFingerprint: actual,
  };
}

export function sourceRangeForReveal(ref: SourceReference): {
  readonly startLine: number;
  readonly endLine: number;
  readonly startColumn: number;
  readonly endColumn: number;
} {
  return {
    startLine: ref.startLine,
    endLine: ref.endLine,
    startColumn: ref.startColumn ?? 1,
    endColumn: ref.endColumn ?? 1,
  };
}
