import { sha256 } from '../rag/hash';

/** Stable fingerprint for queries — never store raw query in aggregates. */
export function fingerprintQuery(query: string): string {
  return sha256(query.trim().toLowerCase()).slice(0, 32);
}

/** Stable hash for a workspace-relative path. */
export function hashRelativePath(relPath: string): string {
  return sha256(relPath.replace(/\\/g, '/')).slice(0, 32);
}

/**
 * Assert a diagnostics JSON string does not contain source-like payloads.
 * Throws if chunk-like bodies or common secret patterns appear.
 */
export function assertDiagnosticsSafe(serialised: string): void {
  if (/\"text\"\s*:\s*\"[^\"]{80,}/.test(serialised)) {
    throw new Error('Diagnostics payload must not include long text bodies');
  }
  if (/\"excerpt\"\s*:\s*\"/.test(serialised)) {
    throw new Error('Diagnostics payload must not include excerpts');
  }
  if (/\bsk-[a-zA-Z0-9]{20,}\b/.test(serialised)) {
    throw new Error('Diagnostics payload contained a secret-like key pattern');
  }
}

/** Strip fields that must never leave the machine in analytics exports. */
export function scrubAnalyticsPayload(input: Record<string, unknown>): Record<string, unknown> {
  const blocked = new Set([
    'originalQuery',
    'query',
    'task',
    'prompt',
    'excerpt',
    'text',
    'markdown',
    'workspaceRoot',
    'workspaceFingerprint',
    'fingerprint',
    'missingPath',
    'path',
    'selectedFiles',
  ]);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    if (blocked.has(k)) continue;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      out[k] = scrubAnalyticsPayload(v as Record<string, unknown>);
    } else if (Array.isArray(v)) {
      out[k] = v.map((item) =>
        item && typeof item === 'object'
          ? scrubAnalyticsPayload(item as Record<string, unknown>)
          : item
      );
    } else {
      out[k] = v;
    }
  }
  return out;
}
