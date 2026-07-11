/**
 * Lightweight quality gate for hover explanations.
 * Rejects vague LLM output so the template fallback can take over.
 */

const VAGUE: readonly RegExp[] = [
  /\bthis (?:is|looks) (?:fine|good|okay|ok)\b/i,
  /\bbest practices?\b\.?\s*$/i,
  /\bmay (?:cause|lead to) (?:issues?|problems?)\b/i,
  /\bcould be (?:better|improved|cleaner)\b/i,
  /\brefactor (?:this|it)\.?$/i,
  /\bdoes stuff\b/i,
  /\bhandles things\b/i,
];

const MIN_SECTION_CHARS = 24;

const REQUIRED = [
  'Function Summary',
  'Inputs / Outputs',
  'Pros',
  'Cons / Risks',
  'Related Systems',
  'Architectural Context',
] as const;

export interface HoverQualityReport {
  readonly ok: boolean;
  readonly reasons: readonly string[];
}

export function auditHoverExplanation(markdown: string): HoverQualityReport {
  const reasons: string[] = [];
  for (const heading of REQUIRED) {
    if (!markdown.includes(`## ${heading}`)) {
      reasons.push(`missing-section:${heading}`);
    }
  }

  for (const heading of REQUIRED) {
    if (heading === 'Related Systems') {
      continue; // may be sparse until index/related map fills in
    }
    const body = sectionBody(markdown, heading);
    if (body !== undefined && body.length < MIN_SECTION_CHARS) {
      reasons.push(`shallow-section:${heading}`);
    }
  }

  for (const re of VAGUE) {
    if (re.test(markdown)) {
      reasons.push(`vague:${re.source}`);
      break;
    }
  }

  return { ok: reasons.length === 0, reasons };
}

function sectionBody(markdown: string, heading: string): string | undefined {
  const marker = `## ${heading}`;
  const start = markdown.indexOf(marker);
  if (start < 0) {
    return undefined;
  }
  const after = start + marker.length;
  const next = markdown.indexOf('\n## ', after);
  const slice = next < 0 ? markdown.slice(after) : markdown.slice(after, next);
  return slice.replace(/\s+/g, ' ').trim();
}
