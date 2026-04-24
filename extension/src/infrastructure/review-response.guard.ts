import type {
  CrossFileImpact,
  Finding,
  ReviewResult,
  RewriteAmend,
  Severity,
} from '../domain/review-types';
import { auditTeaching } from './teaching-audit';

const SEVERITIES: readonly Severity[] = ['critical', 'error', 'warning', 'info', 'hint'];

/**
 * Human-friendly lines shown under a finding whose teaching audit failed.
 * Kept neutral on purpose: the goal is to tell the user "the reviewer did
 * not teach you anything reusable here" without piling a second critical
 * on top of the first. Ordered by specificity — first matching wins.
 */
function describeTeachingGap(kinds: readonly string[]): string | undefined {
  if (kinds.includes('missing-why')) {
    return 'The reviewer did not explain why this matters. Treat the flag as a prompt to investigate, not a verdict.';
  }
  if (kinds.includes('undisclosed-side-effect')) {
    return 'A hidden side effect was flagged but not explained in full. Read the snippet carefully before acting.';
  }
  if (kinds.includes('restates-title')) {
    return 'The explanation here restates the headline. There may be more context the reviewer did not make explicit.';
  }
  if (kinds.includes('unspecified-risk')) {
    return 'The risk is described in vague terms. Confirm the concrete cost before you merge.';
  }
  if (kinds.includes('shallow-why')) {
    return 'The explanation is very short. Consider digging into the snippet rather than relying on the line alone.';
  }
  return undefined;
}

export class ReviewResponseError extends Error {
  constructor(message: string, readonly context?: string) {
    super(message);
    this.name = 'ReviewResponseError';
  }
}

/**
 * Runtime guard for API responses. The webview is shielded by textContent, but
 * a hostile or misbehaving API could still poison session state, score bands
 * or apply-code payloads. Validate the wire shape before trusting it.
 */
export function parseReviewResult(input: unknown): ReviewResult {
  if (!isObject(input)) {
    throw new ReviewResponseError('Response body is not an object.');
  }

  const findings = parseFindings(input.findings);
  const score = parseScore(input.score);
  const summary = optionalString(input.summary, 'summary');
  const improvedCode = optionalString(input.improvedCode, 'improvedCode', 200_000);
  const rewriteSummary = optionalString(input.rewriteSummary, 'rewriteSummary');
  const rewriteAmends = parseAmends(input.rewriteAmends);
  const crossFileImpacts = parseCrossFiles(input.crossFileImpacts);
  const patch = optionalString(input.patch, 'patch', 400_000);

  return {
    findings,
    score,
    summary,
    improvedCode,
    rewriteSummary,
    rewriteAmends,
    crossFileImpacts,
    patch,
  };
}

function parseFindings(raw: unknown): readonly Finding[] {
  if (raw === undefined || raw === null) {
    return [];
  }
  if (!Array.isArray(raw)) {
    throw new ReviewResponseError('findings must be an array.');
  }
  if (raw.length > 200) {
    throw new ReviewResponseError('findings array is larger than 200 entries.');
  }
  const out: Finding[] = [];
  raw.forEach((f, i) => out.push(parseFinding(f, i)));
  return out;
}

function parseFinding(raw: unknown, index: number): Finding {
  if (!isObject(raw)) {
    throw new ReviewResponseError(`findings[${index}] is not an object.`);
  }
  const severity = normaliseSeverity(raw.severity);
  const id = requireString(raw.id, `findings[${index}].id`, 200);
  const message = requireString(raw.message, `findings[${index}].message`, 2000);
  const whyItMatters = optionalString(
    raw.whyItMatters,
    `findings[${index}].whyItMatters`,
    4000
  );
  const fixHint = optionalString(raw.fixHint, `findings[${index}].fixHint`, 4000);
  const category = optionalString(raw.category, `findings[${index}].category`, 200);

  // Prefer the server-provided annotation. When the API pipeline ran the
  // teaching-enforcement pass, findings arrive tagged with a short signal
  // like "silently" or "implicit cast" that drives the "Hidden side effect"
  // badge. When the server did not tag it (older API, or mock path), we run
  // the host audit so the badge and teaching gap are never silently lost.
  //
  // Accept both camelCase (host style) and snake_case (wire style) to keep
  // this forgiving during API rollout without widening the Finding schema.
  const rawEvidence = isObject(raw.evidence) ? raw.evidence : undefined;
  const evidenceSnippet =
    rawEvidence && typeof rawEvidence.snippet === 'string' ? rawEvidence.snippet : undefined;
  const serverSideEffectSignal =
    optionalString(raw.sideEffectSignal, `findings[${index}].sideEffectSignal`, 200) ??
    optionalString(raw.mc_side_effect, `findings[${index}].mc_side_effect`, 200);

  const audit = auditTeaching({
    severity,
    title: optionalString(raw.title, `findings[${index}].title`, 400) ?? message,
    message,
    whyItMatters,
    fixHint,
    evidenceSnippet,
  });

  const sideEffectSignal = serverSideEffectSignal ?? audit.sideEffectSignal;
  const teachingGap = audit.ok
    ? undefined
    : describeTeachingGap(audit.issues.map((i) => i.kind));

  return {
    id,
    severity,
    message,
    whyItMatters,
    fixHint,
    file: optionalString(raw.file, `findings[${index}].file`, 2048),
    line: optionalFiniteNumber(raw.line, `findings[${index}].line`, 0, 1_000_000),
    column: optionalFiniteNumber(raw.column, `findings[${index}].column`, 0, 100_000),
    category,
    code: optionalString(raw.code, `findings[${index}].code`, 200),
    sideEffectSignal,
    teachingGap,
  };
}

