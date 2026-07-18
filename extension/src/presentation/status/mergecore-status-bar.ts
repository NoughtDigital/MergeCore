import * as vscode from 'vscode';
import type { IndexerService } from '../../infrastructure/index/indexer.service';

const REVIEWABLE_LANGUAGES = new Set([
  'php',
  'blade',
  'typescript',
  'typescriptreact',
  'javascript',
  'javascriptreact',
  'vue',
  'python',
  'go',
  'swift',
  'rust',
  'ruby',
  'java',
  'kotlin',
  'csharp',
  'markdown',
]);

export interface StatusBarHandle {
  setMessage: (message: string, busy: boolean) => void;
}

export function registerMergeCoreStatusBar(
  context: vscode.ExtensionContext,
  indexer?: IndexerService
): StatusBarHandle {
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 52);
  item.command = 'mergecore.indexRepository';
  item.text = '$(book) MergeCore';
  item.tooltip =
    'MergeCore — local repository cognition. Click to index. Run “MergeCore: Show Privacy Status” to see where data lives.';

  let lastMessage = 'MergeCore';
  let busy = false;

  const render = (): void => {
    item.text = busy ? `$(sync~spin) ${lastMessage}` : `$(book) ${lastMessage}`;
  };

  const refresh = (): void => {
    const doc = vscode.window.activeTextEditor?.document;
    const id = doc?.languageId;
    if (id && REVIEWABLE_LANGUAGES.has(id)) {
      item.show();
    } else if (busy) {
      item.show();
    } else {
      item.hide();
    }
  };

  const setMessage = (message: string, isBusy: boolean): void => {
    lastMessage = message.length > 40 ? `${message.slice(0, 37)}…` : message;
    busy = isBusy;
    render();
    refresh();
  };

  if (indexer) {
    context.subscriptions.push(
      indexer.onStatus((message, isBusy) => {
        setMessage(message, isBusy);
      })
    );
  }

  render();
  refresh();
  context.subscriptions.push(item);
  context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(() => refresh()));

  return { setMessage };
}
