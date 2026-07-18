import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';
import {
  previewIndexRules,
  RAG_DIR,
  type IndexRulePreviewRow,
} from '@mergecore/intelligence';
import type { IndexerService } from '../../infrastructure/index/indexer.service';
import type { MergeCoreSecretStore } from '../../infrastructure/secret-store';
import { MergeCoreLogger } from '../../infrastructure/logger';
import {
  collectPrivacyStatus,
} from '../../infrastructure/privacy/privacy-status';
import {
  clearExternalConsent,
  lastEvidencePreview,
  PrivacyGateError,
} from '../../infrastructure/privacy/privacy-gate';
import {
  readPrivacySettings,
  setExternalRequestsEnabled,
  setExternalProvider,
  setModelMode,
  providerRequiresExternalRequests,
} from '../../infrastructure/privacy/privacy-settings';
import {
  buildDiagnosticsPayload,
  exportDiagnosticsToUri,
  serialiseDiagnostics,
} from '../../infrastructure/privacy/diagnostics-export';
import { readVscodeExtraExclusions } from '../../infrastructure/privacy/filter-model-evidence';
import { showPrivacyStatusPanel } from './privacy-status-panel';
import {
  formatPreviewIndexRulesMarkdown,
  runPreviewIndexRules,
} from './preview-index-rules';
import { confirmWeakenRestrictionsIfNeeded } from './confirm-weaken';

export interface PrivacyCommandDeps {
  readonly indexer: IndexerService;
  readonly secrets: MergeCoreSecretStore;
  readonly context: vscode.ExtensionContext;
  readonly logger: MergeCoreLogger;
}

function requireTrusted(): boolean {
  if (!vscode.workspace.isTrusted) {
    void vscode.window.showWarningMessage(
      'MergeCore privacy commands require a trusted workspace.'
    );
    return false;
  }
  return true;
}

