/**
 * Host-side mirror of `engine/pipeline/teaching-enforcement.ts`.
 *
 * Kept tiny and duplicated on purpose: the extension must compile without
 * reaching across the repo into the engine's source tree at build time, and
 * the shipped .vsix has to be self-contained. Both files share the same
 * regex tables and documented bar; changes must land in BOTH files and are
 * covered by tests in extension/src/infrastructure/__tests__.
 *
 * Usage:
 *   - The API pipeline runs the authoritative audit before caching and
 *     annotates each finding with `mc_side_effect` when a hidden side effect
 *     signal is present. The host-side guard trusts that annotation.
 *   - When the mock reviewer runs (no API token or useMockReviewer=true),
 *     this module is the ONLY teaching audit in the loop. It also lets the
 *     host display a "Why this is critical" / "Hidden side effects" badge on
 *     any review, whether or not the server ran the audit.
 *   - Pack-agnostic: packs never touch teaching rules, so adding a new pack
 *     requires zero changes in this file.
 */

export type TeachingField = 'whyItMatters' | 'fixHint' | 'message';

export type TeachingIssueKind =
  | 'missing-why'
  | 'shallow-why'
  | 'restates-title'
  | 'unspecified-risk'
  | 'undisclosed-side-effect';

export interface TeachingIssue {
  readonly field: TeachingField;
  readonly kind: TeachingIssueKind;
  readonly offending: string;
}

export interface TeachingReport {
  readonly ok: boolean;
  readonly issues: readonly TeachingIssue[];
  readonly hasSideEffectSignal: boolean;
  /** First signal word that matched, for compact UI labelling. */
  readonly sideEffectSignal?: string;
}

const TEACHING_REQUIRED = new Set(['critical', 'error', 'warning']);

const MIN_WHY_CHARS = 60;

const UNSPECIFIED_RISK: readonly RegExp[] = [
  /\bmay (?:cause|lead to|result in) (?:issues?|problems?|bugs?)\b/i,
  /\bmight (?:cause|lead to|result in) (?:issues?|problems?|bugs?)\b/i,
  /\bcould (?:cause|lead to|result in) (?:issues?|problems?|bugs?)\b/i,
  /\bcan be (?:problematic|risky|bad|tricky)\b/i,
  /\bnot (?:great|good|ideal) practice\b/i,
  /\bbest practices?\b\.?\s*$/i,
];

const SIDE_EFFECT_SIGNALS: readonly RegExp[] = [
  /\bsilently\b/i,
  /\bsilent (?:failure|fallback|swallow|catch)\b/i,
  /\bunder the hood\b/i,
  /\bbehind the scenes\b/i,
  /\bshadow(?:s|ing|ed)?\b/i,
  /\bhidden (?:side effect|mutation|coupling|dependency)s?\b/i,
  /\bimplicit (?:cast|conversion|coercion|mutation|dependency|contract)s?\b/i,
  /\bside[- ]?effect(?:s|ful)?\b/i,
  /\bmutat(?:es|ion|ing) (?:shared|global|external|caller)\b/i,
  /\bswallow(?:s|ed|ing) (?:errors?|exceptions?)\b/i,
  /\bsuppress(?:es|ed|ing) (?:errors?|exceptions?|warnings?)\b/i,
  /\bmonkey[- ]?patch\w*/i,
  /\bnon[- ]?obvious (?:effect|mutation|dependency)s?\b/i,
  /\bunexpected(?:ly)?\b/i,
  /\bgotcha\w*/i,
  /\bleak(?:s|ed|ing) (?:state|memory|secrets?|context)\b/i,
];

