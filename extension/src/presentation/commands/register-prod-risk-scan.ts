import * as vscode from 'vscode';
import type { ProjectProfile } from '@mergecore/intelligence';
import type { Finding } from '../../domain/review-types';
import { MergeCoreLogger } from '../../infrastructure/logger';
import { getProjectProfileCached } from '../../infrastructure/project-profile-cache';
import { ProdRiskScanService } from '../../infrastructure/prod-risk-scan.service';
import { FindingDiagnostics } from '../diagnostics/finding-diagnostics';
import { ReviewSessionState } from '../state/review-session.state';
import type { MergeCoreSidebarProvider } from '../webview/mergecore-sidebar.provider';
import type { ReviewDisplayInfo } from '../webview/review-display-context';

export interface ProdRiskScanDeps {
  readonly diagnostics: FindingDiagnostics;
  readonly session: ReviewSessionState;
  readonly sidebar: MergeCoreSidebarProvider;
}

/**
 * Registers the "What Breaks In Prod?" scanner command.
 *
 * The scanner is pack-aware by construction (the service merges built-in
 * and pack-shipped rules in `@mergecore/intelligence`), so adding a new
 * pack with `prod-risks.json` makes it appear in this command's output
 * without any change here.
 *
 * Presentation reuses the existing review panel / diagnostics pipeline
 * so operators see the findings next to ordinary review results, with
 * the same severity styling and file navigation.
 */
export function registerProdRiskScanCommand(
  context: vscode.ExtensionContext,
  deps: ProdRiskScanDeps
): void {
  const service = new ProdRiskScanService();

  context.subscriptions.push(
    vscode.commands.registerCommand('mergecore.scanProdRisks', async () => {
      const root = pickWorkspaceRoot();
      if (!root) {
        void vscode.window.showWarningMessage(
          'MergeCore: open a folder to run the "What Breaks In Prod?" scan.'
        );
        return;
      }

      let profile: ProjectProfile | undefined;
      try {
        profile = await getProjectProfileCached(root);
      } catch (e) {
        MergeCoreLogger.shared.warn(
          `Project profile collection failed before prod-risk scan: ${asMessage(e)}`
        );
      }

      try {
        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: 'MergeCore: scanning for what breaks in prod…',
            cancellable: true,
          },
          async (progress, token) => {
            const outcome = await service.scan({
              workspaceRoot: root,
              profile,
              progress,
              token,
            });

            if (token.isCancellationRequested) {
              return;
            }

            await publishProdRiskResult(outcome.review.findings, outcome.review.score, outcome.review.summary, root, outcome.findingsByFile, profile, deps);

            if (outcome.review.findings.length === 0) {
              void vscode.window.showInformationMessage(
                'MergeCore: nothing obviously broken by the local scan. The full senior-style reviewer still catches higher-order issues.'
              );
            } else {
              void vscode.window.showInformationMessage(
                `MergeCore: prod-risk scan flagged ${outcome.review.findings.length} finding(s). Open the MergeCore panel for details.`
              );
            }
          }
        );
      } catch (e) {
        const message = asMessage(e);
        if (message !== 'cancelled') {
          MergeCoreLogger.shared.error('Prod-risk scan failed', e);
          void vscode.window.showErrorMessage(`MergeCore: prod-risk scan failed — ${message}`);
        }
      }
    })
  );
}

function pickWorkspaceRoot(): string | undefined {
  const active = vscode.window.activeTextEditor?.document.uri;
  if (active) {
    const folder = vscode.workspace.getWorkspaceFolder(active);
    if (folder) {
      return folder.uri.fsPath;
    }
  }
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

/**
 * Wire the scan output into the three presentation surfaces the
 * extension already owns:
 *  - Sidebar webview (via {@link MergeCoreSidebarProvider.showResult})
 *  - Problems panel (via {@link FindingDiagnostics} per file)
 *  - Session state so "Copy report as Markdown" works on prod-risk runs
 */
async function publishProdRiskResult(
  findings: readonly Finding[],
  score: number,
  summary: string | undefined,
  workspaceRoot: string,
  findingsByFile: ReadonlyMap<string, readonly Finding[]>,
  profile: ProjectProfile | undefined,
  deps: ProdRiskScanDeps
): Promise<void> {
  const display = buildProdRiskDisplayInfo(workspaceRoot, profile);

  // Pick a "primary" URI to anchor the session state on — the first
  // file with findings, or the workspace root when clean. This is the
  // document the user sees highlighted if they click through.
  const firstFile = findingsByFile.keys().next().value as string | undefined;
  const anchorUri = firstFile
    ? vscode.Uri.file(joinPath(workspaceRoot, firstFile))
    : vscode.Uri.file(workspaceRoot);

  deps.session.set({ findings, score, summary }, anchorUri, display);

  // Replace prior review/prod-risk squiggles, then apply per-file diagnostics.
  deps.diagnostics.clearAll();
  for (const [rel, items] of findingsByFile) {
    const uri = vscode.Uri.file(joinPath(workspaceRoot, rel));
    try {
      const doc = await vscode.workspace.openTextDocument(uri);
      deps.diagnostics.setForDocument(doc, items);
    } catch {
      // File may have been deleted between scan and publish — skip.
    }
  }

  await deps.sidebar.showResult({ findings, score, summary }, display);
}

function buildProdRiskDisplayInfo(
  workspaceRoot: string,
  profile: ProjectProfile | undefined
): ReviewDisplayInfo {
  const parts: string[] = [];
  if (profile) {
    for (const signal of profile.signals) {
      const label = titleCase(signal.replace(/^(path|js|php):/, '').replace(/[-_]/g, ' '));
      if (!parts.includes(label)) {
        parts.push(label);
      }
    }
  }
  const stackLine = parts.length > 0 ? parts.join(' · ') : 'Workspace scan';
  const fileLabel = basename(workspaceRoot);
  return {
    stackLine,
    fileLabel,
    levelBadge: 'Prod-Risk',
    levelTitle: 'What Breaks In Prod? — local scan',
    conventions: profile?.conventions?.map((c) => ({
      id: c.id,
      label: c.label,
      confidence: c.confidence,
      category: c.category,
    })),
  };
}

function joinPath(root: string, rel: string): string {
  if (rel.length === 0) {
    return root;
  }
  const sep = root.endsWith('/') || root.endsWith('\\') ? '' : '/';
  return `${root}${sep}${rel}`;
}

function basename(p: string): string {
  const parts = p.split(/[/\\]/).filter((x) => x.length > 0);
  return parts[parts.length - 1] ?? p;
}

function titleCase(s: string): string {
  return s.replace(/\b\w/g, (m) => m.toUpperCase());
}

function asMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
