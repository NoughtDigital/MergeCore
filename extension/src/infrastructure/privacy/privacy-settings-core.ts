export type PrivacyModelProviderId = 'none' | 'ollama' | 'openai' | 'anthropic';

export interface PrivacySettings {
  readonly externalRequestsEnabled: boolean;
  readonly modelProvider: PrivacyModelProviderId;
  readonly anonymiseDiagnostics: boolean;
  readonly usageAnalyticsEnabled: boolean;
  readonly enableModelExplanation: boolean;
  readonly ollamaBaseUrl: string;
  readonly chatModel: string;
  readonly embedModel: string;
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/** True when the Ollama URL targets loopback only (local-only). */
export function isLoopbackOllamaUrl(raw: string): boolean {
  try {
    const url = new URL(raw.trim().replace(/\/+$/, ''));
    const hostname = url.hostname.replace(/^\[|\]$/g, '');
    return LOCAL_HOSTS.has(url.hostname) || LOCAL_HOSTS.has(hostname);
  } catch {
    return false;
  }
}

/** External model path: openai/anthropic, or ollama pointed at a non-loopback host. */
export function providerRequiresExternalRequests(settings: PrivacySettings): boolean {
  if (settings.modelProvider === 'openai' || settings.modelProvider === 'anthropic') {
    return true;
  }
  if (settings.modelProvider === 'ollama' && !isLoopbackOllamaUrl(settings.ollamaBaseUrl)) {
    return true;
  }
  return false;
}

export function parseModelProviderId(raw: string | undefined): PrivacyModelProviderId {
  return raw === 'ollama' || raw === 'openai' || raw === 'anthropic' || raw === 'none'
    ? raw
    : 'none';
}
