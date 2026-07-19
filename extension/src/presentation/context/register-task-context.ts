import * as path from 'path';
import * as vscode from 'vscode';
import {
  assembleTaskContextPack,
  hashRelativePath,
  listContextPackTemplates,
  previewContextPackTemplate,
  recordUsageEvent,
  resolveContextPackTemplate,
  setWorkspaceDefaultTemplate,
  writeTaskContextPack,
  type TaskContextDepth,
  type TaskContextPack,
} from '@mergecore/intelligence';
import type { ExplainerPorts } from '../../infrastructure/explain/explainer';
import type { ModelPorts } from '../../infrastructure/explain/model-ports';
import type { IndexerService } from '../../infrastructure/index/indexer.service';
import {
  assertMaySendRepositoryEvidence,
  PrivacyGateError,
  recordModelTransmission,
} from '../../infrastructure/privacy/privacy-gate';
import { filterOutboundEvidenceItems } from '../../infrastructure/privacy/filter-model-evidence';
import {
  providerRequiresExternalRequests,
  readPrivacySettings,
} from '../../infrastructure/privacy/privacy-settings';
import { enhanceTaskContextWithModel } from './task-context-model';
import { showTaskContextPanel } from './task-context-panel';

export const GENERATE_TASK_CONTEXT_COMMAND = 'mergecore.generateTaskContext';

export interface RegisterTaskContextDeps {
  readonly indexer: IndexerService;
  readonly modelPorts: ExplainerPorts | ModelPorts;
  readonly ensureIndexed: (workspaceRoot: string) => Promise<void>;
  readonly isModelExplanationEnabled: () => boolean;
  readonly globalState: vscode.Memento;
}

