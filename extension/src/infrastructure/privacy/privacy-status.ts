import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';
import { RAG_DIR, sha256 } from '@mergecore/intelligence';
import type { IndexerService } from '../index/indexer.service';
import type { MergeCoreSecretStore } from '../secret-store';
import {
  isLoopbackOllamaUrl,
  providerRequiresExternalRequests,
} from './privacy-settings-core';
import { readPrivacySettings } from './privacy-settings';
import { lastTransmissionAt } from './privacy-gate';

export { redactHomePath } from './diagnostics-export-core';

export interface PrivacyStatusSnapshot {
  readonly workspaceRoot: string | null;
  readonly workspaceTrusted: boolean;
  readonly indexedFileCount: number;
  readonly excludedFileCount: number;
  readonly chunkCount: number;
  readonly symbolCount: number;
  readonly indexStoragePath: string | null;
  readonly indexSizeBytes: number | null;
  readonly lastCompletedIndexAt: string | null;
  readonly indexPhase: string | null;
  readonly modelMode: string;
  readonly externalRequestsEnabled: boolean;
  readonly usageAnalyticsEnabled: boolean;
  readonly providerConfigured: string;
  readonly providerKeyPresent: boolean;
  readonly transmittedRepositoryContent: boolean;
  readonly lastTransmissionAt: string | null;
  readonly ignoreRules: readonly string[];
  readonly schemaVersion: number | null;
}

async function dirSizeBytes(dir: string): Promise<number> {
  let total = 0;
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        total += await dirSizeBytes(full);
      } else if (entry.isFile()) {
        const st = await fs.stat(full);
        total += st.size;
      }
    }
  } catch {
    return total;
  }
  return total;
}

async function summariseIgnoreRules(workspaceRoot: string): Promise<string[]> {
  const out: string[] = [];
  for (const name of ['.gitignore', '.mergecoreignore', '.cursorignore']) {
    const abs = path.join(workspaceRoot, name);
    try {
      await fs.access(abs);
      const text = await fs.readFile(abs, 'utf8');
      const lines = text
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith('#'));
      out.push(`${name}: ${lines.length} pattern(s)`);
    } catch {
      out.push(`${name}: not present`);
    }
  }
  return out;
}

export async function collectPrivacyStatus(input: {
  readonly indexer: IndexerService;
  readonly secrets: MergeCoreSecretStore;
  readonly globalState: vscode.Memento;
}): Promise<PrivacyStatusSnapshot> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  const workspaceRoot = folder?.uri.fsPath ?? null;
  const settings = readPrivacySettings();
  const keys = await input.secrets.keyPresence();

  let indexedFileCount = 0;
  let excludedFileCount = 0;
  let chunkCount = 0;
  let symbolCount = 0;
  let indexStoragePath: string | null = null;
  let indexSizeBytes: number | null = null;
  let lastCompletedIndexAt: string | null = null;
  let indexPhase: string | null = null;
  let schemaVersion: number | null = null;
  let ignoreRules: string[] = [];

  if (workspaceRoot) {
    indexStoragePath = path.join(workspaceRoot, RAG_DIR);
    ignoreRules = await summariseIgnoreRules(workspaceRoot);
    try {
      indexSizeBytes = await dirSizeBytes(indexStoragePath);
    } catch {
      indexSizeBytes = null;
    }
    try {
      const status = await input.indexer.getIndexStatus(workspaceRoot);
      indexedFileCount = status.fileCount;
      excludedFileCount = status.filesSkipped ?? status.exclusions?.length ?? 0;
      chunkCount = status.chunkCount;
      symbolCount = status.symbolCount;
      indexPhase = status.phase;
      schemaVersion = status.schemaVersion ?? null;
      if (status.storeDir) {
        indexStoragePath = status.storeDir;
      }
      if (status.updatedAt) {
        lastCompletedIndexAt = new Date(status.updatedAt).toISOString();
      }
    } catch {
      // index may be missing
    }
  }

  const requiresExternal = providerRequiresExternalRequests(settings);
  void requiresExternal;
  let modelMode = 'none (deterministic only)';
  if (settings.modelProvider === 'ollama') {
    modelMode = isLoopbackOllamaUrl(settings.ollamaBaseUrl)
      ? `local Ollama (${settings.chatModel})`
      : `remote Ollama (${settings.chatModel}) — external`;
  } else if (settings.modelProvider === 'openai') {
    modelMode = 'external OpenAI (BYOK)';
  } else if (settings.modelProvider === 'anthropic') {
    modelMode = 'external Anthropic (BYOK)';
  }

  const providerKeyPresent =
    settings.modelProvider === 'openai'
      ? keys.openai
      : settings.modelProvider === 'anthropic'
        ? keys.anthropic
        : settings.modelProvider === 'ollama'
          ? true
          : false;

  const lastTx = lastTransmissionAt(input.globalState);

  return {
    workspaceRoot,
    workspaceTrusted: vscode.workspace.isTrusted,
    indexedFileCount,
    excludedFileCount,
    chunkCount,
    symbolCount,
    indexStoragePath,
    indexSizeBytes,
    lastCompletedIndexAt,
    indexPhase,
    modelMode,
    externalRequestsEnabled: settings.externalRequestsEnabled,
    usageAnalyticsEnabled: settings.usageAnalyticsEnabled,
    providerConfigured: settings.modelProvider,
    providerKeyPresent,
    transmittedRepositoryContent: Boolean(lastTx),
    lastTransmissionAt: lastTx ?? null,
    ignoreRules,
    schemaVersion,
  };
}

