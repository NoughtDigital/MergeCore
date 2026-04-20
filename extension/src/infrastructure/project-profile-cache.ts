import * as vscode from 'vscode';
import { collectProjectProfile, type ProjectProfile } from '@mergecore/intelligence';

const cache = new Map<string, { expires: number; profile: ProjectProfile }>();
const TTL_MS = 30_000;

const WATCH_GLOB =
  '**/{composer.json,composer.lock,package.json,package-lock.json,pnpm-lock.yaml,yarn.lock}';

export async function getProjectProfileCached(workspaceRoot: string): Promise<ProjectProfile> {
  const now = Date.now();
  const hit = cache.get(workspaceRoot);
  if (hit && hit.expires > now) {
    return hit.profile;
  }
  const profile = await collectProjectProfile(workspaceRoot);
  cache.set(workspaceRoot, { expires: now + TTL_MS, profile });
  return profile;
}

export function clearProjectProfileCache(workspaceRoot?: string): void {
  if (workspaceRoot === undefined) {
    cache.clear();
    return;
  }
  cache.delete(workspaceRoot);
}

/**
 * A 30 s TTL is too forgiving when a user just ran `composer require livewire`;
 * hook a FileSystemWatcher so dependency-file mutations drop cache entries
 * immediately. Returns a disposable the caller tracks in extension subscriptions.
 */
export function installProjectProfileCacheInvalidation(): vscode.Disposable {
  const watcher = vscode.workspace.createFileSystemWatcher(WATCH_GLOB);
  const invalidate = (uri: vscode.Uri): void => {
    const folder = vscode.workspace.getWorkspaceFolder(uri);
    if (folder) {
      cache.delete(folder.uri.fsPath);
    } else {
      cache.clear();
    }
  };
  const subs = [
    watcher.onDidChange(invalidate),
    watcher.onDidCreate(invalidate),
    watcher.onDidDelete(invalidate),
  ];
  return {
    dispose(): void {
      for (const s of subs) {
        s.dispose();
      }
      watcher.dispose();
    },
  };
}
