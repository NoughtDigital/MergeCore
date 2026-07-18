import * as path from 'path';
import * as vscode from 'vscode';
import type { FileChange } from '@mergecore/intelligence';
import type { IndexerService } from './indexer.service';

/**
 * Watches saves and TS/JS/JSON/MD (plus PHP) globs across all workspace folders.
 *
 * Save events cover editor writes. FileSystemWatcher handles create/delete
 * so a single save does not enqueue the same path twice via both channels.
 */
export function installIndexWatchers(
  indexer: IndexerService,
  logger: { info: (m: string) => void; warn: (m: string) => void }
): vscode.Disposable {
  const pending = new Map<string, FileChange[]>();
  let timer: ReturnType<typeof setTimeout> | undefined;

  const schedule = (workspaceRoot: string, change: FileChange): void => {
    let list = pending.get(workspaceRoot);
    if (!list) {
      list = [];
      pending.set(workspaceRoot, list);
    }
    list.push(change);
    if (timer) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      void flush();
    }, 750);
  };

  const flush = async (): Promise<void> => {
    const batch = [...pending.entries()];
    pending.clear();
    for (const [root, changes] of batch) {
      try {
        await indexer.applyChanges(root, changes);
      } catch (err) {
        logger.warn(`Watcher index failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  };

  const onSave = vscode.workspace.onDidSaveTextDocument((doc) => {
    if (doc.uri.scheme !== 'file') {
      return;
    }
    const folder = vscode.workspace.getWorkspaceFolder(doc.uri);
    if (!folder) {
      return;
    }
    const rel = path.relative(folder.uri.fsPath, doc.uri.fsPath).replace(/\\/g, '/');
    if (!rel || rel.startsWith('..') || rel.includes('.mergecore/rag/')) {
      return;
    }
    if (!shouldWatch(rel, doc.languageId)) {
      return;
    }
    schedule(folder.uri.fsPath, { type: 'update', path: rel });
  });

  const watchers: vscode.FileSystemWatcher[] = [];
  const patterns = [
    '**/*.{ts,tsx,js,jsx,mjs,cjs,mts,cts}',
    '**/*.{json,md,markdown}',
    'app/**/*.php',
    'routes/**/*.php',
    'config/**/*.php',
  ];

  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    for (const pattern of patterns) {
      const watcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(folder, pattern)
      );
      const enqueueCreate = (uri: vscode.Uri): void => {
        const rel = path.relative(folder.uri.fsPath, uri.fsPath).replace(/\\/g, '/');
        if (rel && !rel.startsWith('..')) {
          schedule(folder.uri.fsPath, { type: 'create', path: rel });
        }
      };
      // Skip onDidChange — saves already cover in-editor edits.
      watcher.onDidCreate(enqueueCreate);
      watcher.onDidDelete((uri) => {
        const rel = path.relative(folder.uri.fsPath, uri.fsPath).replace(/\\/g, '/');
        if (rel && !rel.startsWith('..')) {
          schedule(folder.uri.fsPath, { type: 'delete', path: rel });
        }
      });
      watchers.push(watcher);
    }
  }

  return vscode.Disposable.from(onSave, ...watchers, {
    dispose: () => {
      if (timer) {
        clearTimeout(timer);
      }
    },
  });
}

function shouldWatch(rel: string, languageId: string): boolean {
  const lower = rel.toLowerCase();
  if (
    lower.endsWith('.ts') ||
    lower.endsWith('.tsx') ||
    lower.endsWith('.js') ||
    lower.endsWith('.jsx') ||
    lower.endsWith('.mjs') ||
    lower.endsWith('.cjs') ||
    lower.endsWith('.mts') ||
    lower.endsWith('.cts') ||
    lower.endsWith('.json') ||
    lower.endsWith('.md') ||
    lower.endsWith('.markdown') ||
    lower.endsWith('.php') ||
    lower.endsWith('.cursorrules')
  ) {
    return true;
  }
  return (
    languageId === 'typescript' ||
    languageId === 'typescriptreact' ||
    languageId === 'javascript' ||
    languageId === 'javascriptreact' ||
    languageId === 'json' ||
    languageId === 'php' ||
    languageId === 'blade' ||
    languageId === 'markdown'
  );
}
