import * as vscode from 'vscode';
import { MergeCoreLogger } from './logger';

const API_TOKEN_KEY = 'mergecore.apiToken';
const OPENAI_KEY = 'mergecore.provider.openai.apiKey';
const ANTHROPIC_KEY = 'mergecore.provider.anthropic.apiKey';
const MIGRATED_KEY = 'mergecore.apiToken.migratedFromSettings';

/**
 * Wraps `ExtensionContext.secrets` (OS-keychain backed) so API keys
 * never land in plain `settings.json`, `.mergecore`, logs, or Settings Sync.
 */
export class MergeCoreSecretStore {
  constructor(private readonly secrets: vscode.SecretStorage) {}

  getApiToken(): Thenable<string | undefined> {
    return this.secrets.get(API_TOKEN_KEY);
  }

  async setApiToken(token: string): Promise<void> {
    await this.storeOrDelete(API_TOKEN_KEY, token);
  }

  async clearApiToken(): Promise<void> {
    await this.secrets.delete(API_TOKEN_KEY);
  }

  async getOpenAiApiKey(): Promise<string | undefined> {
    return this.secrets.get(OPENAI_KEY);
  }

  async setOpenAiApiKey(token: string): Promise<void> {
    await this.storeOrDelete(OPENAI_KEY, token);
  }

  async clearOpenAiApiKey(): Promise<void> {
    await this.secrets.delete(OPENAI_KEY);
  }

  async hasOpenAiKey(): Promise<boolean> {
    const v = await this.getOpenAiApiKey();
    return Boolean(v && v.trim().length > 0);
  }

  async getAnthropicApiKey(): Promise<string | undefined> {
    return this.secrets.get(ANTHROPIC_KEY);
  }

  async setAnthropicApiKey(token: string): Promise<void> {
    await this.storeOrDelete(ANTHROPIC_KEY, token);
  }

  async clearAnthropicApiKey(): Promise<void> {
    await this.secrets.delete(ANTHROPIC_KEY);
  }

  async hasAnthropicKey(): Promise<boolean> {
    const v = await this.getAnthropicApiKey();
    return Boolean(v && v.trim().length > 0);
  }

  /** Presence flags only — never returns secret values. */
  async keyPresence(): Promise<{
    readonly apiToken: boolean;
    readonly openai: boolean;
    readonly anthropic: boolean;
  }> {
    const [apiToken, openai, anthropic] = await Promise.all([
      this.getApiToken().then((t) => Boolean(t && t.trim())),
      this.hasOpenAiKey(),
      this.hasAnthropicKey(),
    ]);
    return { apiToken, openai, anthropic };
  }

  private async storeOrDelete(key: string, token: string): Promise<void> {
    const trimmed = token.trim();
    if (trimmed.length === 0) {
      await this.secrets.delete(key);
      return;
    }
    await this.secrets.store(key, trimmed);
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
