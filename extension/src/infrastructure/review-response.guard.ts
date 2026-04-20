import type {
  CrossFileImpact,
  Finding,
  ReviewResult,
  RewriteAmend,
  Severity,
} from '../domain/review-types';

const SEVERITIES: readonly Severity[] = ['critical', 'error', 'warning', 'info', 'hint'];

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
  return {
    id,
    severity,
    message,
    whyItMatters: optionalString(raw.whyItMatters, `findings[${index}].whyItMatters`, 4000),
    fixHint: optionalString(raw.fixHint, `findings[${index}].fixHint`, 4000),
    file: optionalString(raw.file, `findings[${index}].file`, 2048),
    line: optionalFiniteNumber(raw.line, `findings[${index}].line`, 0, 1_000_000),
    column: optionalFiniteNumber(raw.column, `findings[${index}].column`, 0, 100_000),
    category: optionalString(raw.category, `findings[${index}].category`, 200),
    code: optionalString(raw.code, `findings[${index}].code`, 200),
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
