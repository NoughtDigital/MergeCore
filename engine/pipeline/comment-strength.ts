/**
 * Comment strength enforcement — pack-agnostic, persona-agnostic, level-agnostic.
 *
 * The prompt tells the model to produce strong, direct inline comments. This
 * module is the defence-in-depth layer: if a finding's message / why_it_matters
 * / fix_hint still slips through with a softener ("Consider…", "Maybe…") or an
 * empty-verdict phrase ("needs work", bare "refactor this"), we can either
 * flag it or rewrite the opening in place. New packs inherit this automatically
 * — packs never touch inline-comment wording, so nothing here needs to know
 * which pack produced the finding.
 *
 * Kept tiny on purpose: regex-only, no model call, no dependency on the host.
 */
export interface CommentStrengthIssue {
  readonly field: 'message' | 'whyItMatters' | 'fixHint';
  readonly kind: 'hedged-opening' | 'empty-verdict' | 'too-short';
  readonly offending: string;
}

export interface CommentStrengthReport {
  readonly ok: boolean;
  readonly issues: readonly CommentStrengthIssue[];
}

/**
 * Openings that turn a review comment from a decision into a suggestion.
 * Anchored to the start of the trimmed string and case-insensitive; matching
 * inside a sentence is intentionally ignored so we don't false-positive on
 * legitimate prose like "…you should consider the retry budget…".
 */
// Order matters: multi-word hedges must precede their single-word prefixes so
// "Might want to …" is consumed as a phrase, not just "Might".
const HEDGED_OPENINGS: readonly RegExp[] = [
  /^it (?:might|may) be (?:a )?good idea to\b/i,
  /^it (?:might|may) be worth\b/i,
  /^you may (?:want|wish) to\b/i,
  /^might want to\b/i,
  /^think about\b/i,
  /^try to\b/i,
  /^consider\b/i,
  /^maybe\b/i,
  /^might\b/i,
  /^could\b/i,
  /^perhaps\b/i,
  /^possibly\b/i,
];

/**
 * Phrases that describe a feeling, not a decision. Matched anywhere because
 * these destroy the whole sentence even mid-paragraph ("this is a bit messy").
 * Bare "refactor this" is included because it names no target — strong comments
 * must name what to extract / split / remove / rename.
 */
const EMPTY_VERDICTS: readonly RegExp[] = [
  /\bneeds (?:some )?work\b/i,
  /\bnot ideal\b/i,
  /\ba bit (?:messy|ugly|rough|off)\b/i,
  /\bcould be (?:better|cleaner|nicer|improved)\b/i,
  /\bsub[- ]?optimal\b/i,
  /\bcleaner\b(?! (?:than|version|shape|form))/i,
  /\bnicer\b/i,
  /^refactor(?:\s+this)?\.?$/i,
  /^needs (?:a )?refactor\.?$/i,
];

const MIN_MESSAGE_CHARS = 12;

export function auditCommentStrength(finding: {
  readonly message?: string;
  readonly whyItMatters?: string;
  readonly fixHint?: string;
}): CommentStrengthReport {
  const issues: CommentStrengthIssue[] = [];

  auditField('message', finding.message, issues, { enforceMinLength: true });
  auditField('whyItMatters', finding.whyItMatters, issues, { enforceMinLength: false });
  auditField('fixHint', finding.fixHint, issues, { enforceMinLength: false });

  return { ok: issues.length === 0, issues };
}

function auditField(
  field: CommentStrengthIssue['field'],
  raw: string | undefined,
  issues: CommentStrengthIssue[],
  opts: { enforceMinLength: boolean }
): void {
  if (raw === undefined || raw === null) {
    return;
  }
  const value = raw.trim();
  if (value.length === 0) {
    return;
  }

  if (opts.enforceMinLength && value.length < MIN_MESSAGE_CHARS) {
    issues.push({ field, kind: 'too-short', offending: value });
  }

  for (const re of HEDGED_OPENINGS) {
    if (re.test(value)) {
      issues.push({ field, kind: 'hedged-opening', offending: value.slice(0, 80) });
      break;
    }
  }

  for (const re of EMPTY_VERDICTS) {
    if (re.test(value)) {
      issues.push({ field, kind: 'empty-verdict', offending: value.slice(0, 80) });
      break;
    }
  }
}

/**
 * Best-effort rewrite of a single comment field to strip the weakest openings.
 * Only touches the leading hedge so we never rewrite *meaning* — only tone.
 * Empty-verdict and too-short cases are left untouched on purpose: we cannot
 * invent a concrete instruction, so the caller should decide whether to drop
 * the finding or surface the weak wording as-is.
 */
export function stripHedgedOpening(value: string): string {
  const trimmed = value.trimStart();
  for (const re of HEDGED_OPENINGS) {
    if (re.test(trimmed)) {
      const withoutOpener = trimmed.replace(re, '').trimStart();
      if (withoutOpener.length === 0) {
        return trimmed;
      }
      return withoutOpener.charAt(0).toUpperCase() + withoutOpener.slice(1);
    }
  }
  return value;
}
