import * as vscode from 'vscode';
import { ReviewCodeUseCase } from '../../application/review-code.use-case';
import type { ReviewRequest, ReviewResult } from '../../domain/review-types';
import { GitDiffService } from '../../infrastructure/git-diff.service';
import { getProjectProfileCached } from '../../infrastructure/project-profile-cache';
import { PatchApplier } from '../../infrastructure/patch-applier';
import { buildReviewDisplayInfo } from '../webview/review-display-context';
import { formatReviewAsMarkdown } from '../webview/review-markdown';
import { FindingDiagnostics } from '../diagnostics/finding-diagnostics';
import { ReviewSessionState } from '../state/review-session.state';
import type { MergeCoreSidebarProvider } from '../webview/mergecore-sidebar.provider';

export function registerMergeCoreCommands(
  context: vscode.ExtensionContext,
  deps: {
    review: ReviewCodeUseCase;
    gitDiff: GitDiffService;
    diagnostics: FindingDiagnostics;
    session: ReviewSessionState;
    sidebar: MergeCoreSidebarProvider;
    patchApplier: PatchApplier;
  }
): void {
  const { review, gitDiff, session, patchApplier } = deps;

  const run = async (factory: () => Promise<{ request: ReviewRequest; document: vscode.TextDocument } | undefined>) => {
    try {
      const built = await factory();
      if (!built) {
        return;
      }
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'MergeCore: reviewing…',
          cancellable: false,
        },
        async () => {
          const result = await review.execute(built.request);
          await publishResult(result, built.document, built.request, deps);
        }
      );
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      void vscode.window.showErrorMessage(`MergeCore: ${message}`);
    }
  };

  context.subscriptions.push(
    vscode.commands.registerCommand('mergecore.reviewSelection', () =>
      run(async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
          void vscode.window.showWarningMessage('MergeCore: no active editor.');
          return undefined;
        }
        const selection = editor.selection;
        if (selection.isEmpty) {
          void vscode.window.showWarningMessage('MergeCore: select code to review.');
          return undefined;
        }
        const text = editor.document.getText(selection);
        const request = await buildRequest(editor.document, 'selection', editor.document.uri.fsPath, text, text);
        return { request, document: editor.document };
      })
    ),
    vscode.commands.registerCommand('mergecore.reviewFile', () =>
      run(async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
          void vscode.window.showWarningMessage('MergeCore: no active editor.');
          return undefined;
        }
        const doc = editor.document;
        const request = await buildRequest(doc, 'file', doc.fileName, doc.getText(), undefined);
        return { request, document: doc };
      })
    ),
    vscode.commands.registerCommand('mergecore.reviewGitDiff', () =>
      run(async () => {
        const editor = vscode.window.activeTextEditor;
        const folder = vscode.workspace.workspaceFolders?.[0];
        if (!folder) {
          void vscode.window.showWarningMessage('MergeCore: open a workspace folder first.');
          return undefined;
        }
        const diffText = await gitDiff.readDiff(folder.uri.fsPath, 'working');
        if (!diffText.trim()) {
          void vscode.window.showInformationMessage('MergeCore: git diff is empty.');
          return undefined;
        }
        const pathLabel = editor?.document.uri.fsPath ?? 'git-diff';
        const request = await buildGitDiffRequest(folder.uri.fsPath, pathLabel, diffText);
        const document = editor?.document ?? (await openVirtualDiffDoc(diffText));
        return { request, document };
      })
    ),
    vscode.commands.registerCommand('mergecore.reviewStagedDiff', () =>
      run(async () => {
        const editor = vscode.window.activeTextEditor;
        const folder = vscode.workspace.workspaceFolders?.[0];
        if (!folder) {
          void vscode.window.showWarningMessage('MergeCore: open a workspace folder first.');
          return undefined;
        }
        const diffText = await gitDiff.readDiff(folder.uri.fsPath, 'staged');
        if (!diffText.trim()) {
          void vscode.window.showInformationMessage('MergeCore: staged diff is empty.');
          return undefined;
        }
        const pathLabel = editor?.document.uri.fsPath ?? 'git-staged-diff';
        const request = await buildGitDiffRequest(folder.uri.fsPath, pathLabel, diffText);
        const document = editor?.document ?? (await openVirtualDiffDoc(diffText));
        return { request, document };
      })
    ),
    vscode.commands.registerCommand('mergecore.showSidebar', async () => {
      await vscode.commands.executeCommand('workbench.view.extension.mergecore');
    }),
    vscode.commands.registerCommand('mergecore.exportReviewMarkdown', async () => {
      const snap = session.getSnapshot();
      if (!snap?.result) {
        void vscode.window.showWarningMessage('MergeCore: run a review before exporting.');
        return;
      }
      const md = formatReviewAsMarkdown(snap.result);
      await vscode.env.clipboard.writeText(md);
      void vscode.window.showInformationMessage('MergeCore: report copied to clipboard.');
    }),
    vscode.commands.registerCommand('mergecore.applyImprovedCode', async () => {
      const snap = session.getSnapshot();
      const editor = vscode.window.activeTextEditor;
      if (!snap?.result.improvedCode) {
        void vscode.window.showWarningMessage('MergeCore: no improved code to apply.');
        return;
      }
      const doc = await pickTargetDocument(snap.target, editor);
      if (!doc) {
        return;
      }
      try {
        await patchApplier.replaceFullDocument(doc, snap.result.improvedCode);
        void vscode.window.showInformationMessage('MergeCore: applied improved code.');
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        void vscode.window.showErrorMessage(message);
      }
    }),
    vscode.commands.registerCommand('mergecore.applyPatch', async () => {
      const snap = session.getSnapshot();
      const editor = vscode.window.activeTextEditor;
      if (!snap?.result.patch) {
        void vscode.window.showWarningMessage('MergeCore: no patch to apply.');
        return;
      }
      const doc = await pickTargetDocument(snap.target, editor);
      if (!doc) {
        return;
      }
      try {
        await patchApplier.applyUnifiedPatch(doc, snap.result.patch);
        void vscode.window.showInformationMessage('MergeCore: applied patch.');
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        void vscode.window.showErrorMessage(message);
      }
    })
  );
}

