import * as vscode from 'vscode';
import { createRepositoryIndex } from '@mergecore/intelligence';
import type { ExplainerPorts } from '../../infrastructure/explain/explainer';
import type { IndexerService } from '../../infrastructure/index/indexer.service';
import { assembleFallbackPack } from './explain-context-pack-fallback';
import { assembleSelectedCodeExplanation } from './explain-selected-assemble';
import { enhanceSelectedExplanationWithModel } from './explain-selected-model';
import { resolveExplainScope } from './explain-scope';
import { showExplanationPanel } from './explanation-panel';

export const EXPLAIN_SELECTED_COMMAND = 'mergecore.explainSelectedCode';

export interface RegisterExplainSelectedDeps {
  readonly indexer: IndexerService;
  readonly modelPorts: ExplainerPorts;
  readonly ensureIndexed: (workspaceRoot: string) => Promise<void>;
  readonly isModelExplanationEnabled: () => boolean;
}

export function registerExplainSelectedCode(
  context: vscode.ExtensionContext,
  deps: RegisterExplainSelectedDeps
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(EXPLAIN_SELECTED_COMMAND, async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        void vscode.window.showWarningMessage(
          'Open a TypeScript or JavaScript file to explain.'
        );
        return;
      }

      const folder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
      const workspaceRoot = folder?.uri.fsPath;

      if (workspaceRoot) {
        void deps.ensureIndexed(workspaceRoot);
      }

      let store;
      try {
        store = workspaceRoot
          ? await deps.indexer.getStore(workspaceRoot)
          : undefined;
      } catch {
        store = undefined;
      }

      const graphService = workspaceRoot
        ? deps.indexer.getCodeGraphService(workspaceRoot)
        : undefined;

      const resolved = await resolveExplainScope({
        editor,
        workspaceRoot,
        isTrusted: vscode.workspace.isTrusted,
        store,
        graphService,
      });

      if (!resolved.ok) {
        void vscode.window.showErrorMessage(resolved.message);
        return;
      }

      const { scope } = resolved;

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'MergeCore: Explaining selected code…',
          cancellable: false,
        },
        async () => {
          let explanation = await assembleSelectedCodeExplanation({
            scope,
            store: store!,
            graphService,
          });

          if (deps.isModelExplanationEnabled()) {
            try {
              const enhanced = await enhanceSelectedExplanationWithModel({
                scope,
                explanation,
                ports: deps.modelPorts,
              });
              if (enhanced) {
                explanation = enhanced;
              }
            } catch {
              // keep deterministic
            }
          }

          showExplanationPanel(
            { scope, explanation },
            {
              buildContextPackMarkdown: async (s) => {
                const q =
                  s.symbol?.name ??
                  s.selectedText.slice(0, 120).replace(/\s+/g, ' ').trim() ??
                  s.relPath;
                try {
                  const repo = await createRepositoryIndex(s.workspaceRoot);
                  try {
                    const pack = await repo.buildContextPack(q, { k: 12 });
                    return [
                      `# Context pack · ${s.symbol?.name ?? s.relPath}`,
                      '',
                      `Query: ${q}`,
                      '',
                      '## Claims',
                      ...pack.claims.slice(0, 30).map((c) => {
                        const ref = c.references[0];
                        return `- ${c.text}${ref ? ` (\`${ref.path}:${ref.startLine}\`)` : ''}`;
                      }),
                      '',
                      pack.incomplete ? '_Pack marked incomplete._' : '',
                    ]
                      .filter(Boolean)
                      .join('\n');
                  } finally {
                    await repo.close();
                  }
                } catch {
                  const st = await deps.indexer.getStore(s.workspaceRoot);
                  return assembleFallbackPack(s, q, st);
                }
              },
            }
          );
        }
      );
    })
  );
}
