import * as vscode from 'vscode';
import {
  parseModelProviderId,
  type PrivacyModelProviderId,
  type PrivacySettings,
} from './privacy-settings-core';

export type { PrivacyModelProviderId, PrivacySettings } from './privacy-settings-core';
export {
  isLoopbackOllamaUrl,
  providerRequiresExternalRequests,
} from './privacy-settings-core';

export function readPrivacySettings(): PrivacySettings {
  const cfg = vscode.workspace.getConfiguration('mergecore');
  return {
    externalRequestsEnabled: cfg.get<boolean>('privacy.externalRequestsEnabled', false) === true,
    modelProvider: parseModelProviderId(cfg.get<string>('privacy.modelProvider', 'none')),
    anonymiseDiagnostics: cfg.get<boolean>('privacy.anonymiseDiagnostics', false) === true,
    enableModelExplanation: cfg.get<boolean>('hover.enableModelExplanation', false) === true,
    ollamaBaseUrl:
      cfg.get<string>('local.ollamaBaseUrl', 'http://127.0.0.1:11434') ??
      'http://127.0.0.1:11434',
    chatModel: cfg.get<string>('local.chatModel', 'llama3.2') ?? 'llama3.2',
    embedModel: cfg.get<string>('local.embedModel', 'nomic-embed-text') ?? 'nomic-embed-text',
  };
}

export async function setExternalRequestsEnabled(enabled: boolean): Promise<void> {
  await vscode.workspace
    .getConfiguration('mergecore')
    .update('privacy.externalRequestsEnabled', enabled, vscode.ConfigurationTarget.Global);
}

export async function setModelProvider(provider: PrivacyModelProviderId): Promise<void> {
  await vscode.workspace
    .getConfiguration('mergecore')
    .update('privacy.modelProvider', provider, vscode.ConfigurationTarget.Global);
}
