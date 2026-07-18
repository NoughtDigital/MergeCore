import * as vscode from 'vscode';
import {
  evaluateExternalSendGate,
  EXTERNAL_EVIDENCE_CONSENT_KEY,
  LAST_EVIDENCE_PREVIEW_KEY,
  LAST_TRANSMISSION_KEY,
} from './privacy-gate-core';
import {
  readPrivacySettings,
  type PrivacySettings,
} from './privacy-settings';

export {
  PrivacyGateError,
  EXTERNAL_EVIDENCE_CONSENT_KEY,
  LAST_TRANSMISSION_KEY,
  LAST_EVIDENCE_PREVIEW_KEY,
} from './privacy-gate-core';

export interface PrivacyGateDeps {
  readonly globalState: vscode.Memento;
  readonly showConfirm?: typeof vscode.window.showWarningMessage;
  readonly isTrusted?: () => boolean;
}

/**
 * Gate before any repository evidence leaves the machine (external model or review API).
 * Local loopback Ollama does not require this consent.
 */
export async function assertMaySendRepositoryEvidence(
  deps: PrivacyGateDeps,
  options: {
    readonly settings?: PrivacySettings;
    readonly requiresExternal: boolean;
    readonly purpose: string;
  }
): Promise<void> {
  const settings = options.settings ?? readPrivacySettings();
  const trusted = deps.isTrusted?.() ?? vscode.workspace.isTrusted;

  if (!options.requiresExternal) {
    const result = evaluateExternalSendGate({
      isTrusted: trusted,
      requiresExternal: false,
      externalRequestsEnabled: settings.externalRequestsEnabled,
      alreadyConsented: true,
    });
    if (!result.ok) throw result.error;
    return;
  }

  const alreadyConsented = deps.globalState.get<boolean>(
    EXTERNAL_EVIDENCE_CONSENT_KEY,
    false
  );

  let confirmChoice: 'Allow once' | 'Always allow' | 'Cancel' | undefined =
    alreadyConsented ? 'Allow once' : undefined;

  if (!alreadyConsented && settings.externalRequestsEnabled && trusted) {
    const show = deps.showConfirm ?? vscode.window.showWarningMessage;
    const choice = await show(
      `MergeCore will send repository evidence to an external model/provider for: ${options.purpose}. Continue?`,
      { modal: true },
      'Allow once',
      'Always allow',
      'Cancel'
    );
    confirmChoice =
      choice === 'Allow once' || choice === 'Always allow' || choice === 'Cancel'
        ? choice
        : undefined;
  }

  const result = evaluateExternalSendGate({
    isTrusted: trusted,
    requiresExternal: options.requiresExternal,
    externalRequestsEnabled: settings.externalRequestsEnabled,
    alreadyConsented,
    confirmChoice: alreadyConsented ? 'Allow once' : confirmChoice,
  });

  if (!result.ok) {
    throw result.error;
  }
  if (result.persistAlwaysAllow) {
    await deps.globalState.update(EXTERNAL_EVIDENCE_CONSENT_KEY, true);
  }
}

export async function recordModelTransmission(
  globalState: vscode.Memento,
  previewMarkdown: string
): Promise<void> {
  await globalState.update(LAST_TRANSMISSION_KEY, new Date().toISOString());
  const capped = previewMarkdown.slice(0, 12_000);
  await globalState.update(LAST_EVIDENCE_PREVIEW_KEY, capped);
}

export async function clearExternalConsent(globalState: vscode.Memento): Promise<void> {
  await globalState.update(EXTERNAL_EVIDENCE_CONSENT_KEY, undefined);
}

export function lastTransmissionAt(globalState: vscode.Memento): string | undefined {
  const v = globalState.get<string>(LAST_TRANSMISSION_KEY);
  return typeof v === 'string' ? v : undefined;
}

export function lastEvidencePreview(globalState: vscode.Memento): string | undefined {
  const v = globalState.get<string>(LAST_EVIDENCE_PREVIEW_KEY);
  return typeof v === 'string' ? v : undefined;
}