function parseAmends(raw: unknown): readonly RewriteAmend[] | undefined {
  if (raw === undefined || raw === null) {
    return undefined;
  }
  if (!Array.isArray(raw)) {
    throw new ReviewResponseError('rewriteAmends must be an array.');
  }
  if (raw.length > 200) {
    throw new ReviewResponseError('rewriteAmends array is larger than 200 entries.');
  }
  return raw.map((a, i) => {
    if (!isObject(a)) {
      throw new ReviewResponseError(`rewriteAmends[${i}] is not an object.`);
    }
    return {
      startLine: requireFiniteNumber(a.startLine, `rewriteAmends[${i}].startLine`, 0, 1_000_000),
      endLine: requireFiniteNumber(a.endLine, `rewriteAmends[${i}].endLine`, 0, 1_000_000),
      label: optionalString(a.label, `rewriteAmends[${i}].label`, 200),
      rationale: requireString(a.rationale, `rewriteAmends[${i}].rationale`, 4000),
    };
  });
}

function parseCrossFiles(raw: unknown): readonly CrossFileImpact[] | undefined {
  if (raw === undefined || raw === null) {
    return undefined;
  }
  if (!Array.isArray(raw)) {
    throw new ReviewResponseError('crossFileImpacts must be an array.');
  }
  if (raw.length > 50) {
    throw new ReviewResponseError('crossFileImpacts array is larger than 50 entries.');
  }
  return raw.map((c, i) => {
    if (!isObject(c)) {
      throw new ReviewResponseError(`crossFileImpacts[${i}] is not an object.`);
    }
    return {
      path: requireString(c.path, `crossFileImpacts[${i}].path`, 2048),
      rationale: requireString(c.rationale, `crossFileImpacts[${i}].rationale`, 4000),
      suggestedChange: optionalString(
        c.suggestedChange,
        `crossFileImpacts[${i}].suggestedChange`,
        20_000
      ),
    };
  });
}

function parseScore(raw: unknown): number {
  if (raw === undefined || raw === null) {
    return 0;
  }
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    throw new ReviewResponseError('score must be a finite number.');
  }
  if (raw < 0 || raw > 10) {
    throw new ReviewResponseError(`score must be in [0, 10] (got ${raw}).`);
  }
  return Math.round(raw * 100) / 100;
}

function normaliseSeverity(raw: unknown): Severity {
  if (typeof raw !== 'string') {
    throw new ReviewResponseError('finding.severity must be a string.');
  }
  const v = raw.toLowerCase();
  if (!(SEVERITIES as readonly string[]).includes(v)) {
    throw new ReviewResponseError(`unknown severity "${raw}".`);
  }
  return v as Severity;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function requireString(v: unknown, name: string, max: number = 10_000): string {
  if (typeof v !== 'string') {
    throw new ReviewResponseError(`${name} is required.`);
  }
  if (v.length > max) {
    throw new ReviewResponseError(`${name} exceeds ${max} characters.`);
  }
  return v;
}

function optionalString(v: unknown, name: string, max: number = 10_000): string | undefined {
  if (v === undefined || v === null) {
    return undefined;
  }
  if (typeof v !== 'string') {
    throw new ReviewResponseError(`${name} must be a string.`);
  }
  if (v.length > max) {
    throw new ReviewResponseError(`${name} exceeds ${max} characters.`);
  }
  return v;
}

function requireFiniteNumber(v: unknown, name: string, min: number, max: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new ReviewResponseError(`${name} must be a finite number.`);
  }
  if (v < min || v > max) {
    throw new ReviewResponseError(`${name} must be within [${min}, ${max}].`);
  }
  return v;
}

function optionalFiniteNumber(
  v: unknown,
  name: string,
  min: number,
  max: number
): number | undefined {
  if (v === undefined || v === null) {
    return undefined;
  }
  return requireFiniteNumber(v, name, min, max);
}
