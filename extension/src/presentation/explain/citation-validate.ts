/**
 * Validate model citations against the evidence set that was actually sent.
 */

export interface EvidenceRef {
  readonly path: string;
  readonly startLine?: number;
  readonly endLine?: number;
}

export interface CitationValidationResult {
  readonly markdown: string;
  readonly keptCitations: readonly string[];
  readonly discardedCitations: readonly string[];
}

const CITATION_RE =
  /(?:`?([\w./@+-]+\.(?:ts|tsx|js|jsx|mjs|cjs|md|mdc))`?)(?:\s*(?:#|@|:|\bline\b|\blines\b)\s*L?(\d+)(?:\s*[-–—]\s*L?(\d+))?)?/gi;

function normalisePath(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.\//, '');
}

function evidenceAllows(ref: EvidenceRef, evidence: readonly EvidenceRef[]): boolean {
  const path = normalisePath(ref.path);
  for (const e of evidence) {
    const ep = normalisePath(e.path);
    if (ep !== path && !ep.endsWith('/' + path) && !path.endsWith('/' + ep)) {
      // also allow basename match when unique
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
    // path match without tight line is still allowed for file-level cites
    if (e.startLine === undefined) {
      return true;
    }
  }
  // Exact path present in evidence (any lines)
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

  const matches = [...markdown.matchAll(CITATION_RE)];
  // Process from end to preserve indices
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
