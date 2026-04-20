import * as vscode from 'vscode';
import {
  clearProjectProfileCache,
  installProjectProfileCacheInvalidation,
} from './infrastructure/project-profile-cache';
import { ReviewCodeUseCase } from './application/review-code.use-case';
import { GitDiffService } from './infrastructure/git-diff.service';
import { MergeCoreLogger } from './infrastructure/logger';
import { MergeCoreReviewAdapter } from './infrastructure/mergecore-review.adapter';
import { MockReviewEngine } from './infrastructure/mock-review.engine';
import { PatchApplier } from './infrastructure/patch-applier';
import { RequestThrottle } from './infrastructure/request-throttle';
import { MergeCoreSecretStore, migrateTokenFromSettingsIfAny } from './infrastructure/secret-store';
import { registerMergeCoreCommands } from './presentation/commands/register-commands';
import { FindingDiagnostics } from './presentation/diagnostics/finding-diagnostics';
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

  const provider = vscode.window.registerWebviewViewProvider(MergeCoreSidebarProvider.viewId, sidebar, {
    webviewOptions: {
      retainContextWhenHidden: true,
    },
  });
  context.subscriptions.push(provider);

  registerMergeCoreStatusBar(context);

  logger.info('MergeCore ready.');
}
