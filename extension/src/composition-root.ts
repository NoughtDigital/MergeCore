import * as vscode from 'vscode';
import {
  clearProjectProfileCache,
  installProjectProfileCacheInvalidation,
} from './infrastructure/project-profile-cache';
import { ReviewCodeUseCase } from './application/review-code.use-case';
import { Explainer } from './infrastructure/explain/explainer';
import { OllamaClient } from './infrastructure/explain/ollama.client';
import { GitDiffService } from './infrastructure/git-diff.service';
import { IndexerService } from './infrastructure/index/indexer.service';
import { installIndexWatchers } from './infrastructure/index/watchers';
import { MergeCoreLogger } from './infrastructure/logger';
import { MergeCoreReviewAdapter } from './infrastructure/mergecore-review.adapter';
import { MockReviewEngine } from './infrastructure/mock-review.engine';
import { PatchApplier } from './infrastructure/patch-applier';
import { RequestThrottle } from './infrastructure/request-throttle';
import { MergeCoreSecretStore, migrateTokenFromSettingsIfAny } from './infrastructure/secret-store';
import {
  readExplanationMode,
  readIntelligenceProfile,
  readOllamaSettings,
  registerCognitionCommands,
} from './presentation/commands/register-cognition-commands';
import { registerMergeCoreCommands } from './presentation/commands/register-commands';
import { registerProdRiskScanCommand } from './presentation/commands/register-prod-risk-scan';
import { FindingDiagnostics } from './presentation/diagnostics/finding-diagnostics';
import { registerMergeCoreHoverProvider } from './presentation/hover/mergecore-hover.provider';
import { ReviewSessionState } from './presentation/state/review-session.state';
import { registerMergeCoreStatusBar } from './presentation/status/mergecore-status-bar';
import { MergeCoreSidebarProvider } from './presentation/webview/mergecore-sidebar.provider';

export function createMergeCoreApp(context: vscode.ExtensionContext): void {
  const logger = MergeCoreLogger.shared;
  logger.info('MergeCore activating…');

  const secrets = new MergeCoreSecretStore(context.secrets);
  void migrateTokenFromSettingsIfAny(context, secrets);

  const abortSignals: { current: AbortController | undefined } = { current: undefined };
  const mockEngine = new MockReviewEngine();
  const engine = new MergeCoreReviewAdapter(
    mockEngine,
    secrets,
    context.globalState,
    () => abortSignals.current?.signal
  );
  const review = new ReviewCodeUseCase(engine);
  const gitDiff = new GitDiffService();
  const patchApplier = new PatchApplier();
  const diagnostics = new FindingDiagnostics();
  const session = new ReviewSessionState();
  const throttle = new RequestThrottle();

  const ollamaSettings = readOllamaSettings();
  const ollamaRef: { current: OllamaClient } = {
    current: new OllamaClient({
      baseUrl: ollamaSettings.baseUrl,
      chatModel: ollamaSettings.chatModel,
      embedModel: ollamaSettings.embedModel,
    }),
  };
  const explainer = new Explainer({
    chat: (messages) => ollamaRef.current.chat(messages),
    isAvailable: () => ollamaRef.current.isAvailable(),
  });
  const indexer = new IndexerService(logger, context.extensionPath);
  indexer.setEmbeddingPort({
    embed: (texts) => ollamaRef.current.embed(texts),
  });

  const assetVersion =
    typeof context.extension.packageJSON.version === 'string' && context.extension.packageJSON.version.length > 0
      ? context.extension.packageJSON.version
      : '0.0.0';
  const sidebar = new MergeCoreSidebarProvider(context.extensionUri, assetVersion);

  context.subscriptions.push(diagnostics);
  context.subscriptions.push({ dispose: () => sidebar.dispose() });
  context.subscriptions.push({ dispose: () => logger.dispose() });
  context.subscriptions.push(installProjectProfileCacheInvalidation());
  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      clearProjectProfileCache();
      indexer.clear();
    })
  );
  context.subscriptions.push(installIndexWatchers(indexer, logger));

  registerCognitionCommands(context, { indexer, logger });
  registerMergeCoreHoverProvider(context, {
    indexer,
    explainer,
    embedQuery: async (text) => {
      const vectors = await ollamaRef.current.embed([text]);
      return vectors?.[0];
    },
    getMode: () => readExplanationMode(),
    getProfile: () => readIntelligenceProfile(),
  });

  registerMergeCoreCommands(context, {
    review,
    gitDiff,
    diagnostics,
    session,
    sidebar,
    patchApplier,
    secrets,
    throttle,
    abortSignals,
  });

  registerProdRiskScanCommand(context, {
    diagnostics,
    session,
    sidebar,
  });

  const provider = vscode.window.registerWebviewViewProvider(MergeCoreSidebarProvider.viewId, sidebar, {
    webviewOptions: {
      retainContextWhenHidden: true,
    },
  });
  context.subscriptions.push(provider);

  const status = registerMergeCoreStatusBar(context, indexer);

  // Background index on activate when a workspace is open
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (folder) {
    void indexer.indexRepository(folder.uri.fsPath).catch((err) => {
      logger.warn(`Background index skipped: ${err instanceof Error ? err.message : String(err)}`);
      status.setMessage('Index pending', false);
    });
  }

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (
        e.affectsConfiguration('mergecore.local.ollamaBaseUrl') ||
        e.affectsConfiguration('mergecore.local.chatModel') ||
        e.affectsConfiguration('mergecore.local.embedModel')
      ) {
        const next = readOllamaSettings();
        ollamaRef.current = new OllamaClient({
          baseUrl: next.baseUrl,
          chatModel: next.chatModel,
          embedModel: next.embedModel,
        });
      }
    })
  );

  logger.info('MergeCore ready.');
}