export function formatPrivacyStatusMarkdown(s: PrivacyStatusSnapshot): string {
  const size =
    s.indexSizeBytes === null
      ? 'unknown'
      : s.indexSizeBytes < 1024
        ? `${s.indexSizeBytes} B`
        : s.indexSizeBytes < 1024 * 1024
          ? `${(s.indexSizeBytes / 1024).toFixed(1)} KiB`
          : `${(s.indexSizeBytes / (1024 * 1024)).toFixed(2)} MiB`;

  return [
    '# MergeCore Privacy Status',
    '',
    `- **Active workspace:** ${s.workspaceRoot ?? '(none)'}`,
    `- **Workspace trusted:** ${s.workspaceTrusted ? 'yes' : 'no'}`,
    `- **Indexed files:** ${s.indexedFileCount}`,
    `- **Excluded / skipped files:** ${s.excludedFileCount}`,
    `- **Chunks / symbols:** ${s.chunkCount} / ${s.symbolCount}`,
    `- **Index storage path:** ${s.indexStoragePath ?? '(none)'}`,
    `- **Index size:** ${size}`,
    `- **Last completed index:** ${s.lastCompletedIndexAt ?? '(never)'}`,
    `- **Index phase:** ${s.indexPhase ?? '(unknown)'}`,
    `- **Schema version:** ${s.schemaVersion ?? '(unknown)'}`,
    `- **Model mode:** ${s.modelMode}`,
    `- **External requests enabled:** ${s.externalRequestsEnabled ? 'yes' : 'no'}`,
    `- **Usage analytics (opt-in):** ${s.usageAnalyticsEnabled ? 'yes' : 'no'}`,
    `- **Provider configured:** ${s.providerConfigured}`,
    `- **Provider key present:** ${s.providerKeyPresent ? 'yes' : 'no'} _(value never shown)_`,
    `- **Generated result transmitted repository content:** ${s.transmittedRepositoryContent ? 'yes' : 'no'}`,
    `- **Last transmission:** ${s.lastTransmissionAt ?? '(none this session/machine)'}`,
    '',
    '## Ignore rules',
    '',
    ...s.ignoreRules.map((r) => `- ${r}`),
    '',
    '---',
    '_MergeCore private alpha — no behavioural analytics. Secrets stay in OS keychain._',
  ].join('\n');
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MiB`;
}

export function workspaceFingerprint(root: string): string {
  return sha256(root).slice(0, 16);
}
