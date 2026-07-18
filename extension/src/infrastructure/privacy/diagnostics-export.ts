import * as vscode from 'vscode';
import type { MergeCoreSecretStore } from '../secret-store';
import type { IndexerService } from '../index/indexer.service';
import { collectPrivacyStatus, workspaceFingerprint } from './privacy-status';
import { readPrivacySettings } from './privacy-settings';
import {
  assertNoSecretsInDiagnostics,
  redactHomePath,
  scrubDiagnosticsMessage,
  serialiseDiagnostics,
  type DiagnosticsPayload,
} from './diagnostics-export-core';

export type { DiagnosticsPayload } from './diagnostics-export-core';
export {
  assertNoSecretsInDiagnostics,
  redactHomePath,
  serialiseDiagnostics,
  scrubDiagnosticsMessage,
} from './diagnostics-export-core';

export interface DiagnosticsExportInput {
  readonly indexer: IndexerService;
  readonly secrets: MergeCoreSecretStore;
  readonly globalState: vscode.Memento;
  readonly extensionVersion: string;
  readonly anonymise?: boolean;
  readonly includeEnvKeys?: boolean;
  readonly lastErrorMessage?: string | null;
}

function anonymiseBasename(root: string | null): string | null {
  if (!root) return null;
  return `workspace-${workspaceFingerprint(root).slice(0, 8)}`;
}

/**
 * Build a redacted diagnostics payload — no source bodies, no API keys, no env values.
 */
export async function buildDiagnosticsPayload(
  input: DiagnosticsExportInput
): Promise<DiagnosticsPayload> {
  const status = await collectPrivacyStatus({
    indexer: input.indexer,
    secrets: input.secrets,
    globalState: input.globalState,
  });
  const settings = readPrivacySettings();
  const keys = await input.secrets.keyPresence();
  const anonymise = input.anonymise ?? settings.anonymiseDiagnostics;

  const storagePath = status.indexStoragePath
    ? redactHomePath(status.indexStoragePath)
    : null;

  const envKeysPresent: string[] = [];
  if (input.includeEnvKeys !== false) {
    for (const k of Object.keys(process.env).sort()) {
      if (/key|token|secret|password|credential/i.test(k)) {
        envKeysPresent.push(k);
      }
    }
  }

  const workspaceLabel = anonymise
    ? anonymiseBasename(status.workspaceRoot)
    : status.workspaceRoot
      ? redactHomePath(status.workspaceRoot)
      : null;

  const lastErrorMessage = input.lastErrorMessage
    ? scrubDiagnosticsMessage(input.lastErrorMessage)
    : null;

  return {
    exportedAt: new Date().toISOString(),
    extensionVersion: input.extensionVersion,
    workspaceFingerprint: status.workspaceRoot
      ? workspaceFingerprint(status.workspaceRoot)
      : null,
    workspaceLabel,
    trusted: status.workspaceTrusted,
    privacy: {
      externalRequestsEnabled: settings.externalRequestsEnabled,
      modelProvider: settings.modelProvider,
      enableModelExplanation: settings.enableModelExplanation,
      providerKeyPresent: status.providerKeyPresent,
      apiTokenPresent: keys.apiToken,
    },
    index: {
      storagePath:
        anonymise && storagePath
          ? storagePath.replace(/[^/\\]+(?=\/\.mergecore)/, 'workspace')
          : storagePath,
      indexedFileCount: status.indexedFileCount,
      excludedFileCount: status.excludedFileCount,
      chunkCount: status.chunkCount,
      symbolCount: status.symbolCount,
      indexSizeBytes: status.indexSizeBytes,
      lastCompletedIndexAt: status.lastCompletedIndexAt,
      phase: status.indexPhase,
      schemaVersion: status.schemaVersion,
    },
    ignoreRules: status.ignoreRules,
    transmittedRepositoryContent: status.transmittedRepositoryContent,
    lastTransmissionAt: status.lastTransmissionAt,
    envKeysPresent,
    lastErrorMessage,
    notes: [
      'No source file contents included.',
      'API keys and secret values are never included.',
      'Environment values are omitted; only matching key names may appear.',
      'MergeCore private alpha does not send behavioural analytics.',
    ],
  };
}

export async function exportDiagnosticsToUri(
  uri: vscode.Uri,
  input: DiagnosticsExportInput
): Promise<void> {
  const payload = await buildDiagnosticsPayload(input);
  const text = serialiseDiagnostics(payload);
  assertNoSecretsInDiagnostics(text);
  await vscode.workspace.fs.writeFile(uri, Buffer.from(text, 'utf8'));
}
