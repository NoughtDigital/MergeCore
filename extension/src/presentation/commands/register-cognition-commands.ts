import * as vscode from 'vscode';
import {
  EXPLANATION_MODES,
  getExplanationMode,
  getIntelligenceProfile,
  INTELLIGENCE_PROFILES,
  isExplanationMode,
  isIntelligenceProfile,
  type ExplanationMode,
  type IntelligenceProfile,
} from '../../domain/explanation-modes';
import type { IndexerService } from '../../infrastructure/index/indexer.service';
import { MergeCoreLogger } from '../../infrastructure/logger';
import { validateOllamaBaseUrl } from '../../infrastructure/ollama-base-url';

export interface CognitionCommandDeps {
  readonly indexer: IndexerService;
  readonly logger: MergeCoreLogger;
  readonly onModeChanged?: (mode: ExplanationMode) => void;
}

export function registerCognitionCommands(
  context: vscode.ExtensionContext,
  deps: CognitionCommandDeps
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('mergecore.indexRepository', async () => {
      const folder = vscode.workspace.workspaceFolders?.[0];
      if (!folder) {
        void vscode.window.showWarningMessage('Open a folder to index with MergeCore.');
        return;
      }
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'MergeCore: indexing repository',
          cancellable: false,
        },
        async (progress) => {
          const sub = deps.indexer.onStatus((message) => {
            progress.report({ message });
          });
          try {
            const result = await deps.indexer.indexRepository(folder.uri.fsPath);
            void vscode.window.showInformationMessage(
              `MergeCore indexed ${result.chunks} chunks (${result.filesIndexed} files updated).`
            );
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            deps.logger.error(`indexRepository failed: ${msg}`);
            void vscode.window.showErrorMessage(`MergeCore index failed: ${msg}`);
          } finally {
            sub.dispose();
          }
        }
      );
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('mergecore.setExplanationMode', async () => {
      const current = readExplanationMode();
      const picked = await vscode.window.showQuickPick(
        EXPLANATION_MODES.map((m) => ({
          label: m.title,
          description: m.id === current ? 'Current' : undefined,
          detail: m.tagline,
          mode: m.id,
        })),
        {
          title: 'MergeCore explanation mode',
          placeHolder: 'Choose how deep explanations should go',
        }
      );
      if (!picked) {
        return;
      }
      await vscode.workspace
        .getConfiguration('mergecore')
        .update('explanationMode', picked.mode, vscode.ConfigurationTarget.Global);
      deps.onModeChanged?.(picked.mode);
      void vscode.window.showInformationMessage(
        `MergeCore explanation mode: ${getExplanationMode(picked.mode).title}`
      );
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('mergecore.setIntelligenceProfile', async () => {
      const current = readIntelligenceProfile();
      const picked = await vscode.window.showQuickPick(
        INTELLIGENCE_PROFILES.map((p) => ({
          label: p.title,
          description: p.id === current ? 'Current' : undefined,
          detail: p.tagline,
          profile: p.id,
        })),
        {
          title: 'MergeCore intelligence profile',
          placeHolder: 'Choose a reasoning lens for evaluations',
        }
      );
      if (!picked) {
        return;
      }
      await vscode.workspace
        .getConfiguration('mergecore')
        .update('intelligenceProfile', picked.profile, vscode.ConfigurationTarget.Global);
      void vscode.window.showInformationMessage(
        `MergeCore intelligence profile: ${getIntelligenceProfile(picked.profile).title}`
      );
    })
  );
}

export function readExplanationMode(): ExplanationMode {
  const raw = vscode.workspace.getConfiguration('mergecore').get<string>('explanationMode') ?? '';
  if (isExplanationMode(raw)) {
    return raw;
  }
  return 'junior';
}

export function readIntelligenceProfile(): IntelligenceProfile {
  const raw = vscode.workspace.getConfiguration('mergecore').get<string>('intelligenceProfile') ?? '';
  if (isIntelligenceProfile(raw)) {
    return raw;
  }
  return 'default';
}

export function readOllamaSettings(): {
  baseUrl: string;
  chatModel: string;
  embedModel: string;
} {
  const cfg = vscode.workspace.getConfiguration('mergecore');
  const rawBase = cfg.get<string>('local.ollamaBaseUrl') ?? 'http://127.0.0.1:11434';
  const validated = validateOllamaBaseUrl(rawBase);
  const baseUrl = validated.ok && validated.url
    ? validated.url.origin + (validated.url.pathname === '/' ? '' : validated.url.pathname.replace(/\/+$/, ''))
    : 'http://127.0.0.1:11434';
  if (!validated.ok) {
    MergeCoreLogger.shared.warn(
      `Invalid mergecore.local.ollamaBaseUrl (${validated.reason ?? 'unknown'}). Falling back to http://127.0.0.1:11434.`
    );
  }
  return {
    baseUrl,
    chatModel: cfg.get<string>('local.chatModel') ?? 'llama3.2',
    embedModel: cfg.get<string>('local.embedModel') ?? 'nomic-embed-text',
  };
}
