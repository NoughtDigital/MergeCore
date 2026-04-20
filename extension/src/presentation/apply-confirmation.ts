import * as vscode from 'vscode';

/**
 * Before overwriting a document with AI-suggested content we show a native
 * diff preview and force the user to click "Apply" again. That way a hostile
 * or glitchy API response cannot silently replace a file, and the user can
 * always review what changed.
 */
export interface ApplyConfirmationOptions {
  readonly target: vscode.TextDocument;
  readonly proposedContent: string;
  readonly label: string;
  readonly kind: 'improved' | 'patch-result';
}

const MAX_DIFF_PREVIEW_BYTES = 1_500_000;

export async function confirmApplyWithDiff(opts: ApplyConfirmationOptions): Promise<boolean> {
  const { target, proposedContent, label, kind } = opts;

  const before = target.getText();
  if (proposedContent === before) {
    void vscode.window.showInformationMessage('MergeCore: proposed content matches the current file; nothing to apply.');
    return false;
  }

  if (proposedContent.length > MAX_DIFF_PREVIEW_BYTES) {
    const confirmLarge = 'Apply without preview';
    const cancel = 'Cancel';
    const choice = await vscode.window.showWarningMessage(
      `MergeCore: the ${kind === 'improved' ? 'rewrite' : 'patched result'} is very large (${formatBytes(proposedContent.length)}). Applying without a diff preview.`,
      { modal: true },
      confirmLarge,
      cancel
    );
    return choice === confirmLarge;
  }

  const proposedDoc = await vscode.workspace.openTextDocument({
    content: proposedContent,
    language: target.languageId,
  });

  const title =
    kind === 'improved'
      ? `MergeCore rewrite preview: ${label}`
      : `MergeCore patched preview: ${label}`;

  await vscode.commands.executeCommand(
    'vscode.diff',
    target.uri,
    proposedDoc.uri,
    title,
    { preview: true, preserveFocus: false }
  );

  const apply = 'Apply';
  const cancel = 'Cancel';
  const choice = await vscode.window.showInformationMessage(
    `Apply MergeCore ${kind === 'improved' ? 'rewrite' : 'patch'} to ${label}?`,
    { modal: true, detail: 'Use Cmd/Ctrl+Z after applying to revert.' },
    apply,
    cancel
  );
  return choice === apply;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
