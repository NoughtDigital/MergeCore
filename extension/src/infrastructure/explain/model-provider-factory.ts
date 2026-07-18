import type { ExplainerPorts } from './explainer';
import type { OllamaClient } from './ollama.client';
import {
  createAnthropicChatPorts,
  createOpenAiChatPorts,
  unavailableChatPorts,
  type ChatPorts,
} from './external-chat-clients';
import type { MergeCoreSecretStore } from '../secret-store';
import {
  providerRequiresExternalRequests,
  type PrivacySettings,
} from '../privacy/privacy-settings-core';
import { PrivacyGateError } from '../privacy/privacy-gate-core';

export interface ModelProviderFactoryDeps {
  readonly secrets: MergeCoreSecretStore;
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

/**
 * Resolve the active chat ports for the configured provider.
 * Never silently falls back from local Ollama to an external provider.
 */
export function resolveChatPorts(deps: ModelProviderFactoryDeps): ChatPorts & ExplainerPorts {
  const settings = deps.getSettings?.() ?? defaultSettings();

  if (settings.modelProvider === 'none') {
    return unavailableChatPorts;
  }

  if (settings.modelProvider === 'ollama') {
    const client = deps.getOllama();
    return {
      providerId: 'ollama',
      chat: (messages, signal) => client.chat(messages, signal),
      isAvailable: (signal) => client.isAvailable(signal),
    };
  }

  if (providerRequiresExternalRequests(settings) && !settings.externalRequestsEnabled) {
    return {
      providerId: settings.modelProvider,
      async isAvailable() {
        return false;
      },
      async chat() {
        return undefined;
      },
    };
  }

  if (settings.modelProvider === 'openai') {
    return createOpenAiChatPorts(deps.secrets);
  }
  if (settings.modelProvider === 'anthropic') {
    return createAnthropicChatPorts(deps.secrets);
  }

  return unavailableChatPorts;
}

/**
 * Whether model enhancement is allowed given privacy settings (not consent).
 * Consent is checked separately at send time.
 */
export function modelEnhancementAllowed(settings?: PrivacySettings): boolean {
  const s = settings ?? defaultSettings();
  if (!s.enableModelExplanation) return false;
  if (s.modelProvider === 'none') return false;
  if (providerRequiresExternalRequests(s) && !s.externalRequestsEnabled) return false;
  return true;
}

export async function assertProviderReadyForSend(
  deps: ModelProviderFactoryDeps,
  settings?: PrivacySettings
): Promise<ChatPorts> {
  const s = settings ?? defaultSettings();
  if (s.modelProvider === 'none') {
    throw new PrivacyGateError('No model provider configured.', 'provider_none');
  }
  if (s.modelProvider === 'openai' && !(await deps.secrets.hasOpenAiKey())) {
    throw new PrivacyGateError('OpenAI API key is not set in SecretStorage.', 'missing_key');
  }
  if (s.modelProvider === 'anthropic' && !(await deps.secrets.hasAnthropicKey())) {
    throw new PrivacyGateError('Anthropic API key is not set in SecretStorage.', 'missing_key');
  }
  const ports = resolveChatPorts({ ...deps, getSettings: () => s });
  return ports;
}
