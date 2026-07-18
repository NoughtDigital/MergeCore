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
  readOllamaSettings,
  registerCognitionCommands,
} from './presentation/commands/register-cognition-commands';
import { registerMergeCoreCommands } from './presentation/commands/register-commands';
import { registerProdRiskScanCommand } from './presentation/commands/register-prod-risk-scan';
import { FindingDiagnostics } from './presentation/diagnostics/finding-diagnostics';
import { registerMergeCoreHoverProvider } from './presentation/hover/mergecore-hover.provider';
import { registerHoverCommands } from './presentation/hover/register-hover-commands';
import { registerExplainSelectedCode } from './presentation/explain/register-explain-selected';
import { registerMemoryCommands } from './presentation/memory/register-memory-commands';
import { registerGenerateTaskContext } from './presentation/context/register-task-context';
import { registerCopyMcpConfig } from './presentation/commands/register-copy-mcp-config';
import { registerPrivacyCommands } from './presentation/privacy/register-privacy-commands';
import {
  modelEnhancementAllowed,
  resolveChatPorts,
} from './infrastructure/explain/model-provider-factory';
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
    chat: (messages, signal) =>
      resolveChatPorts({
        secrets,
        getOllama: () => ollamaRef.current,
      }).chat(messages, signal),
    isAvailable: (signal) =>
      resolveChatPorts({
        secrets,
        getOllama: () => ollamaRef.current,
      }).isAvailable(signal),
  });
  const modelPorts = {
    chat: (messages: Parameters<typeof ollamaRef.current.chat>[0], signal?: AbortSignal) =>
      resolveChatPorts({
        secrets,
        getOllama: () => ollamaRef.current,
      }).chat(messages, signal),
    isAvailable: (signal?: AbortSignal) =>
      resolveChatPorts({
        secrets,
        getOllama: () => ollamaRef.current,
      }).isAvailable(signal),
  };
  const isModelExplanationEnabled = () => modelEnhancementAllowed();
  const indexer = new IndexerService(logger, context.extensionPath);
  indexer.setEmbeddingPort({
    embed: (texts) => ollamaRef.current.embed(texts),
  });

  const assetVersion =
    typeof context.extension.packageJSON.version === 'string' && context.extension.packageJSON.version.length > 0
      ? context.extension.packageJSON.version
      : '0.0.0';
  const sidebar = new MergeCoreSidebarProvider(context.extensionUri, assetVersion);
  const status = registerMergeCoreStatusBar(context, indexer);

  const indexedRoots = new Set<string>();
  const ensureIndexed = async (workspaceRoot: string): Promise<void> => {
    if (indexedRoots.has(workspaceRoot)) {
      return;
    }
    try {
      const store = await indexer.getStore(workspaceRoot);
      if (store.chunkCount > 0) {
        indexedRoots.add(workspaceRoot);
        return;
      }
    } catch {
      // fall through to full index
    }
    indexedRoots.add(workspaceRoot);
    try {
      await indexer.indexRepository(workspaceRoot);
    } catch (err) {
      indexedRoots.delete(workspaceRoot);
      logger.warn(`Deferred index skipped: ${err instanceof Error ? err.message : String(err)}`);
      status.setMessage('Index pending', false);
    }
  };

  context.subscriptions.push(diagnostics);
  context.subscriptions.push({ dispose: () => sidebar.dispose() });
  context.subscriptions.push({ dispose: () => logger.dispose() });
  context.subscriptions.push(installProjectProfileCacheInvalidation());
  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      clearProjectProfileCache();
      indexer.clear();
      indexedRoots.clear();
    })
  );
  context.subscriptions.push(installIndexWatchers(indexer, logger));
  context.subscriptions.push(
    sidebar.onDidResolve(() => {
      const folder = vscode.workspace.workspaceFolders?.[0];
      if (folder) {
        void ensureIndexed(folder.uri.fsPath);
      }
    })
  );

  registerCognitionCommands(context, { indexer, logger });
  const hoverProvider = registerMergeCoreHoverProvider(context, {
    indexer,
    explainer,
    ensureIndexed,
    isModelExplanationEnabled,
  });
  registerHoverCommands(context, {
    indexer,
    explainer,
    getMode: () => readExplanationMode(),
    isModelExplanationEnabled,
    globalState: context.globalState,
  });
  registerExplainSelectedCode(context, {
    indexer,
    ensureIndexed,
    modelPorts,
    isModelExplanationEnabled,
    globalState: context.globalState,
  });
  registerMemoryCommands(context);
  registerGenerateTaskContext(context, {
    indexer,
    ensureIndexed,
    modelPorts,
    isModelExplanationEnabled,
    globalState: context.globalState,
  });
  context.subscriptions.push({
    dispose: () => hoverProvider.clearCache(),
  });
  // Invalidate hover cache when watched files change through the indexer
  context.subscriptions.push(
    indexer.onStatusDetail((status) => {
      if (status.phase === 'done') {
        hoverProvider.clearCache();
      }
    })
  );
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
  registerCopyMcpConfig(context);
  registerPrivacyCommands({
    context,
    indexer,
    secrets,
    logger,
  });

  const provider = vscode.window.registerWebviewViewProvider(MergeCoreSidebarProvider.viewId, sidebar, {
    webviewOptions: {
      retainContextWhenHidden: true,
    },
  });
  context.subscriptions.push(provider);

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
