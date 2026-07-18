/**
 * Validate model citations: prefer evidence IDs; fall back to path/line stripping.
 */

import {
  evidenceMapById,
  parseModelClaimsJson,
  validateModelClaimBundle,
  type SourceReference,
} from '@mergecore/intelligence';

export interface EvidenceRef {
  readonly path: string;
  readonly startLine?: number;
  readonly endLine?: number;
  readonly evidenceId?: string;
}

export interface CitationValidationResult {
  readonly markdown: string;
  readonly keptCitations: readonly string[];
  readonly discardedCitations: readonly string[];
  readonly acceptedClaimTexts?: readonly string[];
  readonly rejectedClaimCount?: number;
}

const CITATION_RE =
  /(?:`?([\w./@+-]+\.(?:ts|tsx|js|jsx|mjs|cjs|md|mdc))`?)(?:\s*(?:#|@|:|\bline\b|\blines\b)\s*L?(\d+)(?:\s*[-–—]\s*L?(\d+))?)?/gi;

const EVIDENCE_ID_RE = /\bevidence-\d+\b/g;

function normalisePath(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.\//, '');
}

function evidenceAllows(ref: EvidenceRef, evidence: readonly EvidenceRef[]): boolean {
  const path = normalisePath(ref.path);
  for (const e of evidence) {
    const ep = normalisePath(e.path);
    if (ep !== path && !ep.endsWith('/' + path) && !path.endsWith('/' + ep)) {
      if (ep.split('/').pop() !== path.split('/').pop()) {
        continue;
      }
    }
    if (ref.startLine === undefined) {
      return true;
    }
    const es = e.startLine ?? 1;
    const ee = e.endLine ?? e.startLine ?? Number.MAX_SAFE_INTEGER;
    if (ref.startLine >= es - 2 && ref.startLine <= ee + 2) {
      return true;
    }
    if (e.startLine === undefined) {
      return true;
    }
  }
  return evidence.some((e) => {
    const ep = normalisePath(e.path);
    return (
      ep === path ||
      ep.endsWith('/' + path) ||
      path.endsWith('/' + ep) ||
      ep.split('/').pop() === path.split('/').pop()
    );
  });
}

/**
 * Drop citations that were not in the evidence set. Leaves surrounding prose
 * but appends a note when discards occur.
 */
export function validateAndStripCitations(
  markdown: string,
  evidence: readonly EvidenceRef[]
): CitationValidationResult {
  const kept: string[] = [];
  const discarded: string[] = [];
  let cleaned = markdown;

  const knownIds = new Set(
    evidence.map((e) => e.evidenceId).filter((id): id is string => Boolean(id))
  );
  if (knownIds.size > 0) {
    const idMatches = [...markdown.matchAll(EVIDENCE_ID_RE)];
    for (let i = idMatches.length - 1; i >= 0; i--) {
      const m = idMatches[i]!;
      const id = m[0]!;
      if (knownIds.has(id)) {
        kept.push(id);
      } else {
        discarded.push(id);
        const idx = m.index ?? -1;
        if (idx >= 0) {
          cleaned =
            cleaned.slice(0, idx) +
            `_(citation removed: unknown evidence id)_` +
            cleaned.slice(idx + id.length);
        }
      }
    }
  }

  const matches = [...cleaned.matchAll(CITATION_RE)];
  for (let i = matches.length - 1; i >= 0; i--) {
    const m = matches[i]!;
    const full = m[0]!;
    const file = m[1]!;
    const start = m[2] ? Number(m[2]) : undefined;
    const end = m[3] ? Number(m[3]) : start;
    const ref: EvidenceRef = { path: file, startLine: start, endLine: end };
    const key = `${normalisePath(file)}${start !== undefined ? `:${start}` : ''}`;
    if (evidenceAllows(ref, evidence)) {
      kept.push(key);
    } else {
      discarded.push(key);
      const idx = m.index ?? -1;
      if (idx >= 0) {
        cleaned =
          cleaned.slice(0, idx) +
          `_(citation removed: not in evidence)_` +
          cleaned.slice(idx + full.length);
      }
    }
  }

  if (discarded.length > 0) {
    cleaned +=
      `\n\n---\n_MergeCore discarded ${discarded.length} model citation(s) that were not in the evidence set sent._`;
  }

  return {
    markdown: cleaned,
    keptCitations: [...new Set(kept)],
    discardedCitations: [...new Set(discarded)],
  };
}

/**
 * Prefer structured claim JSON with evidenceIds. Reject unsupported claims entirely.
 */
export function validateModelClaimsAgainstEvidence(
  modelText: string,
  evidence: readonly SourceReference[]
): CitationValidationResult {
  const withIds = evidence.every((e) => e.evidenceId)
    ? evidence
    : evidence.map((e, i) => ({ ...e, evidenceId: e.evidenceId ?? `evidence-${i + 1}` }));
  const map = evidenceMapById(withIds);
  const bundle = parseModelClaimsJson(modelText);
  if (!bundle) {
    // Fall back to legacy path/line stripping
    return validateAndStripCitations(
      modelText,
      withIds.map((e) => ({
        path: e.path,
        startLine: e.startLine,
        endLine: e.endLine,
        evidenceId: e.evidenceId,
      }))
    );
  }
  const result = validateModelClaimBundle(bundle, map);
  const lines = [
    '# Model claims (validated evidence IDs only)',
    '',
    ...result.accepted.map(
      (c) =>
        `- ${c.text} _(evidence: ${c.references.map((r) => r.evidenceId).join(', ')}; confidence ${c.confidence})_`
    ),
  ];
  if (result.rejected.length > 0) {
    lines.push('');
    lines.push(
      `---\n_MergeCore rejected ${result.rejected.length} unsupported model claim(s) (missing or unknown evidence IDs)._`
    );
  }
  return {
    markdown: lines.join('\n'),
    keptCitations: result.accepted.flatMap((c) =>
      c.references.map((r) => r.evidenceId!).filter(Boolean)
    ),
    discardedCitations: result.rejected.flatMap((r) => [...r.evidenceIds]),
    acceptedClaimTexts: result.accepted.map((c) => c.text),
    rejectedClaimCount: result.rejected.length,
  };
}
