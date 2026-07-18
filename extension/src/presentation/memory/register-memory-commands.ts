import * as path from 'path';
import * as vscode from 'vscode';
import {
  initialiseMergeCoreMemory,
  listGeneratedMemoryFiles,
  parseMemoryDocument,
  refreshStaleMemory,
  updateMemoryStatusOnDisk,
  MEMORY_DIR,
  type MemoryStatus,
} from '@mergecore/intelligence';

export const MEMORY_COMMANDS = {
  initialise: 'mergecore.memory.initialise',
  review: 'mergecore.memory.review',
  approve: 'mergecore.memory.approve',
  reject: 'mergecore.memory.reject',
  refreshStale: 'mergecore.memory.refreshStale',
  openFolder: 'mergecore.memory.openFolder',
} as const;

function workspaceRoot(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

async function pickGeneratedMemory(
  root: string,
  title: string
): Promise<string | undefined> {
  const files = await listGeneratedMemoryFiles(root);
  if (files.length === 0) {
    void vscode.window.showInformationMessage(
      'No generated memory documents found under .mergecore/generated/memory/.'
    );
    return undefined;
  }
  const picked = await vscode.window.showQuickPick(
    files.map((f) => ({ label: f, description: path.basename(f) })),
    { title, placeHolder: 'Select a generated memory document' }
  );
  return picked?.label;
}

async function setStatus(
  root: string,
  status: Extract<MemoryStatus, 'approved' | 'rejected' | 'reviewed'>
): Promise<void> {
  const rel = await pickGeneratedMemory(root, `MergeCore: mark memory ${status}`);
  if (!rel) return;
  const result = await updateMemoryStatusOnDisk(root, rel, status);
  if (!result.ok) {
    void vscode.window.showErrorMessage(
      `Could not update memory status: ${result.error ?? 'unknown'}`
    );
    return;
  }
  void vscode.window.showInformationMessage(`Memory marked ${status}: ${rel}`);
}

export function registerMemoryCommands(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(MEMORY_COMMANDS.initialise, async () => {
      if (!vscode.workspace.isTrusted) {
        void vscode.window.showErrorMessage(
          'MergeCore requires a trusted workspace to initialise memory.'
        );
        return;
      }
      const root = workspaceRoot();
      if (!root) {
        void vscode.window.showWarningMessage('Open a folder to initialise MergeCore memory.');
        return;
      }
      const result = await initialiseMergeCoreMemory(root);
      void vscode.window.showInformationMessage(
        `MergeCore memory ready (${result.created.length} created, ${result.skipped.length} kept).`
      );
      const memUri = vscode.Uri.file(path.join(root, MEMORY_DIR));
      await vscode.commands.executeCommand('revealFileInOS', memUri).then(
        () => undefined,
        async () => {
          await vscode.commands.executeCommand('revealInExplorer', memUri);
        }
      );
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(MEMORY_COMMANDS.review, async () => {
      const root = workspaceRoot();
      if (!root) return;
      const rel = await pickGeneratedMemory(root, 'MergeCore: Review Generated Memory');
      if (!rel) return;
      const uri = vscode.Uri.file(path.join(root, rel));
      const doc = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(doc, { preview: false });
      const text = doc.getText();
      const parsed = parseMemoryDocument(text);
      const status = parsed.frontmatter?.status ?? 'unknown';
      const sources = parsed.frontmatter?.sources.length ?? 0;
      const note = parsed.malformed
        ? `Malformed frontmatter: ${parsed.errors.join(', ')}`
        : `Status: ${status} · ${sources} source(s) · confidence ${parsed.frontmatter?.confidence ?? 'n/a'}`;
      const action = await vscode.window.showInformationMessage(
        note,
        'Mark reviewed',
        'Approve',
        'Reject'
      );
      if (action === 'Mark reviewed') {
        await updateMemoryStatusOnDisk(root, rel, 'reviewed');
      } else if (action === 'Approve') {
        await updateMemoryStatusOnDisk(root, rel, 'approved');
      } else if (action === 'Reject') {
        await updateMemoryStatusOnDisk(root, rel, 'rejected');
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(MEMORY_COMMANDS.approve, async () => {
      const root = workspaceRoot();
      if (!root) return;
      await setStatus(root, 'approved');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(MEMORY_COMMANDS.reject, async () => {
      const root = workspaceRoot();
      if (!root) return;
      await setStatus(root, 'rejected');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(MEMORY_COMMANDS.refreshStale, async () => {
      const root = workspaceRoot();
      if (!root) return;
      const mode = await vscode.window.showQuickPick(
        [
          {
            label: 'Mark stale only',
            description: 'Update status when sources changed or were deleted',
            id: 'mark' as const,
          },
          {
            label: 'Regenerate from surviving sources',
            description: 'Rewrite generated docs; delete if no sources remain',
            id: 'regen' as const,
          },
          {
            label: 'Delete stale memory',
            description: 'Remove stale generated documents',
            id: 'delete' as const,
          },
        ],
        { title: 'MergeCore: Refresh Stale Memory' }
      );
      if (!mode) return;

      const result = await refreshStaleMemory(root, {
        regenerate: mode.id === 'regen',
        deleteStale: mode.id === 'delete',
      });
      void vscode.window.showInformationMessage(
        `Stale: ${result.stale.length} · refreshed: ${result.refreshed.length} · deleted: ${result.deleted.length}`
      );
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(MEMORY_COMMANDS.openFolder, async () => {
      const root = workspaceRoot();
      if (!root) {
        void vscode.window.showWarningMessage('Open a folder first.');
        return;
      }
      const memUri = vscode.Uri.file(path.join(root, MEMORY_DIR));
      try {
        await vscode.workspace.fs.stat(memUri);
      } catch {
        await initialiseMergeCoreMemory(root);
      }
      await vscode.commands.executeCommand('revealFileInOS', memUri).then(
        () => undefined,
        async () => {
          const arch = vscode.Uri.file(path.join(root, MEMORY_DIR, 'architecture.md'));
          try {
            const doc = await vscode.workspace.openTextDocument(arch);
            await vscode.window.showTextDocument(doc);
          } catch {
            await vscode.commands.executeCommand('revealInExplorer', memUri);
          }
        }
      );
    })
  );
}
