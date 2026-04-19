import * as vscode from 'vscode';

const PHP_LIKE = new Set(['php', 'blade']);

export function registerMergeCoreStatusBar(context: vscode.ExtensionContext): void {
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 52);
  item.command = 'mergecore.showSidebar';
  item.text = '$(checklist) MergeCore';
  item.tooltip =
    'Open MergeCore Review (left activity bar). Laravel-first AI review — not the Problems panel.';

  const refresh = (): void => {
    const doc = vscode.window.activeTextEditor?.document;
    const id = doc?.languageId;
    if (id && PHP_LIKE.has(id)) {
      item.show();
    } else {
      item.hide();
    }
  };

  refresh();
  context.subscriptions.push(item);
  context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(() => refresh()));
}
