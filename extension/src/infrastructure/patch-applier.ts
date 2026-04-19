import { applyPatch } from 'diff';
import * as vscode from 'vscode';

export class PatchApplier {
  async applyUnifiedPatch(document: vscode.TextDocument, patch: string): Promise<void> {
    const current = document.getText();
    const next = applyPatch(current, patch);
    if (next === false) {
      throw new Error('Patch did not apply cleanly to the current file.');
    }
    const edit = new vscode.WorkspaceEdit();
    const fullRange = fullDocumentRange(document);
    edit.replace(document.uri, fullRange, next);
    const applied = await vscode.workspace.applyEdit(edit);
    if (!applied) {
      throw new Error('Workspace edit was not applied.');
    }
  }

  async replaceFullDocument(document: vscode.TextDocument, text: string): Promise<void> {
    const edit = new vscode.WorkspaceEdit();
    edit.replace(document.uri, fullDocumentRange(document), text);
    const applied = await vscode.workspace.applyEdit(edit);
    if (!applied) {
      throw new Error('Could not replace document contents.');
    }
  }
}

function fullDocumentRange(document: vscode.TextDocument): vscode.Range {
  const last = document.lineCount - 1;
  const end = document.lineAt(last).range.end;
  return new vscode.Range(new vscode.Position(0, 0), end);
}
