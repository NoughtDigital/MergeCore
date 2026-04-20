/**
 * Best-effort client-side secret detection run before any code or diff is
 * uploaded. Patterns here are intentionally conservative: false positives cost
 * a UX nudge, false negatives cost a credential leak, so the bar favours
 * blocking/redacting anything that looks like a key.
 *
 * This is a second line of defence; the API is still expected to reject or
 * scrub secrets server-side.
 */

export interface SecretHit {
  readonly rule: string;
  readonly start: number;
  readonly end: number;
  readonly preview: string;
}

export interface ScrubResult {
  readonly hits: readonly SecretHit[];
  readonly redacted: string;
}

type Rule = { readonly id: string; readonly pattern: RegExp };

const RULES: readonly Rule[] = [
  { id: 'aws-access-key-id', pattern: /\b(AKIA|ASIA|ABIA|ACCA)[0-9A-Z]{16}\b/g },
  {
    id: 'aws-secret-access-key',
    pattern: /\baws(.{0,20})?(secret|access)[-_ ]?key[-_ ]?(id)?['"\s:=]{1,3}[0-9a-zA-Z/+]{40}\b/gi,
  },
  { id: 'google-api-key', pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { id: 'slack-token', pattern: /\bxox[abprs]-[0-9A-Za-z-]{10,48}\b/g },
  { id: 'github-token', pattern: /\b(ghp|gho|ghu|ghs|ghr)_[0-9A-Za-z]{30,}\b/g },
  { id: 'github-oauth', pattern: /\bgithub_pat_[0-9A-Za-z_]{20,}\b/g },
  { id: 'gitlab-pat', pattern: /\bglpat-[0-9A-Za-z_-]{20,}\b/g },
  { id: 'openai-key', pattern: /\bsk-[A-Za-z0-9]{20}(?:T3BlbkFJ)?[A-Za-z0-9]{20,}\b/g },
  { id: 'anthropic-key', pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g },
  { id: 'stripe-live', pattern: /\b(sk|rk|pk)_live_[0-9a-zA-Z]{24,}\b/g },
  { id: 'stripe-restricted', pattern: /\brk_(live|test)_[0-9a-zA-Z]{24,}\b/g },
  { id: 'private-key-pem', pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY-----/g },
  { id: 'jwt-token', pattern: /\bey[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g },
  {
    id: 'generic-assignment',
    pattern:
      /\b(password|passwd|pwd|api[_-]?key|apikey|secret|token|access[_-]?key)\s*[:=]\s*['"][^'"\s]{12,}['"]/gi,
  },
];

export function scanForSecrets(source: string): readonly SecretHit[] {
  if (typeof source !== 'string' || source.length === 0) {
    return [];
  }

  const hits: SecretHit[] = [];
  for (const rule of RULES) {
    const re = new RegExp(rule.pattern.source, rule.pattern.flags);
    let m: RegExpExecArray | null;
    while ((m = re.exec(source)) !== null) {
      const start = m.index;
      const end = m.index + m[0].length;
      hits.push({
        rule: rule.id,
        start,
        end,
        preview: previewFor(m[0]),
      });
      if (m[0].length === 0) {
        re.lastIndex++;
      }
    }
  }

  hits.sort((a, b) => a.start - b.start);
  return hits;
}

export function redactSecrets(source: string, hits: readonly SecretHit[]): string {
  if (hits.length === 0) {
    return source;
  }
  const out: string[] = [];
  let cursor = 0;
  for (const hit of hits) {
    if (hit.start < cursor) {
      continue;
    }
    out.push(source.slice(cursor, hit.start));
    out.push(`<REDACTED:${hit.rule}>`);
    cursor = hit.end;
  }
  out.push(source.slice(cursor));
  return out.join('');
}

export function scrub(source: string): ScrubResult {
  const hits = scanForSecrets(source);
  const redacted = redactSecrets(source, hits);
  return { hits, redacted };
}

function previewFor(match: string): string {
  const condensed = match.replace(/\s+/g, ' ').trim();
  if (condensed.length <= 12) {
    return `${condensed.slice(0, 4)}…`;
  }
  return `${condensed.slice(0, 4)}…${condensed.slice(-2)}`;
}
