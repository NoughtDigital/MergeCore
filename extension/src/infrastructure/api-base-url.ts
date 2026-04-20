export interface ApiBaseUrlValidation {
  readonly ok: boolean;
  readonly url?: URL;
  readonly reason?: string;
  /** Non-fatal advisory the caller should log (e.g. plaintext HTTP on localhost). */
  readonly warning?: string;
}

const DEFAULT_PLACEHOLDER = 'https://api.mergecore.example';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

/**
 * Parse and vet an API base URL. We require `https://` for any non-local host
 * so a hostile `settings.json` or Settings Sync churn cannot redirect the
 * bearer token to an attacker-controlled origin over cleartext.
 */
export function validateApiBaseUrl(raw: string, allowInsecureLocal: boolean): ApiBaseUrlValidation {
  const trimmed = (raw ?? '').trim().replace(/\/+$/, '');
  if (trimmed.length === 0) {
    return { ok: false, reason: 'API base URL is not configured.' };
  }
  if (trimmed === DEFAULT_PLACEHOLDER) {
    return {
      ok: false,
      reason: 'API base URL is still the example placeholder. Set mergecore.apiBaseUrl.',
    };
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { ok: false, reason: 'API base URL is not a valid URL.' };
  }

  const isLocal = LOCAL_HOSTS.has(url.hostname);

  if (url.protocol === 'https:') {
    return { ok: true, url };
  }

  if (url.protocol === 'http:' && isLocal && allowInsecureLocal) {
    return {
      ok: true,
      url,
      warning: `Using plaintext HTTP for a local API base URL (${url.origin}). This is only safe for development.`,
    };
  }

  if (url.protocol === 'http:' && isLocal) {
    return {
      ok: false,
      reason:
        'API base URL is plaintext HTTP. Enable mergecore.allowInsecureLocalApi to use it (local dev only).',
    };
  }

  return {
    ok: false,
    reason: `API base URL must use https:// (got ${url.protocol}//${url.hostname}).`,
  };
}

/**
 * Hash of the URL origin, surfaced to the user the first time they point the
 * extension at a non-default host. The confirmation gate prevents silent
 * exfiltration after a settings-sync or worktree-specific override.
 */
export function describeOriginForPrompt(url: URL): string {
  return `${url.protocol}//${url.host}`;
}
