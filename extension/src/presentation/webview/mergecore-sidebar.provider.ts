import * as vscode from 'vscode';
import type { ReviewResult } from '../../domain/review-types';
import type { ReviewDisplayInfo } from './review-display-context';
import { buildReviewPanelHtml } from './review-webview-html';
import { showReviewFallbackPanel, type ReviewWebviewPayload } from './review-fallback-panel';
import { buildScoreInsight } from './score-insight';
import { registerReviewWebviewMessages } from './webview-messages';

type PendingResolver = (view: vscode.WebviewView | undefined) => void;

export class MergeCoreSidebarProvider implements vscode.WebviewViewProvider {
  static readonly viewId = 'mergecore.sidebar';

  private view: vscode.WebviewView | undefined;
  /** Last rendered review; replayed when the view becomes visible again after deallocation. */
  private lastReviewPayload: ReviewWebviewPayload | undefined;
  /** Set when a review finishes before the webview has been created (sidebar never opened). */
  private pendingReviewPayload: ReviewWebviewPayload | undefined;
  /** Resolvers waiting for the webview to attach; resolved from `resolveWebviewView`. */
  private readonly viewReadyResolvers: PendingResolver[] = [];
  private readonly disposables: vscode.Disposable[] = [];
  private onResolveHook: (() => void) | undefined;

  constructor(
    private readonly extensionUri: vscode.Uri,
    /** Bumped with each extension release so media URIs cache-bust when panel code changes. */
    private readonly assetVersion: string
  ) {}

  /** Invoked once when the sidebar webview is first resolved (e.g. to defer indexing). */
  onDidResolve(hook: () => void): vscode.Disposable {
    this.onResolveHook = hook;
    return {
      dispose: () => {
        if (this.onResolveHook === hook) {
          this.onResolveHook = undefined;
        }
      },
    };
  }

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'media')],
    };

    webviewView.webview.html = buildReviewPanelHtml(webviewView.webview, this.extensionUri, this.assetVersion);

    this.flushPendingReview(webviewView);
    this.flushViewReadyResolvers(webviewView);
    this.onResolveHook?.();

    webviewView.onDidDispose(
      () => {
        if (this.view === webviewView) {
          this.view = undefined;
        }
      },
      undefined,
      this.disposables
    );

    webviewView.onDidChangeVisibility(
      () => {
        if (!this.isReviewPanelAutomationEnabled()) {
          return;
        }
        if (!webviewView.visible || !this.lastReviewPayload) {
          return;
        }
        void webviewView.webview.postMessage({
          type: 'review',
          payload: this.lastReviewPayload,
        });
      },
      undefined,
      this.disposables
    );

    registerReviewWebviewMessages(webviewView.webview, this.disposables);
  }

  async showResult(result: ReviewResult, display: ReviewDisplayInfo): Promise<void> {
    const payload: ReviewWebviewPayload = { ...result, display, scoreInsight: buildScoreInsight(result) };
    this.lastReviewPayload = payload;

    if (this.view) {
      void this.view.webview.postMessage({ type: 'review', payload });
      if (this.isReviewPanelAutomationEnabled()) {
        this.view.show(false);
      }
      return;
    }

    this.pendingReviewPayload = payload;
    const auto = this.isReviewPanelAutomationEnabled();

    if (!auto) {
      this.promptUserToOpenPanel();
      return;
    }

    await this.revealMergeCoreActivity();
    const view = await this.waitForView(700);

    if (view && this.pendingReviewPayload) {
      this.flushPendingReview(view);
      return;
    }

    if (this.pendingReviewPayload && this.isEditorTabFallbackEnabled()) {
      const stuck = this.pendingReviewPayload;
      this.pendingReviewPayload = undefined;
      showReviewFallbackPanel(this.extensionUri, this.assetVersion, stuck);
      void vscode.window.showInformationMessage(
        'MergeCore: opened this review in a beside tab (activity-bar Review view was not available).'
      );
      return;
    }

    if (this.pendingReviewPayload) {
      void vscode.window.showWarningMessage(
        'MergeCore: Review panel did not open. Click the MergeCore icon in the activity bar, or run "MergeCore: Open Review Panel".'
      );
    }
  }

  /** Notify the sidebar so level buttons leave/enter the in-flight disabled state. */
  async setReviewRunning(running: boolean): Promise<void> {
    if (!this.view) {
      return;
    }
    await this.view.webview.postMessage({
      type: 'reviewState',
      payload: { running },
    });
  }

  dispose(): void {
    while (this.disposables.length > 0) {
      this.disposables.pop()?.dispose();
    }
    this.viewReadyResolvers.splice(0).forEach((r) => r(undefined));
  }

  private waitForView(timeoutMs: number): Promise<vscode.WebviewView | undefined> {
    if (this.view) {
      return Promise.resolve(this.view);
    }
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        const idx = this.viewReadyResolvers.indexOf(resolver);
        if (idx >= 0) {
          this.viewReadyResolvers.splice(idx, 1);
        }
        resolve(undefined);
      }, timeoutMs);
      const resolver: PendingResolver = (view) => {
        clearTimeout(timer);
        resolve(view);
      };
      this.viewReadyResolvers.push(resolver);
    });
  }

  private flushViewReadyResolvers(view: vscode.WebviewView): void {
    const resolvers = this.viewReadyResolvers.splice(0);
    for (const r of resolvers) {
      r(view);
    }
  }

  private promptUserToOpenPanel(): void {
    void vscode.window
      .showInformationMessage(
        'MergeCore: review finished. Open the MergeCore icon in the activity bar (left) to see results.',
        'Open MergeCore'
      )
      .then((choice) => {
        if (choice === 'Open MergeCore') {
          void this.revealMergeCoreActivity();
        }
      });
  }

  private async revealMergeCoreActivity(): Promise<void> {
    const ids = [
      'workbench.view.extension.mergecore',
      `${MergeCoreSidebarProvider.viewId}.focus`,
      'mergecore.showSidebar',
    ];
    for (const id of ids) {
      try {
        await vscode.commands.executeCommand(id);
        return;
      } catch {
        /* try next */
      }
    }
  }

  private flushPendingReview(webviewView: vscode.WebviewView): void {
    if (!this.pendingReviewPayload) {
      return;
    }
    void webviewView.webview.postMessage({
      type: 'review',
      payload: this.pendingReviewPayload,
    });
    this.pendingReviewPayload = undefined;
    if (this.isReviewPanelAutomationEnabled()) {
      webviewView.show(false);
    }
  }

  private isReviewPanelAutomationEnabled(): boolean {
    return vscode.workspace
      .getConfiguration()
      .get<boolean>('mergecore.reviewPanel.automation', true);
  }

  private isEditorTabFallbackEnabled(): boolean {
    return vscode.workspace
      .getConfiguration()
      .get<boolean>('mergecore.reviewPanel.editorTabFallback', true);
  }
}
