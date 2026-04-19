import * as vscode from 'vscode';
import type { ReviewDisplayInfo } from './review-display-context';
import { buildReviewPanelHtml } from './review-webview-html';
import type { ReviewResult } from '../../domain/review-types';
import type { ScoreInsight } from './score-insight';

export type ReviewWebviewPayload = ReviewResult & { display: ReviewDisplayInfo; scoreInsight: ScoreInsight };

let currentPanel: vscode.WebviewPanel | undefined;

/**
 * When the activity-bar webview view never attaches (some hosts), show the same UI in an editor-area tab.
 */
export function showReviewFallbackPanel(
  extensionUri: vscode.Uri,
  assetVersion: string,
  payload: ReviewWebviewPayload
): void {
  currentPanel?.dispose();

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

  panel.webview.html = buildReviewPanelHtml(panel.webview, extensionUri, assetVersion);

  panel.webview.onDidReceiveMessage(async (msg) => {
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

  void panel.webview.postMessage({ type: 'review', payload });

  panel.onDidDispose(() => {
    if (currentPanel === panel) {
      currentPanel = undefined;
    }
  });
}
