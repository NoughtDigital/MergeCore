import * as vscode from 'vscode';
import {
  REVIEW_LEVELS,
  commandIdForReviewLevel,
  isReviewLevelId,
} from '../../domain/review-levels';

/**
 * Shared message-channel wiring for both the sidebar view and the fallback
 * editor panel. Having one helper stops the two call sites from drifting and
 * quietly exposing different command surfaces to the webview.
 *
 * The message contract is intentionally small and forward-compatible: any
 * unknown `type` is dropped silently so older webviews can coexist with a
 * newer host, and new messages (e.g. per-level run state) can be added
 * without touching every surface that renders review results.
 */
export function registerReviewWebviewMessages(
  webview: vscode.Webview,
  disposables: vscode.Disposable[]
): void {
  // Push the canonical review-level list as soon as the webview is ready.
  // Sending it twice is harmless (the client just re-renders); missing it
  // once is survivable because the client also requests it on load.
  void postReviewLevels(webview);

  const sub = webview.onDidReceiveMessage(async (msg) => {
    if (!msg || typeof msg !== 'object') {
      return;
    }
    const type = (msg as { type?: unknown }).type;
    switch (type) {
      case 'applyImproved':
        await vscode.commands.executeCommand('mergecore.applyImprovedCode');
        return;
      case 'applyPatch':
        await vscode.commands.executeCommand('mergecore.applyPatch');
        return;
      case 'exportMarkdown':
        await vscode.commands.executeCommand('mergecore.exportReviewMarkdown');
        return;
      case 'requestReviewLevels':
        await postReviewLevels(webview);
        return;
      case 'runReviewLevel': {
        const raw = (msg as { levelId?: unknown }).levelId;
        if (typeof raw !== 'string' || !isReviewLevelId(raw)) {
          return;
        }
        await vscode.commands.executeCommand(commandIdForReviewLevel(raw));
        return;
      }
      default:
        return;
    }
  });
  disposables.push(sub);
}

async function postReviewLevels(webview: vscode.Webview): Promise<void> {
  const payload = REVIEW_LEVELS.map((l) => ({
    id: l.id,
    title: l.title,
    tagline: l.tagline,
    badge: l.badge,
  }));
  await webview.postMessage({ type: 'reviewLevels', payload });
}
