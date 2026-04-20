import * as vscode from 'vscode';
import type { ReviewDisplayInfo } from './review-display-context';
import { buildReviewPanelHtml } from './review-webview-html';
import type { ReviewResult } from '../../domain/review-types';
import type { ScoreInsight } from './score-insight';
import { registerReviewWebviewMessages } from './webview-messages';

export type ReviewWebviewPayload = ReviewResult & { display: ReviewDisplayInfo; scoreInsight: ScoreInsight };

let currentPanel: vscode.WebviewPanel | undefined;
let currentDisposables: vscode.Disposable[] = [];

/**
 * When the activity-bar webview view never attaches (some hosts), show the same UI in an editor-area tab.
 */
export function showReviewFallbackPanel(
  extensionUri: vscode.Uri,
  assetVersion: string,
  payload: ReviewWebviewPayload
): void {
  currentPanel?.dispose();
  while (currentDisposables.length > 0) {
    currentDisposables.pop()?.dispose();
  }

  const panel = vscode.window.createWebviewPanel(
    'mergecore.review',
    'MergeCore Review',
    { viewColumn: vscode.ViewColumn.Beside, preserveFocus: false },
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')],
    }
  );
  currentPanel = panel;
  currentDisposables = [];

  panel.webview.html = buildReviewPanelHtml(panel.webview, extensionUri, assetVersion);

  registerReviewWebviewMessages(panel.webview, currentDisposables);

  void panel.webview.postMessage({ type: 'review', payload });

  panel.onDidDispose(() => {
    if (currentPanel === panel) {
      currentPanel = undefined;
      while (currentDisposables.length > 0) {
        currentDisposables.pop()?.dispose();
      }
    }
  });
}