function workspaceRoot(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

function formatDecisionLine(row: IndexRulePreviewRow): string {
  return (
    `- \`${row.path}\` — **${row.classification}**` +
    (row.matchedPattern ? ` · pattern=\`${row.matchedPattern}\`` : '') +
    ` · source=${row.ruleSource}` +
    (row.rulePath ? ` · \`${row.rulePath}\`` : '') +
    ` · retrieval=${row.allowsRetrieval ? 'yes' : 'no'}` +
    ` · model=${row.allowsModelEvidence ? 'yes' : 'no'}`
  );
}

export function registerPrivacyCommands(deps: PrivacyCommandDeps): void {
  const { context, indexer, secrets, logger } = deps;

  context.subscriptions.push(
    vscode.commands.registerCommand('mergecore.showPrivacyStatus', async () => {
      if (!requireTrusted()) return;
      const root = workspaceRoot();
      if (root) {
        await confirmWeakenRestrictionsIfNeeded(root);
      }
      const snapshot = await collectPrivacyStatus({
        indexer,
        secrets,
        globalState: context.globalState,
      });
      await showPrivacyStatusPanel(snapshot);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('mergecore.showIndexedFiles', async () => {
      if (!requireTrusted()) return;
      const root = workspaceRoot();
      if (!root) {
        void vscode.window.showInformationMessage('Open a workspace folder first.');
        return;
      }
      try {
        const store = await indexer.getStore(root);
        const paths = store
          .allChunks()
          .map((c) => c.path)
          .filter((p, i, arr) => arr.indexOf(p) === i)
          .sort((a, b) => a.localeCompare(b))
          .slice(0, 2000);
        const doc = await vscode.workspace.openTextDocument({
          content: [`# Indexed files (${paths.length})`, '', ...paths.map((p) => `- \`${p}\``)].join(
            '\n'
          ),
          language: 'markdown',
        });
        await vscode.window.showTextDocument(doc, { preview: true });
      } catch (err) {
        void vscode.window.showWarningMessage(
          `Could not list indexed files: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('mergecore.showExcludedFiles', async () => {
      if (!requireTrusted()) return;
      const root = workspaceRoot();
      if (!root) {
        void vscode.window.showInformationMessage('Open a workspace folder first.');
        return;
      }
      try {
        const preview = await previewIndexRules({
          workspaceRoot: root,
          maxFiles: 4000,
          vscodeExtraExclusions: readVscodeExtraExclusions(),
        });
        const status = await indexer.getIndexStatus(root);
        const exclusions = status.exclusions ?? [];
        const lines = [
          `# Excluded / restricted files`,
          '',
          `- filesSkipped (last index): ${status.filesSkipped}`,
          `- exclusion records: ${exclusions.length}`,
          `- preview excluded: ${preview.excluded.length}`,
          `- preview restricted: ${preview.restricted.length}`,
          '',
          '## Restricted (local only / never send to model)',
          '',
        ];
        if (preview.restricted.length === 0) {
          lines.push('_None._', '');
        } else {
          for (const row of preview.restricted.slice(0, 400)) {
            lines.push(formatDecisionLine(row));
          }
          lines.push('');
        }
        lines.push('## Excluded', '');
        if (preview.excluded.length === 0) {
          lines.push(
            '_No preview exclusions. Index status exclusion records:_',
            '',
            ...exclusions
              .slice(0, 500)
              .map((e) => `- \`${e.path}\` — ${e.reason}${e.detail ? ` (${e.detail})` : ''}`)
          );
        } else {
          for (const row of preview.excluded.slice(0, 500)) {
            lines.push(formatDecisionLine(row));
          }
        }
        const doc = await vscode.workspace.openTextDocument({
          content: lines.join('\n'),
          language: 'markdown',
        });
        await vscode.window.showTextDocument(doc, { preview: true });
      } catch (err) {
        void vscode.window.showWarningMessage(
          `Could not list exclusions: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('mergecore.previewIndexRules', async () => {
      if (!requireTrusted()) return;
      const root = workspaceRoot();
      if (!root) {
        void vscode.window.showInformationMessage('Open a workspace folder first.');
        return;
      }
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'MergeCore: Preview Index Rules…',
          cancellable: true,
        },
        async (_progress, token) => {
          try {
            const result = await runPreviewIndexRules(root, {
              maxFiles: 8000,
              vscodeExtraExclusions: readVscodeExtraExclusions(),
            });
            if (token.isCancellationRequested) {
              return;
            }
            const markdown = formatPreviewIndexRulesMarkdown(result);
            const doc = await vscode.workspace.openTextDocument({
              content: markdown,
              language: 'markdown',
            });
            await vscode.window.showTextDocument(doc, {
              preview: true,
              viewColumn: vscode.ViewColumn.Beside,
            });
          } catch (err) {
            if (token.isCancellationRequested) return;
            void vscode.window.showErrorMessage(
              `Preview Index Rules failed: ${err instanceof Error ? err.message : String(err)}`
            );
          }
        }
      );
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('mergecore.openIndexLocation', async () => {
      if (!requireTrusted()) return;
      const root = workspaceRoot();
      if (!root) {
        void vscode.window.showInformationMessage('Open a workspace folder first.');
        return;
      }
      const rag = path.join(root, RAG_DIR);
      try {
        await fs.mkdir(rag, { recursive: true });
      } catch {
        // reveal anyway
      }
      await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(rag));
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('mergecore.deleteLocalIndex', async () => {
      if (!requireTrusted()) return;
      const root = workspaceRoot();
      if (!root) {
        void vscode.window.showInformationMessage('Open a workspace folder first.');
        return;
      }

      const includeGenerated =
        (await vscode.window.showQuickPick(
          [
            { label: 'Delete RAG index only', description: 'Preserve generated + memory', value: 'rag' },
            {
              label: 'Delete RAG + generated',
              description: 'Keep shareable .mergecore/memory',
              value: 'generated',
            },
            {
              label: 'Delete RAG + generated + shareable memory',
              description: 'Destructive — requires confirmation',
              value: 'memory',
            },
          ],
          { placeHolder: 'What should MergeCore delete?' }
        )) ?? undefined;

      if (!includeGenerated) return;

      if (includeGenerated.value === 'memory') {
        const confirm = await vscode.window.showWarningMessage(
          'Also delete shareable Markdown memory under .mergecore/memory? This cannot be undone.',
          { modal: true },
          'Delete memory too',
          'Cancel'
        );
        if (confirm !== 'Delete memory too') return;
      }

      const go = await vscode.window.showWarningMessage(
        `Delete local MergeCore index data for ${root}? Active indexing will be stopped.`,
        { modal: true },
        'Delete',
        'Cancel'
      );
      if (go !== 'Delete') return;

      try {
        const result = await indexer.deleteLocalIndex(root, {
          includeGenerated:
            includeGenerated.value === 'generated' || includeGenerated.value === 'memory',
          includeShareableMemory: includeGenerated.value === 'memory',
        });
        if (result.errors.length > 0) {
          void vscode.window.showErrorMessage(
            `Index delete completed with errors: ${result.errors.join('; ')}`
          );
        } else {
          void vscode.window.showInformationMessage(
            `Local index deleted (rag=${result.deletedRag}, generated=${result.deletedGenerated}, memory=${result.deletedMemory}).`
          );
        }
      } catch (err) {
        logger.error('deleteLocalIndex failed', err);
        void vscode.window.showErrorMessage(
          `Failed to delete local index: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('mergecore.rebuildLocalIndex', async () => {
      if (!requireTrusted()) return;
      const root = workspaceRoot();
      if (!root) {
        void vscode.window.showInformationMessage('Open a workspace folder first.');
        return;
      }
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'MergeCore: rebuilding local index…',
          cancellable: true,
        },
        async (_progress, token) => {
          try {
            const status = await indexer.rebuildRepository(root, token);
            void vscode.window.showInformationMessage(
              `Rebuild complete: ${status.fileCount} files, ${status.chunkCount} chunks.`
            );
          } catch (err) {
            if (token.isCancellationRequested) {
              void vscode.window.showInformationMessage('Rebuild cancelled.');
              return;
            }
            void vscode.window.showErrorMessage(
              `Rebuild failed: ${err instanceof Error ? err.message : String(err)}`
            );
          }
        }
      );
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('mergecore.configureModelProvider', async () => {
      if (!requireTrusted()) return;
      const modePick = await vscode.window.showQuickPick(
        [
          {
            label: 'Deterministic only',
            description: 'Default — no model calls',
            value: 'deterministic' as const,
          },
          {
            label: 'Local model',
            description: 'OpenAI-compatible HTTP (loopback by default)',
            value: 'local' as const,
          },
          {
            label: 'External BYOK',
            description: 'OpenAI or Anthropic via SecretStorage',
            value: 'external' as const,
          },
        ],
        { placeHolder: 'Select MergeCore model mode' }
      );
      if (!modePick) return;

      if (modePick.value === 'deterministic') {
        await setModelMode('deterministic');
        void vscode.window.showInformationMessage('MergeCore model mode: deterministic only.');
        return;
      }

      if (modePick.value === 'local') {
        await setModelMode('local');
        const settings = readPrivacySettings();
        if (providerRequiresExternalRequests(settings)) {
          const enableExt = await vscode.window.showWarningMessage(
            'Local model base URL is not loopback. Enable external requests to use it?',
            { modal: true },
            'Enable external requests',
            'Keep disabled'
          );
          if (enableExt === 'Enable external requests') {
            await setExternalRequestsEnabled(true);
          }
        }
        void vscode.window.showInformationMessage(
          `MergeCore model mode: local (${settings.localModel} @ ${settings.localBaseUrl}).`
        );
        return;
      }

      const providerPick = await vscode.window.showQuickPick(
        [
          { label: 'openai', description: 'OpenAI BYOK', value: 'openai' as const },
          { label: 'anthropic', description: 'Anthropic BYOK', value: 'anthropic' as const },
        ],
        { placeHolder: 'Select external BYOK provider' }
      );
      if (!providerPick) return;

      await setExternalProvider(providerPick.value);
      const enableExt = await vscode.window.showWarningMessage(
        'This provider sends repository evidence externally when used. Enable external requests now?',
        { modal: true },
        'Enable external requests',
        'Keep disabled'
      );
      if (enableExt === 'Enable external requests') {
        await setExternalRequestsEnabled(true);
      }

      const key = await vscode.window.showInputBox({
        prompt: `Enter ${providerPick.value} API key (stored in OS keychain only)`,
        password: true,
        ignoreFocusOut: true,
        placeHolder: 'sk-…',
      });
      if (key !== undefined) {
        if (providerPick.value === 'openai') await secrets.setOpenAiApiKey(key);
        else await secrets.setAnthropicApiKey(key);
      }

      void vscode.window.showInformationMessage(
        `MergeCore model mode: external (${providerPick.value}).`
      );
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('mergecore.disableExternalModels', async () => {
      await setExternalRequestsEnabled(false);
      await clearExternalConsent(context.globalState);
      void vscode.window.showInformationMessage(
        'External requests disabled. Local deterministic features remain available.'
      );
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('mergecore.previewDataSentToModel', async () => {
      if (!requireTrusted()) return;
      const preview = lastEvidencePreview(context.globalState);
      const content =
        preview && preview.trim().length > 0
          ? preview
          : '# No model evidence preview\n\nNo repository evidence has been prepared for a model send in this session/machine yet.';
      const doc = await vscode.workspace.openTextDocument({
        content,
        language: 'markdown',
      });
      await vscode.window.showTextDocument(doc, { preview: true });
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('mergecore.previewModelRequest', async () => {
      if (!requireTrusted()) return;
      const settings = readPrivacySettings();
      const {
        buildModelRequestPreview,
        formatModelRequestPreviewMarkdown,
      } = await import('../../infrastructure/explain/model-request-preview');
      const preview = buildModelRequestPreview({
        providerType: settings.modelMode,
        model:
          settings.modelMode === 'local'
            ? settings.localModel
            : settings.modelMode === 'external'
              ? settings.externalProvider
              : '',
        dataRemainsLocal:
          settings.modelMode === 'deterministic' ||
          (settings.modelMode === 'local' &&
            !providerRequiresExternalRequests(settings)),
        purpose: 'Manual preview (no send)',
        evidenceFiles: [],
        excludedEvidence: [],
        rawBodyChars: 0,
      });
      const doc = await vscode.workspace.openTextDocument({
        content: formatModelRequestPreviewMarkdown(preview),
        language: 'markdown',
      });
      await vscode.window.showTextDocument(doc, { preview: true, viewColumn: vscode.ViewColumn.Beside });
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('mergecore.exportDiagnostics', async () => {
      if (!requireTrusted()) return;
      const version =
        typeof context.extension.packageJSON.version === 'string'
          ? context.extension.packageJSON.version
          : '0.0.0';
      const uri = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(
          path.join(workspaceRoot() ?? '', 'mergecore-diagnostics.json')
        ),
        filters: { JSON: ['json'] },
      });
      if (!uri) return;
      try {
        await exportDiagnosticsToUri(uri, {
          indexer,
          secrets,
          globalState: context.globalState,
          extensionVersion: version,
        });
        void vscode.window.showInformationMessage(`Diagnostics exported to ${uri.fsPath}`);
      } catch (err) {
        void vscode.window.showErrorMessage(
          `Diagnostics export failed: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    })
  );

  void buildDiagnosticsPayload;
  void serialiseDiagnostics;
  void readPrivacySettings;
  void PrivacyGateError;
}
