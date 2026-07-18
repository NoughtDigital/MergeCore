export type ModelMode = 'deterministic' | 'local' | 'external';
export type ExternalProviderId = 'openai' | 'anthropic';

/** @deprecated Prefer modelMode; kept for migration and diagnostics snapshots. */
export type PrivacyModelProviderId = 'none' | 'ollama' | 'openai' | 'anthropic';

export interface PrivacySettings {
  readonly modelMode: ModelMode;
  readonly externalProvider: ExternalProviderId;
  /** Derived legacy id for older call sites / diagnostics. */
  readonly modelProvider: PrivacyModelProviderId;
  readonly externalRequestsEnabled: boolean;
  readonly anonymiseDiagnostics: boolean;
  readonly usageAnalyticsEnabled: boolean;
  readonly enableModelExplanation: boolean;
  /** Local OpenAI-compatible base URL (typically ends with /v1). */
  readonly localBaseUrl: string;
  readonly localModel: string;
  readonly localTimeoutMs: number;
  readonly localMaxContextTokens: number;
  readonly localSupportsStructuredOutput: boolean;
  readonly localSupportsStreaming: boolean;
  /** Optional local server API key (empty = none). Never required for loopback. */
  readonly localApiKey: string;
  /** @deprecated Use localBaseUrl. */
  readonly ollamaBaseUrl: string;
  /** @deprecated Use localModel. */
  readonly chatModel: string;
  readonly embedModel: string;
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/** True when a URL targets loopback only (local-only). */
export function isLoopbackUrl(raw: string): boolean {
  try {
    const url = new URL(raw.trim().replace(/\/+$/, ''));
    const hostname = url.hostname.replace(/^\[|\]$/g, '');
    return LOCAL_HOSTS.has(url.hostname) || LOCAL_HOSTS.has(hostname);
  } catch {
    return false;
  }
}

/** @deprecated Prefer isLoopbackUrl. */
export const isLoopbackOllamaUrl = isLoopbackUrl;

export function normaliseLocalBaseUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, '');
  if (!trimmed) return 'http://127.0.0.1:11434/v1';
  if (/\/v1$/i.test(trimmed)) return trimmed;
  // Legacy Ollama root → OpenAI-compatible /v1
  if (/^https?:\/\/[^/]+$/i.test(trimmed) || /:11434$/i.test(trimmed)) {
    return `${trimmed}/v1`;
  }
  return trimmed;
}

export function parseModelMode(raw: string | undefined): ModelMode {
  return raw === 'local' || raw === 'external' || raw === 'deterministic'
    ? raw
    : 'deterministic';
}

export function parseExternalProviderId(raw: string | undefined): ExternalProviderId {
  return raw === 'anthropic' ? 'anthropic' : 'openai';
}

export function parseModelProviderId(raw: string | undefined): PrivacyModelProviderId {
  return raw === 'ollama' || raw === 'openai' || raw === 'anthropic' || raw === 'none'
    ? raw
    : 'none';
}

/** Migrate legacy modelProvider into modelMode + externalProvider. */
export function migrateLegacyProvider(input: {
  readonly modelMode?: string;
  readonly modelProvider?: string;
  readonly externalProvider?: string;
}): {
  readonly modelMode: ModelMode;
  readonly externalProvider: ExternalProviderId;
  readonly modelProvider: PrivacyModelProviderId;
} {
  const explicitMode = input.modelMode
    ? parseModelMode(input.modelMode)
    : undefined;
  if (explicitMode) {
    const externalProvider = parseExternalProviderId(input.externalProvider);
    const modelProvider: PrivacyModelProviderId =
      explicitMode === 'deterministic'
        ? 'none'
        : explicitMode === 'local'
          ? 'ollama'
          : externalProvider;
    return { modelMode: explicitMode, externalProvider, modelProvider };
  }

  const legacy = parseModelProviderId(input.modelProvider);
  if (legacy === 'none') {
    return {
      modelMode: 'deterministic',
      externalProvider: 'openai',
      modelProvider: 'none',
    };
  }
  if (legacy === 'ollama') {
    return {
      modelMode: 'local',
      externalProvider: 'openai',
      modelProvider: 'ollama',
    };
  }
  return {
    modelMode: 'external',
    externalProvider: legacy,
    modelProvider: legacy,
  };
}

/** External or non-loopback local HTTP requires the external-requests gate. */
export function providerRequiresExternalRequests(settings: PrivacySettings): boolean {
  if (settings.modelMode === 'external') return true;
  if (settings.modelMode === 'local' && !isLoopbackUrl(settings.localBaseUrl)) {
    return true;
  }
  // Legacy path
  if (settings.modelProvider === 'openai' || settings.modelProvider === 'anthropic') {
    return true;
  }
  if (
    settings.modelProvider === 'ollama' &&
    !isLoopbackUrl(settings.ollamaBaseUrl || settings.localBaseUrl)
  ) {
    return true;
  }
  return false;
}

export function modelModeLabel(settings: PrivacySettings): string {
  if (settings.modelMode === 'deterministic') return 'deterministic only';
  if (settings.modelMode === 'local') {
    return isLoopbackUrl(settings.localBaseUrl)
      ? `local model (${settings.localModel})`
      : `local HTTP model (non-loopback · ${settings.localModel})`;
  }
  return `external ${settings.externalProvider} (BYOK)`;
}
