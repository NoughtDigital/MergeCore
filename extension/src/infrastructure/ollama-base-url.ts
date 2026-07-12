export interface OllamaBaseUrlValidation {
  readonly ok: boolean;
  readonly url?: URL;
  readonly reason?: string;
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/**
 * Parse and vet the local Ollama base URL. Unlike the MergeCore API adapter,
 * local AI is expected to speak HTTP on loopback — but a hostile workspace
 * settings.json must not be able to redirect hover/index payloads to an
 * attacker-controlled remote origin over cleartext.
 *
 * Rules:
 * - `http://` only for localhost / 127.0.0.1 / ::1
 * - `https://` allowed for any host (self-hosted reverse proxies)
 * - empty / unparseable / non-http(s) rejected
 */
export function validateOllamaBaseUrl(raw: string): OllamaBaseUrlValidation {
  const trimmed = (raw ?? '').trim().replace(/\/+$/, '');
  if (trimmed.length === 0) {
    return { ok: false, reason: 'Ollama base URL is not configured.' };
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { ok: false, reason: 'Ollama base URL is not a valid URL.' };
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  const isLocal = LOCAL_HOSTS.has(url.hostname) || LOCAL_HOSTS.has(hostname);

  if (url.protocol === 'https:') {
    return { ok: true, url };
  }

  if (url.protocol === 'http:' && isLocal) {
    return { ok: true, url };
  }

  if (url.protocol === 'http:') {
    return {
      ok: false,
      reason: `Ollama base URL must use https:// for non-local hosts (got ${url.protocol}//${url.hostname}).`,
    };
  }

  return {
    ok: false,
    reason: `Ollama base URL must use http:// or https:// (got ${url.protocol}).`,
  };
}
