import * as path from 'path';
import * as vscode from 'vscode';
import {
  assignEvidenceIds,
  createCodeGraphQuery,
  createInstructionResolver,
  createSourceReference,
  recordUsageEvent,
} from '@mergecore/intelligence';
import type { Explainer } from '../../infrastructure/explain/explainer';
import type { ModelPorts } from '../../infrastructure/explain/model-ports';
import { enhanceWithValidatedClaims } from '../../infrastructure/explain/enhance-with-validated-claims';
import {
  buildModelRequestPreview,
  formatModelRequestPreviewMarkdown,
} from '../../infrastructure/explain/model-request-preview';
import type { IndexerService } from '../../infrastructure/index/indexer.service';
import { getExplanationMode, type ExplanationMode } from '../../domain/explanation-modes';
import {
  assertMaySendRepositoryEvidence,
  PrivacyGateError,
  recordModelTransmission,
} from '../../infrastructure/privacy/privacy-gate';
import { assertPathMaySendToModel } from '../../infrastructure/privacy/filter-model-evidence';
import {
  providerRequiresExternalRequests,
  readPrivacySettings,
} from '../../infrastructure/privacy/privacy-settings';
import { HOVER_COMMANDS, type HoverCommandArgs } from './hover-markdown';
import { openAttributedSource } from '../sources/open-attributed-source';

export interface HoverCommandDeps {
  readonly indexer: IndexerService;
  readonly explainer: Explainer;
  readonly modelPorts: ModelPorts;
  readonly getMode: () => ExplanationMode;
  readonly isModelExplanationEnabled: () => boolean;
  readonly globalState?: vscode.Memento;
}

function parseArgs(raw: unknown): HoverCommandArgs | undefined {
  if (!raw || typeof raw !== 'object') {
    return undefined;
  }
  const a = raw as Partial<HoverCommandArgs>;
  if (
    typeof a.workspaceRoot !== 'string' ||
    typeof a.symbolId !== 'string' ||
    typeof a.path !== 'string' ||
    typeof a.name !== 'string'
  ) {
    return undefined;
  }
  return {
    workspaceRoot: a.workspaceRoot,
    symbolId: a.symbolId,
    path: a.path,
    startLine: typeof a.startLine === 'number' ? a.startLine : 1,
    endLine: typeof a.endLine === 'number' ? a.endLine : 1,
    name: a.name,
  };
}

async function openSource(args: HoverCommandArgs): Promise<void> {
  await openAttributedSource({
    workspaceRoot: args.workspaceRoot,
    workspaceId: args.workspaceId,
    path: args.path,
    startLine: args.startLine,
    endLine: args.endLine,
    startColumn: args.startColumn,
    endColumn: args.endColumn,
    sourceFingerprint: args.sourceFingerprint,
    sourceType: 'symbol',
  });
}

async function showQuickPickPaths(
  title: string,
  items: ReadonlyArray<{ label: string; path: string; line?: number; workspaceRoot: string }>
): Promise<void> {
  if (items.length === 0) {
    void vscode.window.showInformationMessage(`${title}: none found in the local index.`);
    return;
  }
  const picked = await vscode.window.showQuickPick(
    items.map((i) => ({
      label: i.label,
      description: i.path,
      item: i,
    })),
    { title }
  );
  if (!picked) {
    return;
  }
  await openSource({
    workspaceRoot: picked.item.workspaceRoot,
    symbolId: '',
    path: picked.item.path,
    startLine: picked.item.line ?? 1,
    endLine: picked.item.line ?? 1,
    name: picked.item.label,
  });
}

