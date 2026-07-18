import * as vscode from 'vscode';
import {
  migrateLegacyProvider,
  normaliseLocalBaseUrl,
  parseExternalProviderId,
  type ExternalProviderId,
  type ModelMode,
  type PrivacyModelProviderId,
  type PrivacySettings,
} from './privacy-settings-core';

export type {
  ExternalProviderId,
  ModelMode,
  PrivacyModelProviderId,
  PrivacySettings,
} from './privacy-settings-core';
export {
  isLoopbackOllamaUrl,
  isLoopbackUrl,
  migrateLegacyProvider,
  modelModeLabel,
  normaliseLocalBaseUrl,
  parseExternalProviderId,
  parseModelMode,
  parseModelProviderId,
  providerRequiresExternalRequests,
} from './privacy-settings-core';

export function readPrivacySettings(): PrivacySettings {
  const cfg = vscode.workspace.getConfiguration('mergecore');
  const migrated = migrateLegacyProvider({
    modelMode: cfg.get<string>('privacy.modelMode'),
    modelProvider: cfg.get<string>('privacy.modelProvider', 'none'),
    externalProvider: cfg.get<string>('privacy.externalProvider'),
  });

  const legacyBase =
    cfg.get<string>('local.baseUrl') ??
    cfg.get<string>('local.ollamaBaseUrl') ??
    'http://127.0.0.1:11434/v1';
  const localBaseUrl = normaliseLocalBaseUrl(legacyBase);
  const localModel =
    cfg.get<string>('local.model') ??
    cfg.get<string>('local.chatModel') ??
    'llama3.2';

  return {
    modelMode: migrated.modelMode,
    externalProvider: migrated.externalProvider,
    modelProvider: migrated.modelProvider,
    externalRequestsEnabled: cfg.get<boolean>('privacy.externalRequestsEnabled', false) === true,
    anonymiseDiagnostics: cfg.get<boolean>('privacy.anonymiseDiagnostics', false) === true,
    usageAnalyticsEnabled: cfg.get<boolean>('privacy.usageAnalyticsEnabled', false) === true,
    enableModelExplanation: cfg.get<boolean>('hover.enableModelExplanation', false) === true,
    localBaseUrl,
    localModel,
    localTimeoutMs: Math.max(1_000, cfg.get<number>('local.timeoutMs', 45_000) ?? 45_000),
    localMaxContextTokens: Math.max(
      512,
      cfg.get<number>('local.maxContextTokens', 8192) ?? 8192
    ),
    localSupportsStructuredOutput:
      cfg.get<boolean>('local.supportsStructuredOutput', true) !== false,
    localSupportsStreaming: cfg.get<boolean>('local.supportsStreaming', true) !== false,
    localApiKey: (cfg.get<string>('local.apiKey', '') ?? '').trim(),
    ollamaBaseUrl: localBaseUrl.replace(/\/v1$/i, '') || localBaseUrl,
    chatModel: localModel,
    embedModel: cfg.get<string>('local.embedModel', 'nomic-embed-text') ?? 'nomic-embed-text',
  };
}

export async function setExternalRequestsEnabled(enabled: boolean): Promise<void> {
  await vscode.workspace
    .getConfiguration('mergecore')
    .update('privacy.externalRequestsEnabled', enabled, vscode.ConfigurationTarget.Global);
}

export async function setUsageAnalyticsEnabled(enabled: boolean): Promise<void> {
  await vscode.workspace
    .getConfiguration('mergecore')
    .update('privacy.usageAnalyticsEnabled', enabled, vscode.ConfigurationTarget.Global);
}

export async function setModelMode(mode: ModelMode): Promise<void> {
  const cfg = vscode.workspace.getConfiguration('mergecore');
  await cfg.update('privacy.modelMode', mode, vscode.ConfigurationTarget.Global);
  const legacy: PrivacyModelProviderId =
    mode === 'deterministic' ? 'none' : mode === 'local' ? 'ollama' : 'openai';
  await cfg.update('privacy.modelProvider', legacy, vscode.ConfigurationTarget.Global);
}

export async function setExternalProvider(provider: ExternalProviderId): Promise<void> {
  const cfg = vscode.workspace.getConfiguration('mergecore');
  await cfg.update('privacy.externalProvider', provider, vscode.ConfigurationTarget.Global);
  await cfg.update('privacy.modelProvider', provider, vscode.ConfigurationTarget.Global);
  await cfg.update('privacy.modelMode', 'external', vscode.ConfigurationTarget.Global);
}

/** @deprecated Prefer setModelMode / setExternalProvider. */
export async function setModelProvider(provider: PrivacyModelProviderId): Promise<void> {
  const migrated = migrateLegacyProvider({ modelProvider: provider });
  await setModelMode(migrated.modelMode);
  if (migrated.modelMode === 'external') {
    await setExternalProvider(parseExternalProviderId(migrated.externalProvider));
  }
}
