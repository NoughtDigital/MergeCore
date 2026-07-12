import * as path from 'path';
import * as vscode from 'vscode';
import type { IndexerService } from './indexer.service';

/**
 * Watches saves and common Laravel/source globs for incremental re-index.
 *
 * Save events cover editor writes. FileSystemWatcher only handles create/delete
 * (and changes outside the editor) so a single save does not enqueue the same
 * path twice via both channels.
 */
export function installIndexWatchers(
  indexer: IndexerService,
  logger: { info: (m: string) => void; warn: (m: string) => void }
): vscode.Disposable {
  const pending = new Map<string, Set<string>>();
  let timer: ReturnType<typeof setTimeout> | undefined;

  const schedule = (workspaceRoot: string, relPath: string): void => {
    let set = pending.get(workspaceRoot);
    if (!set) {
      set = new Set();
      pending.set(workspaceRoot, set);
    }
    set.add(relPath);
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
    for (const [root, paths] of batch) {
      try {
        await indexer.indexPaths(root, [...paths]);
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
    schedule(folder.uri.fsPath, rel);
  });

  const watchers: vscode.FileSystemWatcher[] = [];
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    const patterns = ['app/**/*.php', 'routes/**/*.php', '**/*.md', 'config/**/*.php'];
    for (const pattern of patterns) {
      const watcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(folder, pattern)
      );
      const enqueue = (uri: vscode.Uri): void => {
        const rel = path.relative(folder.uri.fsPath, uri.fsPath).replace(/\\/g, '/');
        if (rel && !rel.startsWith('..')) {
          schedule(folder.uri.fsPath, rel);
        }
      };
      // Skip onDidChange — saves already cover in-editor edits and would double-index.
      watcher.onDidCreate(enqueue);
      watcher.onDidDelete((uri) => {
        const rel = path.relative(folder.uri.fsPath, uri.fsPath).replace(/\\/g, '/');
        if (rel && !rel.startsWith('..')) {
          void indexer.getStore(folder.uri.fsPath).then((store) => {
            store.removeFile(rel);
            return store.persist();
          });
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
  if (lower.endsWith('.php') || lower.endsWith('.md') || lower.endsWith('.cursorrules')) {
    return true;
  }
  return languageId === 'php' || languageId === 'blade' || languageId === 'markdown';
}
