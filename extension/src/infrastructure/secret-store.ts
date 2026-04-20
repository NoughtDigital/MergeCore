import * as vscode from 'vscode';
import { MergeCoreLogger } from './logger';

const API_TOKEN_KEY = 'mergecore.apiToken';
const MIGRATED_KEY = 'mergecore.apiToken.migratedFromSettings';

/**
 * Wraps `ExtensionContext.secrets` (OS-keychain backed) so the bearer token
 * never lands in plain `settings.json` and is not propagated by Settings Sync.
 */
export class MergeCoreSecretStore {
  constructor(private readonly secrets: vscode.SecretStorage) {}

  getApiToken(): Thenable<string | undefined> {
    return this.secrets.get(API_TOKEN_KEY);
  }

  async setApiToken(token: string): Promise<void> {
    const trimmed = token.trim();
    if (trimmed.length === 0) {
      await this.secrets.delete(API_TOKEN_KEY);
      return;
    }
    await this.secrets.store(API_TOKEN_KEY, trimmed);
  }

  async clearApiToken(): Promise<void> {
    await this.secrets.delete(API_TOKEN_KEY);
  }
}

/**
 * One-shot migration for users who set `mergecore.apiToken` in settings before
 * the SecretStorage move. We copy to secrets, scrub from settings, and mark it
 * done via globalState so we never read the plaintext setting again.
 */
export async function migrateTokenFromSettingsIfAny(
  context: vscode.ExtensionContext,
  store: MergeCoreSecretStore
): Promise<void> {
  if (context.globalState.get<boolean>(MIGRATED_KEY, false)) {
    return;
  }

  const legacy = vscode.workspace.getConfiguration('mergecore').get<string>('apiToken', '');
  const trimmed = (legacy ?? '').trim();

  if (trimmed.length > 0) {
    try {
      await store.setApiToken(trimmed);
      for (const target of [
        vscode.ConfigurationTarget.Global,
        vscode.ConfigurationTarget.Workspace,
        vscode.ConfigurationTarget.WorkspaceFolder,
      ]) {
        try {
          await vscode.workspace.getConfiguration('mergecore').update('apiToken', undefined, target);
        } catch {
          /* some targets may be unavailable (e.g. no workspace); ignore */
        }
      }
      MergeCoreLogger.shared.info(
        'Migrated apiToken from settings to SecretStorage and cleared the setting.'
      );
      void vscode.window.showInformationMessage(
        'MergeCore: moved your API token from settings.json to the OS keychain. You can rotate it via "MergeCore: Set API Token".'
      );
    } catch (e) {
      MergeCoreLogger.shared.error('Token migration failed', e);
    }
  }

  await context.globalState.update(MIGRATED_KEY, true);
}