async function buildPack(input: {
  readonly workspaceRoot: string;
  readonly indexer: IndexerService;
  readonly task: string;
  readonly depth?: TaskContextDepth;
  readonly templateId?: string;
  readonly selectedFiles: readonly string[];
  readonly selectedSymbols?: readonly string[];
  readonly modelPorts: ExplainerPorts | ModelPorts;
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
    templateId: input.templateId,
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
      const filteredSources = await filterOutboundEvidenceItems(
        input.workspaceRoot,
        pack.meta.sources,
        { purpose: 'Generate Task Context', allowEmpty: true }
      );
      const packForModel: TaskContextPack = {
        ...pack,
        meta: { ...pack.meta, sources: filteredSources.allowed },
        evidenceRefs: pack.evidenceRefs.filter((s) =>
          filteredSources.allowed.some(
            (a) => a.path === s.path && a.startLine === s.startLine
          )
        ),
      };
      if (
        pack.meta.sources.length > 0 &&
        filteredSources.allowed.length === 0
      ) {
        throw new PrivacyGateError(
          'All task-context sources are blocked for model transmission by privacy rules.',
          'privacy_blocked'
        );
      }
      const {
        buildModelRequestPreview,
        formatModelRequestPreviewMarkdown,
      } = await import('../../infrastructure/explain/model-request-preview');
      const preview = buildModelRequestPreview({
        providerType: settings.modelMode,
        model:
          settings.modelMode === 'local'
            ? settings.localModel
            : settings.externalProvider,
        dataRemainsLocal: !requiresExternal,
        purpose: 'Generate Task Context',
        evidenceFiles: filteredSources.allowed.map((s) => s.path),
        excludedEvidence: filteredSources.blocked.map((s) => s.path),
        rawBodyChars: pack.markdown.length,
      });
      await recordModelTransmission(
        input.globalState,
        formatModelRequestPreviewMarkdown(preview)
      );
      const enhanced = await enhanceTaskContextWithModel({
        pack: packForModel,
        ports: input.modelPorts,
        modelId: settings.localModel,
      });
      if (enhanced) {
        pack = enhanced;
        if (enhanced.meta.modelProvider && enhanced.meta.modelProvider !== 'none') {
          await recordModelTransmission(input.globalState, pack.markdown.slice(0, 8000));
        }
      } else if (input.modelEnabled) {
        void vscode.window.showInformationMessage(
          'Model enhancement unavailable — showing deterministic task context.'
        );
      }
    } catch (err) {
      if (err instanceof PrivacyGateError) {
        void vscode.window.showWarningMessage(err.message);
      }
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
        templateId?: string;
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

        const task =
          preset?.task ??
          (await vscode.window.showInputBox({
            title: 'MergeCore: Generate Task Context',
            prompt: 'Describe the software task',
            placeHolder: 'Add partial refunds to subscriptions.',
            ignoreFocusOut: true,
          }));
        if (!task?.trim()) return;

        const loaded = await listContextPackTemplates(workspaceRoot);
        let templateId = preset?.templateId;
        if (!templateId) {
          const picks = [
            ...loaded.builtins.map((t) => ({
              label: t.name,
              description: t.id,
              detail: t.description,
              id: t.id,
            })),
            ...loaded.workspace.map((t) => ({
              label: `${t.name} (workspace)`,
              description: t.id,
              detail: t.filePath ?? t.description,
              id: t.id,
            })),
          ];
          const defaultPick = picks.find((p) => p.id === loaded.defaultId) ?? picks[0];
          const chosen = await vscode.window.showQuickPick(picks, {
            title: 'Context-pack template',
            placeHolder: `Default: ${loaded.defaultId}`,
          });
          templateId = chosen?.id ?? defaultPick?.id;
          if (chosen && chosen.id !== loaded.defaultId) {
            const setDef = await vscode.window.showQuickPick(
              [
                { label: 'Use for this pack only', id: 'once' as const },
                { label: 'Set as workspace default', id: 'default' as const },
                { label: 'Preview retrieval settings', id: 'preview' as const },
              ],
              { title: 'Template options' }
            );
            if (setDef?.id === 'default') {
              await setWorkspaceDefaultTemplate(workspaceRoot, chosen.id);
            } else if (setDef?.id === 'preview') {
              const { template } = await resolveContextPackTemplate({
                workspaceRoot,
                templateId: chosen.id,
              });
              const preview = previewContextPackTemplate(template);
              void vscode.window.showInformationMessage(
                `${preview.template.name}: depth ${preview.retrieval.depth}, dep ${preview.retrieval.dependencyDepth}, maxChars ${preview.retrieval.maxChars}, sections ${preview.sections.length}`
              );
            }
          }
        }

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
            for (const f of selectedFiles) {
              void recordUsageEvent(workspaceRoot, {
                kind: 'manually_added_file',
                pathHash: hashRelativePath(f),
              }).catch(() => undefined);
            }
          }
        }

        const depth =
          preset?.depth ??
          (
            await vscode.window.showQuickPick(
              [
                { label: 'Use template depth', depth: undefined as TaskContextDepth | undefined },
                { label: 'Standard', depth: 'standard' as const },
                { label: 'Shallow', depth: 'shallow' as const },
                { label: 'Deep', depth: 'deep' as const },
              ],
              { title: 'Retrieval depth override' }
            )
          )?.depth;

        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: 'MergeCore: generating task context…',
            cancellable: false,
          },
          async () => {
            const make = async (
              d: TaskContextDepth | undefined,
              files: readonly string[],
              tpl?: string
            ): Promise<TaskContextPack> =>
              buildPack({
                workspaceRoot,
                indexer: deps.indexer,
                task: task.trim(),
                depth: d,
                templateId: tpl ?? templateId,
                selectedFiles: files,
                selectedSymbols: preset?.selectedSymbols,
                modelPorts: deps.modelPorts,
                modelEnabled: deps.isModelExplanationEnabled(),
                globalState: deps.globalState,
              });

            let pack = await make(depth, selectedFiles, templateId);
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
                    async () => make(d, files, pack.meta.templateId)
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