async function publishResult(
  result: ReviewResult,
  document: vscode.TextDocument,
  request: ReviewRequest,
  deps: {
    diagnostics: FindingDiagnostics;
    session: ReviewSessionState;
    sidebar: MergeCoreSidebarProvider;
  }
): Promise<void> {
  deps.session.set(result, document.uri);
  deps.diagnostics.setForDocument(document, result.findings);
  await deps.sidebar.showResult(result, buildReviewDisplayInfo(request));
}

async function buildRequest(
  doc: vscode.TextDocument,
  scope: ReviewRequest['scope'],
  label: string,
  content: string,
  selectionSnippet: string | undefined
): Promise<ReviewRequest> {
  const workspaceRoot = vscode.workspace.getWorkspaceFolder(doc.uri)?.uri.fsPath;
  const projectProfile = workspaceRoot ? await getProjectProfileCached(workspaceRoot) : undefined;
  return {
    scope,
    workspaceRoot,
    projectProfile,
    filePath: doc.uri.fsPath,
    languageId: doc.languageId,
    label,
    content,
    selectionSnippet,
  };
}

async function buildGitDiffRequest(
  workspaceRoot: string,
  label: string,
  diffText: string
): Promise<ReviewRequest> {
  const projectProfile = await getProjectProfileCached(workspaceRoot);
  return {
    scope: 'git-diff',
    workspaceRoot,
    projectProfile,
    filePath: label,
    languageId: 'diff',
    label,
    content: diffText,
  };
}

async function openVirtualDiffDoc(diffText: string): Promise<vscode.TextDocument> {
  const doc = await vscode.workspace.openTextDocument({
    content: diffText,
    language: 'diff',
  });
  await vscode.window.showTextDocument(doc, { preview: true, preserveFocus: true });
  return doc;
}

async function pickTargetDocument(
  preferred: vscode.Uri,
  editor: vscode.TextEditor | undefined
): Promise<vscode.TextDocument | undefined> {
  if (editor && editor.document.uri.toString() === preferred.toString()) {
    return editor.document;
  }
  const doc = await vscode.workspace.openTextDocument(preferred);
  await vscode.window.showTextDocument(doc);
  return doc;
}
