import * as vscode from 'vscode';
import type { PrivacyStatusSnapshot } from '../../infrastructure/privacy/privacy-status';
import { formatBytes, formatPrivacyStatusMarkdown } from '../../infrastructure/privacy/privacy-status';

export async function showPrivacyStatusPanel(
  snapshot: PrivacyStatusSnapshot
): Promise<void> {
  const markdown = formatPrivacyStatusMarkdown(snapshot);
  const doc = await vscode.workspace.openTextDocument({
    content: markdown,
    language: 'markdown',
  });
  await vscode.window.showTextDocument(doc, {
    preview: true,
    viewColumn: vscode.ViewColumn.Beside,
  });
}

export function privacyStatusQuickSummary(snapshot: PrivacyStatusSnapshot): string {
  const size =
    snapshot.indexSizeBytes === null ? '?' : formatBytes(snapshot.indexSizeBytes);
  return `MergeCore · ${snapshot.indexedFileCount} files · index ${size} · external ${
    snapshot.externalRequestsEnabled ? 'on' : 'off'
  } · provider ${snapshot.providerConfigured}`;
}
