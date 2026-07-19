import * as path from 'path';
import * as vscode from 'vscode';
import {
  extractConflictRuleCandidates,
  formatContextConflictsMarkdown,
  formatExtractedRulesMarkdown,
  loadExtractedConflictRules,
  saveConflictIgnore,
  scanContextConflicts,
  updateExtractedRuleStatus,
  type ContextConflictFinding,
  type ExtractedRuleStatus,
} from '@mergecore/intelligence';
import type { IndexerService } from '../../infrastructure/index/indexer.service';
import { MergeCoreLogger } from '../../infrastructure/logger';

export interface ContextConflictCommandDeps {
  readonly indexer: IndexerService;
  readonly logger: MergeCoreLogger;
}

const LAST_FINDINGS_KEY = 'mergecore.contextConflicts.lastFindings';

function workspaceRoot(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

function requireTrusted(): boolean {
  if (!vscode.workspace.isTrusted) {
    void vscode.window.showWarningMessage(
      'MergeCore context conflict commands require a trusted workspace.'
    );
    return false;
  }
  return true;
}

export function registerContextConflictCommands(
  context: vscode.ExtensionContext,
  deps: ContextConflictCommandDeps
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('mergecore.scanContextConflicts', async () => {
      if (!requireTrusted()) return;
      const root = workspaceRoot();
      if (!root) {
        void vscode.window.showInformationMessage('Open a workspace folder first.');
        return;
      }

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'MergeCore: scanning for context conflicts…',
          cancellable: true,
        },
        async (_progress, token) => {
          try {
            let store;
            try {
              store = await deps.indexer.getStore(root);
            } catch {
              store = undefined;
            }
            const result = await scanContextConflicts({
              workspaceRoot: root,
              store,
              signal: token.isCancellationRequested
                ? AbortSignal.abort()
                : undefined,
            });
            if (token.isCancellationRequested) return;

            await context.workspaceState.update(LAST_FINDINGS_KEY, result.findings);

            const markdown = formatContextConflictsMarkdown(result);
            const doc = await vscode.workspace.openTextDocument({
              content: markdown,
              language: 'markdown',
            });
            await vscode.window.showTextDocument(doc, {
              preview: true,
              viewColumn: vscode.ViewColumn.Beside,
            });

            if (result.findings.length === 0) {
              void vscode.window.showInformationMessage(
                'No documented rule conflicts with observed implementation.'
              );
            } else {
              void vscode.window.showWarningMessage(
                `Found ${result.findings.length} documented-rule conflict(s) with observed implementation.`
              );
            }
          } catch (err) {
            deps.logger.error('scanContextConflicts failed', err);
            void vscode.window.showErrorMessage(
              `Context conflict scan failed: ${err instanceof Error ? err.message : String(err)}`
            );
          }
        }
      );
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('mergecore.reviewExtractedRules', async () => {
      if (!requireTrusted()) return;
      const root = workspaceRoot();
      if (!root) {
        void vscode.window.showInformationMessage('Open a workspace folder first.');
        return;
      }

      await extractConflictRuleCandidates({ workspaceRoot: root });
      const file = loadExtractedConflictRules(root);

      const doc = await vscode.workspace.openTextDocument({
        content: formatExtractedRulesMarkdown(file.rules),
        language: 'markdown',
      });
      await vscode.window.showTextDocument(doc, { preview: true });

      if (file.rules.length === 0) {
        void vscode.window.showInformationMessage('No extractable instruction rules found.');
        return;
      }

      const pick = await vscode.window.showQuickPick(
        file.rules.map((r) => ({
          label: r.id,
          description: r.status,
          detail: r.originalText.slice(0, 120),
          rule: r,
        })),
        { placeHolder: 'Select an extracted rule to confirm, edit, or disable' }
      );
      if (!pick) return;

      const action = await vscode.window.showQuickPick(
        [
          { label: 'Confirm rule', value: 'confirmed' as const },
          { label: 'Disable rule', value: 'disabled' as const },
          { label: 'Mark pending', value: 'pending' as const },
        ],
        { placeHolder: `Update status for ${pick.rule.id}` }
      );
      if (!action) return;

      let description = pick.rule.description;
      if (action.value === 'confirmed' && pick.rule.ambiguous) {
        const edited = await vscode.window.showInputBox({
          prompt:
            'This candidate is ambiguous. Edit the description to make a concrete rule, or cancel.',
          value: pick.rule.description,
          ignoreFocusOut: true,
        });
        if (edited === undefined) return;
        description = edited.trim();
        if (!description) return;
      }

      updateExtractedRuleStatus(root, pick.rule.id, action.value as ExtractedRuleStatus, {
        description,
        ambiguous: action.value === 'confirmed' ? false : pick.rule.ambiguous,
        status: action.value as ExtractedRuleStatus,
      });
      void vscode.window.showInformationMessage(
        `Extracted rule ${pick.rule.id} → ${action.value}`
      );
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('mergecore.ignoreContextConflict', async () => {
      if (!requireTrusted()) return;
      const root = workspaceRoot();
      if (!root) return;

      const findings =
        context.workspaceState.get<ContextConflictFinding[]>(LAST_FINDINGS_KEY) ?? [];
      if (findings.length === 0) {
        void vscode.window.showInformationMessage(
          'No recent conflict scan results. Run MergeCore: Scan for Context Conflicts first.'
        );
        return;
      }

      const pick = await vscode.window.showQuickPick(
        findings.map((f) => ({
          label: f.rule.id,
          description: f.confidence,
          detail: f.documentedRule.text.slice(0, 140),
          finding: f,
        })),
        { placeHolder: 'Select a conflict to ignore' }
      );
      if (!pick) return;

      saveConflictIgnore(root, {
        conflictId: pick.finding.id,
        ruleId: pick.finding.rule.id,
        paths: pick.finding.affectedFiles,
        ignoredAt: new Date().toISOString(),
      });
      void vscode.window.showInformationMessage(
        `Ignored conflict ${pick.finding.rule.id}. Re-run the scan to refresh the report.`
      );
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('mergecore.openConflictRuleSource', async () => {
      if (!requireTrusted()) return;
      const root = workspaceRoot();
      if (!root) return;

      const findings =
        context.workspaceState.get<ContextConflictFinding[]>(LAST_FINDINGS_KEY) ?? [];
      const pick = await vscode.window.showQuickPick(
        findings.map((f) => ({
          label: f.documentedRule.path,
          description: `L${f.documentedRule.startLine}`,
          detail: f.documentedRule.text.slice(0, 140),
          finding: f,
        })),
        { placeHolder: 'Open documented rule source' }
      );
      if (!pick) return;

      const abs = path.join(root, pick.finding.documentedRule.path);
      const uri = vscode.Uri.file(abs);
      const doc = await vscode.workspace.openTextDocument(uri);
      const editor = await vscode.window.showTextDocument(doc);
      const line = Math.max(0, pick.finding.documentedRule.startLine - 1);
      const pos = new vscode.Position(line, 0);
      editor.selection = new vscode.Selection(pos, pos);
      editor.revealRange(new vscode.Range(pos, pos));
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('mergecore.openConflictingCode', async () => {
      if (!requireTrusted()) return;
      const root = workspaceRoot();
      if (!root) return;

      const findings =
        context.workspaceState.get<ContextConflictFinding[]>(LAST_FINDINGS_KEY) ?? [];
      const locations = findings.flatMap((f) =>
        f.observedCode.map((o) => ({
          label: o.path,
          description: `L${o.startLine}`,
          detail: o.detail,
          evidence: o,
        }))
      );
      if (locations.length === 0) {
        void vscode.window.showInformationMessage('No conflicting code locations in the last scan.');
        return;
      }

      const pick = await vscode.window.showQuickPick(locations, {
        placeHolder: 'Open conflicting code',
      });
      if (!pick) return;

      const abs = path.join(root, pick.evidence.path);
      const uri = vscode.Uri.file(abs);
      const doc = await vscode.workspace.openTextDocument(uri);
      const editor = await vscode.window.showTextDocument(doc);
      const line = Math.max(0, pick.evidence.startLine - 1);
      const pos = new vscode.Position(line, 0);
      editor.selection = new vscode.Selection(pos, pos);
      editor.revealRange(new vscode.Range(pos, pos));
    })
  );
}
