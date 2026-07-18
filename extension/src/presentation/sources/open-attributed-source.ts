import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';
import {
  createSourceReference,
  inspectSourceReference,
  sha256,
  sourceRangeForReveal,
  type SourceReference,
} from '@mergecore/intelligence';

export interface OpenAttributedSourceArgs {
  readonly workspaceRoot: string;
  readonly workspaceId?: string;
  readonly path: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly startColumn?: number;
  readonly endColumn?: number;
  readonly sourceFingerprint?: string;
  readonly sourceType?: SourceReference['sourceType'];
}

/**
 * Open a SourceReference in the editor, reveal its range, and surface stale/missing status.
 */
export async function openAttributedSource(args: OpenAttributedSourceArgs): Promise<void> {
  const folders = vscode.workspace.workspaceFolders ?? [];
  const roots =
    folders.length > 0
      ? folders.map((f) => ({
          workspaceId: sha256(f.uri.fsPath).slice(0, 16),
          rootPath: f.uri.fsPath,
        }))
      : [
          {
            workspaceId: args.workspaceId ?? sha256(args.workspaceRoot).slice(0, 16),
            rootPath: args.workspaceRoot,
          },
        ];

  const ref = createSourceReference({
    workspaceId: args.workspaceId ?? roots[0]!.workspaceId,
    path: args.path,
    startLine: args.startLine,
    endLine: args.endLine,
    startColumn: args.startColumn,
    endColumn: args.endColumn,
    sourceType: args.sourceType ?? 'source',
    sourceFingerprint: args.sourceFingerprint ?? '',
  });

  const inspection = await inspectSourceReference(roots, ref, {
    exists: async (absolutePath) => {
      try {
        await fs.access(absolutePath);
        return true;
      } catch {
        return false;
      }
    },
    fingerprint: async (absolutePath) => {
      try {
        const text = await fs.readFile(absolutePath, 'utf8');
        return sha256(text);
      } catch {
        return undefined;
      }
    },
  });

  if (inspection.status === 'missing' || inspection.status === 'wrong_workspace') {
    void vscode.window.showWarningMessage(
      inspection.message ?? `Could not open source ${args.path}`
    );
    return;
  }

  if (inspection.status === 'stale') {
    void vscode.window.showWarningMessage(
      inspection.message ?? `Stale source evidence for ${args.path}`
    );
  }

  const abs =
    inspection.absolutePath ??
    (path.isAbsolute(args.path) ? args.path : path.join(args.workspaceRoot, args.path));
  const uri = vscode.Uri.file(abs);
  let doc: vscode.TextDocument;
  try {
    doc = await vscode.workspace.openTextDocument(uri);
  } catch {
    void vscode.window.showWarningMessage(`Could not open ${abs}`);
    return;
  }
  const editor = await vscode.window.showTextDocument(doc, { preview: true });
  const range = sourceRangeForReveal(ref);
  const start = new vscode.Position(
    Math.max(0, range.startLine - 1),
    Math.max(0, range.startColumn - 1)
  );
  const endLine = Math.max(0, range.endLine - 1);
  const endCol =
    range.endColumn > 1
      ? Math.max(0, range.endColumn - 1)
      : doc.lineAt(Math.min(endLine, doc.lineCount - 1)).text.length;
  const end = new vscode.Position(endLine, endCol);
  editor.selection = new vscode.Selection(start, end);
  editor.revealRange(new vscode.Range(start, end), vscode.TextEditorRevealType.InCenter);
}
