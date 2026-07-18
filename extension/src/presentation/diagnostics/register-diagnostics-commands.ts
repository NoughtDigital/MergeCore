import * as path from 'path';
import * as vscode from 'vscode';
import {
  analyticsCategoriesDisclosure,
  averageLatencyMs,
  buildScrubbedAnalyticsBundle,
  createRepositorySearchEngine,
  deleteUsageDiagnostics,
  getSessionLastInspection,
  loadLastInspection,
  loadUsageMetrics,
  recordUsageEvent,
  saveMissingContextFeedback,
  hashRelativePath,
} from '@mergecore/intelligence';
import type { IndexerService } from '../../infrastructure/index/indexer.service';
import {
  readPrivacySettings,
  setUsageAnalyticsEnabled,
} from '../../infrastructure/privacy/privacy-settings';
import {
  showRetrievalInspectionPanel,
  showUsageMetricsPanel,
} from './inspection-panel';

const ANALYTICS_CONSENT_KEY = 'mergecore.privacy.usageAnalyticsConsentAt';

export interface DiagnosticsCommandDeps {
  readonly context: vscode.ExtensionContext;
  readonly indexer: IndexerService;
}

function requireTrusted(): boolean {
  if (!vscode.workspace.isTrusted) {
    void vscode.window.showWarningMessage(
      'MergeCore diagnostics commands require a trusted workspace.'
    );
    return false;
  }
  return true;
}