export function registerHoverCommands(
  context: vscode.ExtensionContext,
  deps: HoverCommandDeps
): void {
  const register = (
    id: string,
    handler: (args: HoverCommandArgs) => Promise<void>
  ): void => {
    context.subscriptions.push(
      vscode.commands.registerCommand(id, async (raw?: unknown) => {
        if (!vscode.workspace.isTrusted) {
          void vscode.window.showWarningMessage(
            'MergeCore hover actions require a trusted workspace.'
          );
          return;
        }
        const args = parseArgs(raw);
        if (!args) {
          return;
        }
        await handler(args);
      })
    );
  };

  register(HOVER_COMMANDS.openSource, openSource);

  register(HOVER_COMMANDS.viewCallers, async (args) => {
    const store = await deps.indexer.getStore(args.workspaceRoot);
    const graph = createCodeGraphQuery(store);
    const callers = graph.getCallers(args.symbolId);
    await showQuickPickPaths(
      `Callers of ${args.name}`,
      callers.map((e) => ({
        label: e.fromSymbol?.split(':')[2] ?? e.fromPath,
        path: e.fromPath,
        line: e.startLine,
        workspaceRoot: args.workspaceRoot,
      }))
    );
  });

  register(HOVER_COMMANDS.viewDependencies, async (args) => {
    const store = await deps.indexer.getStore(args.workspaceRoot);
    const graph = createCodeGraphQuery(store);
    const depsEdges = [
      ...graph.getCallees(args.symbolId),
      ...graph.getDependencies(args.symbolId),
    ];
    await showQuickPickPaths(
      `Dependencies of ${args.name}`,
      depsEdges.map((e) => ({
        label: e.specifier || e.toSymbol?.split(':')[2] || e.toPath,
        path: e.toPath,
        line: e.startLine,
        workspaceRoot: args.workspaceRoot,
      }))
    );
  });

  register(HOVER_COMMANDS.viewRelatedTests, async (args) => {
    const store = await deps.indexer.getStore(args.workspaceRoot);
    const graph = createCodeGraphQuery(store);
    const tests = graph.getRelatedTests(args.symbolId);
    await showQuickPickPaths(
      `Related tests for ${args.name}`,
      tests.map((t) => ({
        label: t.edge.fromPath,
        path: t.edge.fromPath,
        line: t.edge.startLine,
        workspaceRoot: args.workspaceRoot,
      }))
    );
  });

  register(HOVER_COMMANDS.viewInstructions, async (args) => {
    try {
      const resolver = await createInstructionResolver({
        workspaceRoot: args.workspaceRoot,
      });
      const docs = await resolver.getApplicableDocuments(args.path);
      await showQuickPickPaths(
        `Applicable instructions for ${args.name}`,
        docs.map((d) => ({
          label: d.title || d.path,
          path: d.path,
          line: 1,
          workspaceRoot: args.workspaceRoot,
        }))
      );
    } catch (err) {
      void vscode.window.showWarningMessage(
        `Could not load instructions: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  });

  register(HOVER_COMMANDS.generateTaskContext, async (args) => {
    await vscode.commands.executeCommand('mergecore.generateTaskContext', {
      task: `Change impact for \`${args.name}\` in \`${args.path}\``,
      selectedFiles: [args.path],
      selectedSymbols: [args.symbolId],
    });
  });

  register(HOVER_COMMANDS.openExplanation, async (args) => {
    const store = await deps.indexer.getStore(args.workspaceRoot);
    const graph = createCodeGraphQuery(store);
    const def = graph.getSymbolDefinition(args.symbolId);
    const mode = deps.getMode();
    const modeInfo = getExplanationMode(mode);

    const abs = path.join(args.workspaceRoot, args.path);
    let code = '';
    try {
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(abs));
      const start = Math.max(0, args.startLine - 1);
      const end = Math.min(doc.lineCount - 1, Math.max(start, args.endLine - 1));
      const parts: string[] = [];
      for (let i = start; i <= end; i++) {
        parts.push(doc.lineAt(i).text);
      }
      code = parts.join('\n');
    } catch {
      code = def?.signatureText ?? args.name;
    }

    const callers = graph.getCallers(args.symbolId);
    const tests = graph.getRelatedTests(args.symbolId);
    const relatedSummary = [
      ...callers.slice(0, 6).map((c) => `- caller ${c.fromPath}`),
      ...tests.slice(0, 4).map((t) => `- test ${t.edge.fromPath}`),
    ].join('\n');

    const modelEnabled = deps.isModelExplanationEnabled();
    let markdown: string;
    let source: string;

    if (modelEnabled) {
      try {
        const settings = readPrivacySettings();
        const requiresExternal = providerRequiresExternalRequests(settings);
        if (deps.globalState) {
          await assertMaySendRepositoryEvidence(
            { globalState: deps.globalState },
            {
              settings,
              requiresExternal,
              purpose: 'Hover open explanation',
            }
          );
        }
        await assertPathMaySendToModel(
          args.workspaceRoot,
          args.path,
          'Hover open explanation'
        );

        const evidence = assignEvidenceIds([
          createSourceReference({
            workspaceId: 'workspace',
            path: args.path,
            startLine: args.startLine,
            endLine: args.endLine,
            sourceType: 'symbol',
            symbol: args.name,
            symbolId: args.symbolId,
          }),
        ]);

        const preview = buildModelRequestPreview({
          providerType: settings.modelMode,
          model:
            settings.modelMode === 'local'
              ? settings.localModel
              : settings.externalProvider,
          dataRemainsLocal: !requiresExternal,
          purpose: 'Hover open explanation',
          evidenceFiles: [args.path],
          rawBodyChars: code.length + relatedSummary.length,
        });
        if (deps.globalState) {
          await recordModelTransmission(
            deps.globalState,
            formatModelRequestPreviewMarkdown(preview)
          );
        }

        const enhanced = await enhanceWithValidatedClaims({
          ports: deps.modelPorts,
          evidence,
          purpose: 'Hover open explanation',
          userPrompt: [
            `Summarise and improve wording for symbol ${args.name} in ${args.path}.`,
            'Return JSON claims with evidenceIds only.',
            '',
            'Code:',
            '```',
            code.slice(0, 3000),
            '```',
            '',
            'Related:',
            relatedSummary || '(none)',
          ].join('\n'),
        });

        if (enhanced.ok) {
          markdown = [
            `## Function Summary`,
            ...enhanced.acceptedClaimTexts.map((t) => `- ${t}`),
            '',
            `## Related Systems`,
            relatedSummary || '_None indexed._',
            '',
            settings.modelMode === 'local'
              ? '_Local model wording — claims validated against evidence IDs._'
              : '_External model wording — claims validated against evidence IDs._',
          ].join('\n');
          source =
            settings.modelMode === 'local' ? 'local model' : 'external model';
          if (deps.globalState) {
            await recordModelTransmission(deps.globalState, markdown.slice(0, 8000));
          }
        } else {
          const explanation = await deps.explainer.explain({
            symbol: args.name,
            filePath: args.path,
            code,
            mode,
            relatedSummary,
            ragContext: relatedSummary,
            architecturalHints: '',
          });
          markdown = [
            explanation.markdown,
            '',
            `_${enhanced.fallbackMessage ?? 'Model enhancement failed — using deterministic output.'}_`,
          ].join('\n');
          source = 'deterministic (model fallback)';
        }
      } catch (err) {
        if (err instanceof PrivacyGateError) {
          void vscode.window.showWarningMessage(err.message);
        }
        markdown = [
          `## Function Summary`,
          def?.jsdocSummary ?? `\`${args.name}\` (${def?.kind ?? 'symbol'}) in \`${args.path}\`.`,
          '',
          `_Model explanation blocked by privacy controls. Showing deterministic summary only._`,
          '',
          `## Related Systems`,
          relatedSummary || '_None indexed._',
        ].join('\n');
        source = 'deterministic (privacy blocked)';
      }
    } else {
      markdown = [
        `## Function Summary`,
        def?.jsdocSummary ?? `\`${args.name}\` (${def?.kind ?? 'symbol'}) in \`${args.path}\`.`,
        '',
        `## Inputs / Outputs`,
        def?.parameters
          ? def.parameters.map((p) => `- ${p.name}${p.typeText ? `: ${p.typeText}` : ''}`).join('\n')
          : '_No parameter evidence in index._',
        '',
        `Return: ${def?.returnTypeText ?? '_unknown_'}`,
        '',
        `## Related Systems`,
        relatedSummary || '_None indexed._',
        '',
        `_Model explanation disabled. Enable **mergecore.hover.enableModelExplanation** to generate a richer explanation from retrieved evidence only._`,
      ].join('\n');
      source = 'deterministic (model disabled)';
    }

    const body = `${markdown}\n\n---\n_MergeCore · ${modeInfo.badge} · ${source}_`;
    const doc = await vscode.workspace.openTextDocument({
      content: body,
      language: 'markdown',
    });
    await vscode.window.showTextDocument(doc, { preview: true });
    void recordUsageEvent(args.workspaceRoot, { kind: 'explanation_opened' }).catch(
      () => undefined
    );
  });
}
