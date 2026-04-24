/**
 * "Explain Why" (Critical) enforcement — pack-agnostic, persona-agnostic, level-agnostic.
 *
 * Principle: every criticism should teach. A finding that labels a problem without
 * explaining WHY it is a problem (and what silently breaks if it ships) leaves the
 * reader with nothing to internalise. That hurts onboarding, makes bugs harder to
 * anticipate, and turns review into gate-keeping instead of mentorship.
 *
 * This module is the defence-in-depth layer to the prompt rules: the prompt tells
 * the model "teach, name hidden side effects"; this module verifies the output and
 * annotates weak findings so the host UI can escalate or suppress them.
 *
 * Pack inheritance:
 *   - New packs NEVER touch inline-comment wording or why_it_matters requirements.
 *   - The registry / rubric layer stays concerned with rule content only.
 *   - Teaching expectations live here, so every future pack inherits the same bar
 *     without a migration and without any per-pack opt-in.
 *
 * Kept regex-only, no model calls, no cross-package imports.
 */

import type { CommentStrengthIssue } from './comment-strength.js';

export type TeachingField = 'whyItMatters' | 'fixHint' | 'message';

export type TeachingIssueKind =
  /** critical/error/warning finding with no whyItMatters at all. */
  | 'missing-why'
  /** whyItMatters exists but is too short to teach anything. */
  | 'shallow-why'
  /** whyItMatters only restates the title/message — teaches nothing. */
  | 'restates-title'
  /** whyItMatters hedges the risk ("might cause issues") without naming the cost. */
  | 'unspecified-risk'
  /**
   * Finding hints at a hidden side effect ("silently", "unexpected", "implicit",
   * "shadow", "under the hood", "behind the scenes") but whyItMatters does not
   * describe the concrete side effect the reader should expect.
   */
  | 'undisclosed-side-effect';

export interface TeachingIssue {
  readonly field: TeachingField;
  readonly kind: TeachingIssueKind;
  readonly offending: string;
}

export interface TeachingReport {
  readonly ok: boolean;
  readonly issues: readonly TeachingIssue[];
  /**
   * Set when the finding's prose (title, message or evidence) suggests a hidden
   * side effect. Host UIs use this to render a dedicated "Hidden side effects"
   * line so readers cannot miss it during review.
   */
  readonly hasSideEffectSignal: boolean;
}

type NormalisedSeverity = 'critical' | 'error' | 'warning' | 'info' | 'hint';

const TEACHING_REQUIRED: ReadonlySet<NormalisedSeverity> = new Set([
  'critical',
  'error',
  'warning',
]);

const MIN_WHY_CHARS = 60;

/**
 * Hedges that look like a risk statement but describe nothing concrete.
 * Distinct from comment-strength empty verdicts: those are tone. These are
 * specifically weak risk framings inside why_it_matters.
 */
const UNSPECIFIED_RISK: readonly RegExp[] = [
  /\bmay (?:cause|lead to|result in) (?:issues?|problems?|bugs?)\b/i,
  /\bmight (?:cause|lead to|result in) (?:issues?|problems?|bugs?)\b/i,
  /\bcould (?:cause|lead to|result in) (?:issues?|problems?|bugs?)\b/i,
  /\bcan be (?:problematic|risky|bad|tricky)\b/i,
  /\bnot (?:great|good|ideal) practice\b/i,
  /\bbest practices?\b\.?\s*$/i,
];

/**
 * Words and phrases that signal a HIDDEN side effect — the kind that make
 * onboarding harder because the visible code under-describes what the runtime
 * actually does. When any of these appear in the title/message/evidence, the
 * finding MUST explain the side effect concretely in why_it_matters.
 */
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