function workspaceRoot(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

function inspectionPayloadFromSession(): Record<string, unknown> | undefined {
  const session = getSessionLastInspection();
  if (!session) return undefined;
  return {
    originalQuery: session.originalQuery,
    queryFingerprint: session.debug.queryFingerprint,
    normalisedQuery: session.debug.normalisedQuery,
    incomplete: session.result.incomplete,
    selectedPaths: session.result.results.map((r) => r.path),
    selectedIds: session.debug.selectedIds,
    rejected: session.debug.rejected,
    filtering: session.debug.filtering,
    scoreComponents: session.debug.scoreComponents,
    stages: session.debug.stages,
    budgetUsage: session.debug.budgetUsage,
    sourceFreshness: session.debug.sourceFreshness,
    parserFailures: session.debug.parserFailures,
    indexHealth: session.debug.indexHealth,
    dependencyPaths: session.debug.dependencyPaths,
    notes: session.debug.notes,
    elapsedMs: session.debug.elapsedMs,
    candidateCount: session.debug.candidateCount,
    selectedCount: session.debug.selectedCount,
    candidates: session.debug.candidates,
  };
}

export function registerDiagnosticsCommands(deps: DiagnosticsCommandDeps): void {
  const { context, indexer } = deps;

  context.subscriptions.push(
    vscode.commands.registerCommand('mergecore.inspectLastRetrieval', async () => {
      if (!requireTrusted()) return;
      const root = workspaceRoot();
      if (!root) {
        void vscode.window.showInformationMessage('Open a workspace folder first.');
        return;
      }

      let payload = inspectionPayloadFromSession();
      if (!payload) {
        payload = await loadLastInspection(root);
      }

      if (!payload) {
        const query = await vscode.window.showInputBox({
          prompt: 'No prior inspection. Enter a query to run retrieval with debug.',
          placeHolder: 'e.g. authenticate user session',
          ignoreFocusOut: true,
        });
        if (!query?.trim()) return;
        try {
          const store = await indexer.getStore(root);
          const engine = await createRepositorySearchEngine({ store });
          await engine.searchRepositoryContext(query.trim(), { debug: true, k: 12 });
          payload = inspectionPayloadFromSession() ?? (await loadLastInspection(root));
        } catch (err) {
          void vscode.window.showErrorMessage(
            `Inspect retrieval failed: ${err instanceof Error ? err.message : String(err)}`
          );
          return;
        }
      }

      if (!payload) {
        void vscode.window.showWarningMessage('No retrieval inspection available yet.');
        return;
      }
      showRetrievalInspectionPanel(payload);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('mergecore.showUsageMetrics', async () => {
      if (!requireTrusted()) return;
      const root = workspaceRoot();
      if (!root) {
        void vscode.window.showInformationMessage('Open a workspace folder first.');
        return;
      }
      const metrics = await loadUsageMetrics(root);
      showUsageMetricsPanel({
        ...metrics,
        avgRetrievalLatencyMs: averageLatencyMs(
          metrics.retrievalLatencyMsSum,
          metrics.retrievalLatencyCount
        ),
        avgIndexLatencyMs: averageLatencyMs(
          metrics.indexLatencyMsSum,
          metrics.indexLatencyCount
        ),
        usageAnalyticsEnabled: readPrivacySettings().usageAnalyticsEnabled,
      });
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('mergecore.enableUsageAnalytics', async () => {
      if (!requireTrusted()) return;
      const categories = analyticsCategoriesDisclosure()
        .map((c) => `• ${c}`)
        .join('\n');
      const confirm = await vscode.window.showInformationMessage(
        `Enable anonymised usage analytics?\n\nCategories collected:\n${categories}\n\nExcluded by default: source code, prompts, task text, filenames, and repository identity.\nNothing is sent automatically — you can export a scrubbed bundle.`,
        { modal: true },
        'Enable',
        'Cancel'
      );
      if (confirm !== 'Enable') return;
      await setUsageAnalyticsEnabled(true);
      await context.globalState.update(ANALYTICS_CONSENT_KEY, new Date().toISOString());
      void vscode.window.showInformationMessage(
        'Usage analytics enabled (local counts; export scrubbed bundle when ready).'
      );
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('mergecore.disableUsageAnalytics', async () => {
      await setUsageAnalyticsEnabled(false);
      await context.globalState.update(ANALYTICS_CONSENT_KEY, undefined);
      void vscode.window.showInformationMessage('Usage analytics disabled.');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('mergecore.deleteLocalUsageDiagnostics', async () => {
      if (!requireTrusted()) return;
      const root = workspaceRoot();
      if (!root) {
        void vscode.window.showInformationMessage('Open a workspace folder first.');
        return;
      }
      const go = await vscode.window.showWarningMessage(
        'Delete local usage diagnostics under .mergecore/diagnostics/? This also clears analytics consent.',
        { modal: true },
        'Delete',
        'Cancel'
      );
      if (go !== 'Delete') return;
      await deleteUsageDiagnostics(root);
      await setUsageAnalyticsEnabled(false);
      await context.globalState.update(ANALYTICS_CONSENT_KEY, undefined);
      void vscode.window.showInformationMessage('Local usage diagnostics deleted.');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('mergecore.exportUsageAnalytics', async () => {
      if (!requireTrusted()) return;
      const root = workspaceRoot();
      if (!root) {
        void vscode.window.showInformationMessage('Open a workspace folder first.');
        return;
      }
      const settings = readPrivacySettings();
      if (!settings.usageAnalyticsEnabled) {
        void vscode.window.showWarningMessage(
          'Enable usage analytics first (MergeCore: Enable Usage Analytics).'
        );
        return;
      }
      const metrics = await loadUsageMetrics(root);
      const bundle = buildScrubbedAnalyticsBundle(metrics);
      const uri = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(
          path.join(root, 'mergecore-usage-analytics.json')
        ),
        filters: { JSON: ['json'] },
      });
      if (!uri) return;
      await vscode.workspace.fs.writeFile(
        uri,
        Buffer.from(`${JSON.stringify(bundle, null, 2)}\n`, 'utf8')
      );
      void vscode.window.showInformationMessage(
        `Scrubbed usage analytics exported to ${uri.fsPath}`
      );
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('mergecore.markMissingContext', async () => {
      if (!requireTrusted()) return;
      const root = workspaceRoot();
      if (!root) {
        void vscode.window.showInformationMessage('Open a workspace folder first.');
        return;
      }

      const editor = vscode.window.activeTextEditor;
      let missingPath: string | undefined;
      if (editor?.document.uri.scheme === 'file') {
        const folder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
        if (folder) {
          missingPath = path
            .relative(folder.uri.fsPath, editor.document.uri.fsPath)
            .replace(/\\/g, '/');
        }
      }

      if (!missingPath) {
        missingPath = await vscode.window.showInputBox({
          prompt: 'Workspace-relative path that was missing from retrieval',
          placeHolder: 'src/foo.ts',
          ignoreFocusOut: true,
        });
      } else {
        const keep = await vscode.window.showQuickPick(
          [
            { label: missingPath, description: 'Active editor', id: 'editor' },
            { label: 'Pick another path…', id: 'other' },
          ],
          { title: 'Mark Missing Context' }
        );
        if (!keep) return;
        if (keep.id === 'other') {
          missingPath = await vscode.window.showInputBox({
            prompt: 'Workspace-relative path that was missing from retrieval',
            placeHolder: 'src/foo.ts',
            ignoreFocusOut: true,
          });
        }
      }
      if (!missingPath?.trim()) return;

      const session = getSessionLastInspection();
      const query =
        session?.originalQuery ??
        (await vscode.window.showInputBox({
          prompt: 'Query that should have retrieved this file (for fingerprint only)',
          placeHolder: 'last retrieval query',
          ignoreFocusOut: true,
        }));
      if (!query?.trim()) {
        void vscode.window.showWarningMessage(
          'A query is required to fingerprint this feedback locally.'
        );
        return;
      }

      const notes = await vscode.window.showInputBox({
        prompt: 'Optional note',
        ignoreFocusOut: true,
      });

      const selectedPaths =
        session?.result.results.map((r) => r.path) ??
        ((await loadLastInspection(root))?.selectedPaths as string[] | undefined) ??
        [];

      try {
        const { relativePath } = await saveMissingContextFeedback(root, {
          query: query.trim(),
          missingPath: missingPath.trim().replace(/\\/g, '/'),
          lastSelectedPaths: selectedPaths,
          notes: notes?.trim() || undefined,
        });
        await recordUsageEvent(root, {
          kind: 'manually_added_file',
          pathHash: hashRelativePath(missingPath.trim().replace(/\\/g, '/')),
        });
        void vscode.window.showInformationMessage(
          `Missing context recorded at ${relativePath} (eval feedback only — ranking unchanged).`
        );
      } catch (err) {
        void vscode.window.showErrorMessage(
          `Mark Missing Context failed: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    })
  );
}
