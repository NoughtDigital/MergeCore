import { applyPatch } from 'diff';
import * as vscode from 'vscode';

const MAX_PATCH_BYTES = 400_000;
const MAX_DOCUMENT_BYTES = 2_000_000;

export class PatchApplier {
  /**
   * Apply a unified diff to `document` and return the resulting full text without
   * yet writing it. Splitting this from `commitText` lets the caller show a
   * diff-preview confirmation before touching the editor.
   */
  previewUnifiedPatch(document: vscode.TextDocument, patch: string): string {
    if (patch.length > MAX_PATCH_BYTES) {
      throw new Error(`Patch is larger than the ${MAX_PATCH_BYTES} byte limit.`);
    }
    const current = document.getText();
    if (current.length > MAX_DOCUMENT_BYTES) {
      throw new Error('Target document is too large for safe patching.');
    }
    const next = applyPatch(current, patch);
    if (next === false) {
      throw new Error('Patch did not apply cleanly to the current file.');
    }
    return next;
  }

  async commitText(document: vscode.TextDocument, text: string): Promise<void> {
    if (text.length > MAX_DOCUMENT_BYTES) {
      throw new Error('Proposed content is too large to apply safely.');
    }
    const edit = new vscode.WorkspaceEdit();
    edit.replace(document.uri, fullDocumentRange(document), text);
    const applied = await vscode.workspace.applyEdit(edit);
    if (!applied) {
      throw new Error('Workspace edit was not applied.');
    }
  }
}

function fullDocumentRange(document: vscode.TextDocument): vscode.Range {
  const last = document.lineCount - 1;
  const end = document.lineAt(last).range.end;
  return new vscode.Range(new vscode.Position(0, 0), end);
}
