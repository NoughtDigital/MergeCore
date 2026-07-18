import type { ExplainerPorts } from './explainer';
import type { OllamaClient } from './ollama.client';
import {
  createAnthropicChatPorts,
  createOpenAiChatPorts,
  type ChatPorts,
} from './external-chat-clients';
import { createLocalHttpModelPorts } from './local-http-model.client';
import {
  ModelClientError,
  unavailableModelPorts,
  type ModelPorts,
} from './model-ports';
import type { MergeCoreSecretStore } from '../secret-store';
import {
  providerRequiresExternalRequests,
  type PrivacySettings,
} from '../privacy/privacy-settings-core';
import { PrivacyGateError } from '../privacy/privacy-gate-core';

export interface ModelProviderFactoryDeps {
  readonly secrets: MergeCoreSecretStore;
  /** Kept for embeddings / legacy; chat uses LocalHttpModelClient when mode=local. */
  readonly getOllama: () => OllamaClient;
  readonly getSettings?: () => PrivacySettings;
}

function defaultSettings(): PrivacySettings {
  // Lazy — keeps unit tests vscode-free when getSettings is provided.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { readPrivacySettings } = require('../privacy/privacy-settings') as {
    readPrivacySettings: () => PrivacySettings;
  };
  return readPrivacySettings();
}

function wrapChatPortsAsModelPorts(
  ports: ChatPorts,
  opts: {
    readonly mode: 'external';
    readonly model: string;
    readonly dataRemainsLocal: boolean;
    readonly maxContextTokens: number;
  }
): ModelPorts {
  return {
    mode: opts.mode,
    providerId: ports.providerId,
    model: opts.model,
    dataRemainsLocal: opts.dataRemainsLocal,
    supportsStructuredOutput: false,
    supportsStreaming: false,
    maxContextTokens: opts.maxContextTokens,
    async health(signal) {
      const ok = await ports.isAvailable(signal);
      return ok
        ? { ok: true }
        : { ok: false, reason: 'server_unavailable' };
    },
    async complete(req, signal) {
      const content = await ports.chat(req.messages, signal);
      if (!content) {
        throw new ModelClientError('server_unavailable', 'External chat returned empty');
      }
      return { content };
    },
    chat: (messages, signal) => ports.chat(messages, signal),
    isAvailable: (signal) => ports.isAvailable(signal),
  };
}

/**
 * Resolve active model ports for the configured mode.
 * Never silently falls back from local to an external provider.
 */
export function resolveModelPorts(deps: ModelProviderFactoryDeps): ModelPorts {
  const settings = deps.getSettings?.() ?? defaultSettings();

  if (settings.modelMode === 'deterministic' || settings.modelProvider === 'none') {
    return unavailableModelPorts;
  }

  if (settings.modelMode === 'local' || settings.modelProvider === 'ollama') {
    if (providerRequiresExternalRequests(settings) && !settings.externalRequestsEnabled) {
      return {
        ...unavailableModelPorts,
        mode: 'local',
        providerId: 'local-http',
        model: settings.localModel,
        async health() {
          return { ok: false, reason: 'unauthorised', detail: 'external requests disabled' };
        },
      };
    }
    return createLocalHttpModelPorts({
      baseUrl: settings.localBaseUrl,
      model: settings.localModel,
      timeoutMs: settings.localTimeoutMs,
      maxContextTokens: settings.localMaxContextTokens,
      supportsStructuredOutput: settings.localSupportsStructuredOutput,
      supportsStreaming: settings.localSupportsStreaming,
      apiKey: settings.localApiKey || undefined,
    });
  }

  // external
  if (providerRequiresExternalRequests(settings) && !settings.externalRequestsEnabled) {
    return {
      ...unavailableModelPorts,
      mode: 'external',
      providerId: settings.externalProvider,
      model: settings.externalProvider,
      dataRemainsLocal: false,
    };
  }

  const chat =
    settings.externalProvider === 'anthropic' || settings.modelProvider === 'anthropic'
      ? createAnthropicChatPorts(deps.secrets)
      : createOpenAiChatPorts(deps.secrets);

  return wrapChatPortsAsModelPorts(chat, {
    mode: 'external',
    model: settings.externalProvider === 'anthropic' ? 'claude-3-5-haiku-latest' : 'gpt-4o-mini',
    dataRemainsLocal: false,
    maxContextTokens: settings.localMaxContextTokens,
  });
}

/**
 * Resolve the active chat ports for the configured provider.
 * Never silently falls back from local to an external provider.
 */
export function resolveChatPorts(deps: ModelProviderFactoryDeps): ChatPorts & ExplainerPorts {
  const ports = resolveModelPorts(deps);
  return {
    providerId: ports.providerId,
    chat: (messages, signal) => ports.chat(messages, signal),
    isAvailable: (signal) => ports.isAvailable(signal),
  };
}

/**
 * Whether model enhancement is allowed given privacy settings (not consent).
 * Consent is checked separately at send time.
 */
export function modelEnhancementAllowed(settings?: PrivacySettings): boolean {
  const s = settings ?? defaultSettings();
  if (!s.enableModelExplanation) return false;
  if (s.modelMode === 'deterministic' || s.modelProvider === 'none') return false;
  if (providerRequiresExternalRequests(s) && !s.externalRequestsEnabled) return false;
  return true;
}

export async function assertProviderReadyForSend(
  deps: ModelProviderFactoryDeps,
  settings?: PrivacySettings
): Promise<ChatPorts> {
  const s = settings ?? defaultSettings();
  if (s.modelMode === 'deterministic' || s.modelProvider === 'none') {
    throw new PrivacyGateError('No model provider configured.', 'provider_none');
  }
  if (s.modelMode === 'external' && s.externalProvider === 'openai') {
    if (!(await deps.secrets.hasOpenAiKey())) {
      throw new PrivacyGateError('OpenAI API key is not set in SecretStorage.', 'missing_key');
    }
  }
  if (s.modelMode === 'external' && s.externalProvider === 'anthropic') {
    if (!(await deps.secrets.hasAnthropicKey())) {
      throw new PrivacyGateError('Anthropic API key is not set in SecretStorage.', 'missing_key');
    }
  }
  return resolveChatPorts({ ...deps, getSettings: () => s });
}
