import * as path from 'path';
import * as vscode from 'vscode';
import {
  assembleTaskContextPack,
  parseTaskContextDepth,
  writeTaskContextPack,
  type TaskContextDepth,
  type TaskContextPack,
} from '@mergecore/intelligence';
import type { ExplainerPorts } from '../../infrastructure/explain/explainer';
import type { IndexerService } from '../../infrastructure/index/indexer.service';
import { readOllamaSettings } from '../commands/register-cognition-commands';
import {
  assertMaySendRepositoryEvidence,
  PrivacyGateError,
  recordModelTransmission,
} from '../../infrastructure/privacy/privacy-gate';
import {
  providerRequiresExternalRequests,
  readPrivacySettings,
} from '../../infrastructure/privacy/privacy-settings';
import { enhanceTaskContextWithModel } from './task-context-model';
import { showTaskContextPanel } from './task-context-panel';

export const GENERATE_TASK_CONTEXT_COMMAND = 'mergecore.generateTaskContext';

export interface RegisterTaskContextDeps {
  readonly indexer: IndexerService;
  readonly modelPorts: ExplainerPorts;
  readonly ensureIndexed: (workspaceRoot: string) => Promise<void>;
  readonly isModelExplanationEnabled: () => boolean;
  readonly globalState: vscode.Memento;
}

async function buildPack(input: {
  readonly workspaceRoot: string;
  readonly indexer: IndexerService;
  readonly task: string;
  readonly depth: TaskContextDepth;
  readonly selectedFiles: readonly string[];
  readonly selectedSymbols?: readonly string[];
  readonly modelPorts: ExplainerPorts;
  readonly modelEnabled: boolean;
  readonly globalState: vscode.Memento;
}): Promise<TaskContextPack> {
  const store = await input.indexer.getStore(input.workspaceRoot);
  const graphService = input.indexer.getCodeGraphService(input.workspaceRoot);
  let pack = await assembleTaskContextPack({
    workspaceRoot: input.workspaceRoot,
    store,
    task: input.task,
    depth: input.depth,
    selectedFiles: input.selectedFiles,
    selectedSymbols: input.selectedSymbols,
    graphService,
  });

  if (input.modelEnabled) {
    try {
      const settings = readPrivacySettings();
      const requiresExternal = providerRequiresExternalRequests(settings);
      await assertMaySendRepositoryEvidence(
        { globalState: input.globalState },
        {
          settings,
          requiresExternal,
          purpose: 'Generate Task Context',
        }
      );
      const ollama = readOllamaSettings();
      const enhanced = await enhanceTaskContextWithModel({
        pack,
        ports: input.modelPorts,
        modelId: ollama.chatModel,
      });
      if (enhanced) {
        pack = enhanced;
        if (enhanced.meta.modelProvider && enhanced.meta.modelProvider !== 'none') {
          await recordModelTransmission(input.globalState, pack.markdown.slice(0, 8000));
        }
      }
    } catch (err) {
      if (err instanceof PrivacyGateError) {
        void vscode.window.showWarningMessage(err.message);
      }
      // keep deterministic — never fall back to another provider
    }
  }
  return pack;
}

export function registerGenerateTaskContext(
  context: vscode.ExtensionContext,
  deps: RegisterTaskContextDeps
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      GENERATE_TASK_CONTEXT_COMMAND,
      async (preset?: {
        task?: string;
        selectedFiles?: string[];
        selectedSymbols?: string[];
        depth?: TaskContextDepth;
      }) => {
        if (!vscode.workspace.isTrusted) {
          void vscode.window.showErrorMessage(
            'MergeCore requires a trusted workspace to generate task context.'
          );
          return;
        }
        const folder = vscode.workspace.workspaceFolders?.[0];
        if (!folder) {
          void vscode.window.showWarningMessage('Open a folder to generate task context.');
          return;
        }
        const workspaceRoot = folder.uri.fsPath;
        void deps.ensureIndexed(workspaceRoot);

        let store;
        try {
          store = await deps.indexer.getStore(workspaceRoot);
        } catch {
          store = undefined;
        }
        if (!store || store.chunkCount === 0) {
          const go = await vscode.window.showWarningMessage(
            'No local MergeCore index found. Index the repository first?',
            'Index Repository'
          );
          if (go === 'Index Repository') {
            await vscode.commands.executeCommand('mergecore.indexRepository');
          }
          return;
        }

        const defaultDepth = parseTaskContextDepth(
          vscode.workspace
            .getConfiguration('mergecore')
            .get<string>('taskContext.defaultDepth')
        );

        const task =
          preset?.task ??
          (await vscode.window.showInputBox({
            title: 'MergeCore: Generate Task Context',
            prompt: 'Describe the software task',
            placeHolder: 'Add partial refunds to subscriptions.',
            ignoreFocusOut: true,
          }));
        if (!task?.trim()) return;

        let selectedFiles = [...(preset?.selectedFiles ?? [])];
        if (!preset?.selectedFiles) {
          const pin = await vscode.window.showQuickPick(
            [
              { label: 'Continue without pinning files', id: 'none' as const },
              { label: 'Pin open editor files', id: 'open' as const },
            ],
            { title: 'Optional: pin files' }
          );
          if (pin?.id === 'open') {
            selectedFiles = vscode.window.visibleTextEditors
              .filter((e) => e.document.uri.scheme === 'file')
              .map((e) => {
                const wf = vscode.workspace.getWorkspaceFolder(e.document.uri);
                if (!wf) return '';
                return path
                  .relative(wf.uri.fsPath, e.document.uri.fsPath)
                  .replace(/\\/g, '/');
              })
              .filter(Boolean);
          }
        }

        const depth =
          preset?.depth ??
          (
            await vscode.window.showQuickPick(
              [
                { label: 'Standard (recommended)', depth: 'standard' as const },
                { label: 'Shallow', depth: 'shallow' as const },
                { label: 'Deep', depth: 'deep' as const },
              ],
              { title: 'Retrieval depth' }
            )
          )?.depth ??
          defaultDepth;

        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: 'MergeCore: generating task context…',
            cancellable: false,
          },
          async () => {
            const make = async (
              d: TaskContextDepth,
              files: readonly string[]
            ): Promise<TaskContextPack> =>
              buildPack({
                workspaceRoot,
                indexer: deps.indexer,
                task: task.trim(),
                depth: d,
                selectedFiles: files,
                selectedSymbols: preset?.selectedSymbols,
                modelPorts: deps.modelPorts,
                modelEnabled: deps.isModelExplanationEnabled(),
                globalState: deps.globalState,
              });

            let pack = await make(depth, selectedFiles);
            let savedPath: string | undefined;
            try {
              const written = await writeTaskContextPack(workspaceRoot, pack);
              savedPath = written.relativePath;
            } catch {
              // preview still works
            }

            showTaskContextPanel(
              { pack, workspaceRoot, savedPath },
              {
                regenerate: async ({ depth: d, selectedFiles: files }) => {
                  return vscode.window.withProgress(
                    {
                      location: vscode.ProgressLocation.Notification,
                      title: 'MergeCore: regenerating task context…',
                    },
                    async () => make(d, files)
                  );
                },
                savePack: async (p) => {
                  const written = await writeTaskContextPack(workspaceRoot, p);
                  return written.relativePath;
                },
              }
            );
          }
        );
      }
    )
  );
}

/** Shared helper for hover command. */
export { buildPack as buildTaskContextPackForUi };
