import * as vscode from 'vscode';
import type { ReviewResult } from '../../domain/review-types';
import type { ReviewDisplayInfo } from './review-display-context';
import { buildReviewPanelHtml } from './review-webview-html';
import { showReviewFallbackPanel, type ReviewWebviewPayload } from './review-fallback-panel';
import { buildScoreInsight } from './score-insight';

export class MergeCoreSidebarProvider implements vscode.WebviewViewProvider {
  static readonly viewId = 'mergecore.sidebar';

  private view: vscode.WebviewView | undefined;
  /** Last rendered review; replayed when the view becomes visible again after deallocation. */
  private lastReviewPayload: ReviewWebviewPayload | undefined;
  /** Set when a review finishes before the webview has been created (sidebar never opened). */
  private pendingReviewPayload: ReviewWebviewPayload | undefined;

  constructor(
    private readonly extensionUri: vscode.Uri,
    /** Bumped with each extension release so media URIs cache-bust when panel code changes. */
    private readonly assetVersion: string
  ) {}

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

    webviewView.onDidChangeVisibility(() => {
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
    });

    webviewView.webview.onDidReceiveMessage(async (msg) => {
      if (msg?.type === 'applyImproved') {
        await vscode.commands.executeCommand('mergecore.applyImprovedCode');
      }
      if (msg?.type === 'applyPatch') {
        await vscode.commands.executeCommand('mergecore.applyPatch');
      }
      if (msg?.type === 'exportMarkdown') {
        await vscode.commands.executeCommand('mergecore.exportReviewMarkdown');
      }
    });
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
    if (auto) {
      await this.revealMergeCoreActivity();
    }

    if (this.view && this.pendingReviewPayload) {
      this.flushPendingReview(this.view);
    } else if (this.pendingReviewPayload && auto) {
      setTimeout(() => {
        if (this.view && this.pendingReviewPayload) {
          this.flushPendingReview(this.view);
        }
      }, 200);
    }
    if (this.pendingReviewPayload) {
      void this.ensurePendingDelivered();
    }
  }

  /**
   * If the activity view still did not attach after a review, reveal again and prompt once.
   */
  private async ensurePendingDelivered(): Promise<void> {
    await new Promise((r) => setTimeout(r, 450));
    if (!this.pendingReviewPayload) {
      return;
    }
    if (this.view) {
      this.flushPendingReview(this.view);
      return;
    }
    if (!this.isReviewPanelAutomationEnabled()) {
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
      return;
    }
    await this.revealMergeCoreActivity();
    if (this.view && this.pendingReviewPayload) {
      this.flushPendingReview(this.view);
      return;
    }
    const stuck = this.pendingReviewPayload;
    this.pendingReviewPayload = undefined;

    if (this.isEditorTabFallbackEnabled()) {
      showReviewFallbackPanel(this.extensionUri, this.assetVersion, stuck);
      void vscode.window.showInformationMessage(
        'MergeCore: opened this review in a beside tab (activity-bar Review view was not available).'
      );
      return;
    }

    void vscode.window.showWarningMessage(
      'MergeCore: Review panel did not open. Click the MergeCore icon in the activity bar, or run "MergeCore: Open Review Panel".'
    );
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