const CONCRETE_COSTS: readonly RegExp[] = [
  /\bdata (?:loss|corruption|leak)\b/i,
  /\boutage\b/i,
  /\bincident\b/i,
  /\bexploit\w*/i,
  /\binjection\b/i,
  /\brce\b/i,
  /\brace\b/i,
  /\bdeadlock\b/i,
  /\bn\+1\b/i,
  /\bmemory leak\b/i,
  /\brevert\b/i,
  /\bregression\b/i,
  /\btest gap\b/i,
  /\bonboarding\b/i,
  /\bunreviewable\b/i,
  /\bcognitive load\b/i,
  /\bbreaks? (?:callers?|consumers?|contracts?|invariants?)\b/i,
  /\bwhen (?:the|an?|another|a concurrent|the next)\b/i,
  /\bevery (?:caller|consumer|reader|contributor)\b/i,
];

export interface TeachingAuditInput {
  readonly severity?: string;
  readonly title?: string;
  readonly message?: string;
  readonly whyItMatters?: string;
  readonly fixHint?: string;
  readonly evidenceSnippet?: string;
}

export function auditTeaching(input: TeachingAuditInput): TeachingReport {
  const issues: TeachingIssue[] = [];
  const severity = (input.severity ?? '').toLowerCase();
  const why = (input.whyItMatters ?? '').trim();
  const title = (input.title ?? '').trim();
  const message = (input.message ?? '').trim();
  const proseForSignal = `${title}\n${message}\n${input.evidenceSnippet ?? ''}`;
  const sideEffectSignal = extractSideEffectSignal(proseForSignal);
  const hasSideEffectSignal = sideEffectSignal !== undefined;

  if (why.length === 0) {
    if (TEACHING_REQUIRED.has(severity)) {
      issues.push({ field: 'whyItMatters', kind: 'missing-why', offending: '' });
    }
    return { ok: issues.length === 0, issues, hasSideEffectSignal, sideEffectSignal };
  }

  if (why.length < MIN_WHY_CHARS) {
    issues.push({ field: 'whyItMatters', kind: 'shallow-why', offending: why.slice(0, 120) });
  }
  if (restatesTitle(why, title, message)) {
    issues.push({ field: 'whyItMatters', kind: 'restates-title', offending: why.slice(0, 120) });
  }
  if (matchesAny(why, UNSPECIFIED_RISK)) {
    issues.push({
      field: 'whyItMatters',
      kind: 'unspecified-risk',
      offending: why.slice(0, 120),
    });
  }
  if (hasSideEffectSignal && !matchesAny(why, CONCRETE_COSTS)) {
    issues.push({
      field: 'whyItMatters',
      kind: 'undisclosed-side-effect',
      offending: why.slice(0, 120),
    });
  }

  return { ok: issues.length === 0, issues, hasSideEffectSignal, sideEffectSignal };
}

export function detectSideEffectSignal(prose: string): boolean {
  return matchesAny(prose, SIDE_EFFECT_SIGNALS);
}

export function extractSideEffectSignal(prose: string): string | undefined {
  for (const re of SIDE_EFFECT_SIGNALS) {
    const match = prose.match(re);
    if (match && match[0]) {
      return match[0].trim().toLowerCase();
    }
  }
  return undefined;
}

function matchesAny(value: string, patterns: readonly RegExp[]): boolean {
  for (const re of patterns) {
    if (re.test(value)) {
      return true;
    }
  }
  return false;
}

function restatesTitle(why: string, title: string, message: string): boolean {
  const whyN = normaliseForCompare(why);
  if (whyN.length === 0) {
    return false;
  }
  const titleN = normaliseForCompare(title);
  const messageN = normaliseForCompare(message);
  if (titleN.length > 0 && (whyN === titleN || titleN.includes(whyN) || whyN.includes(titleN))) {
    return whyN.length < titleN.length + 40;
  }
  if (messageN.length > 0 && whyN === messageN) {
    return true;
  }
  return false;
}

function normaliseForCompare(v: string): string {
  return v
    .toLowerCase()
    .replace(/[\s.,;:!?"'`()\[\]]+/g, ' ')
    .trim();
}