/**
 * Concrete cost phrases a teaching why_it_matters should use. We look for at
 * least one when a side effect is signalled — otherwise the "why" is narration
 * rather than a teachable cost.
 */
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
  /**
   * Optional comment-strength issues already detected for the same finding.
   * When the comment-strength layer already flagged the message, we skip
   * duplicate "shallow" reporting on the message field here so hosts only
   * display one reason per field.
   */
  readonly commentStrengthIssues?: readonly CommentStrengthIssue[];
}

/**
 * Audits a single finding against the teaching bar.
 *
 * Rules:
 *   1. If severity is critical/error/warning, whyItMatters is REQUIRED.
 *   2. whyItMatters must be substantive (>= MIN_WHY_CHARS chars after trim).
 *   3. whyItMatters must not be a near-duplicate of title/message.
 *   4. whyItMatters must not hedge the risk with "may cause issues"-style phrases.
 *   5. If any side-effect signal appears in title/message/evidence, whyItMatters
 *      must describe a concrete cost (see CONCRETE_COSTS), else we flag
 *      undisclosed-side-effect.
 *
 * info/hint severities get the same audit if a whyItMatters is present, but
 * missing-why is not reported for them — low-severity hints are allowed to be
 * terse observations.
 */
export function auditTeaching(input: TeachingAuditInput): TeachingReport {
  const issues: TeachingIssue[] = [];
  const severity = normaliseSeverity(input.severity);
  const why = (input.whyItMatters ?? '').trim();
  const title = (input.title ?? '').trim();
  const message = (input.message ?? '').trim();

  const hasSideEffectSignal = detectSideEffectSignal(
    `${title}\n${message}\n${input.evidenceSnippet ?? ''}`
  );

  if (why.length === 0) {
    if (TEACHING_REQUIRED.has(severity)) {
      issues.push({
        field: 'whyItMatters',
        kind: 'missing-why',
        offending: '',
      });
    }
    return { ok: issues.length === 0, issues, hasSideEffectSignal };
  }

  if (why.length < MIN_WHY_CHARS) {
    issues.push({
      field: 'whyItMatters',
      kind: 'shallow-why',
      offending: why.slice(0, 120),
    });
  }

  if (restatesTitle(why, title, message)) {
    issues.push({
      field: 'whyItMatters',
      kind: 'restates-title',
      offending: why.slice(0, 120),
    });
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

  return { ok: issues.length === 0, issues, hasSideEffectSignal };
}

/**
 * Scans prose for any hidden-side-effect signal. Exported so the host UI can
 * decide, independently of the audit outcome, whether to render a dedicated
 * "Hidden side effects" line on a finding.
 */
export function detectSideEffectSignal(prose: string): boolean {
  return matchesAny(prose, SIDE_EFFECT_SIGNALS);
}

/**
 * Extracts a single, short side-effect phrase from the finding's prose so the
 * UI can label exactly WHICH signal fired. Returns undefined when no signal
 * is present. Multiple matches collapse to the first one so the label stays
 * compact; the full teaching explanation still lives in whyItMatters.
 */
export function extractSideEffectSignal(prose: string): string | undefined {
  for (const re of SIDE_EFFECT_SIGNALS) {
    const match = prose.match(re);
    if (match && match[0]) {
      return match[0].trim().toLowerCase();
    }
  }
  return undefined;
}

function normaliseSeverity(raw: string | undefined): NormalisedSeverity {
  if (typeof raw !== 'string') {
    return 'info';
  }
  const v = raw.toLowerCase();
  if (v === 'critical' || v === 'error' || v === 'warning' || v === 'info' || v === 'hint') {
    return v;
  }
  return 'info';
}

function matchesAny(value: string, patterns: readonly RegExp[]): boolean {
  for (const re of patterns) {
    if (re.test(value)) {
      return true;
    }
  }
  return false;
}

/**
 * Catches the most common copy-paste failure: whyItMatters that is just the
 * title with a full stop, or a substring of the message. Uses normalised
 * whitespace + lowercase compare so punctuation differences don't hide it.
 */
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
