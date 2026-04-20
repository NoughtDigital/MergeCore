import * as vscode from 'vscode';

/**
 * Shared message-channel wiring for both the sidebar view and the fallback
 * editor panel. Having one helper stops the two call sites from drifting and
 * quietly exposing different command surfaces to the webview.
 */
export function registerReviewWebviewMessages(
  webview: vscode.Webview,
  disposables: vscode.Disposable[]
): void {
  const sub = webview.onDidReceiveMessage(async (msg) => {
    if (!msg || typeof msg !== 'object') {
      return;
    }
    switch ((msg as { type?: unknown }).type) {
      case 'applyImproved':
        await vscode.commands.executeCommand('mergecore.applyImprovedCode');
        return;
      case 'applyPatch':
        await vscode.commands.executeCommand('mergecore.applyPatch');
        return;
      case 'exportMarkdown':
        await vscode.commands.executeCommand('mergecore.exportReviewMarkdown');
        return;
      default:
        return;
    }
  });
  disposables.push(sub);
}
