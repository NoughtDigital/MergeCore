import * as vscode from 'vscode';
import { ReviewCodeUseCase } from '../../application/review-code.use-case';
import type { ReviewRequest, ReviewResult } from '../../domain/review-types';
import {
  DEFAULT_PERSONA_ID,
  REVIEW_PERSONAS,
  getPersonaById,
  isPersonaId,
  type ReviewPersonaId,
} from '../../domain/review-personas';
import { GitDiffService } from '../../infrastructure/git-diff.service';
import { MergeCoreLogger } from '../../infrastructure/logger';
import { getProjectProfileCached } from '../../infrastructure/project-profile-cache';
import { PatchApplier } from '../../infrastructure/patch-applier';
import { DEFAULT_CLIENT_QUOTA, quotaFor } from '../../infrastructure/quotas';
import { collectRelatedContext } from '../../infrastructure/related-context.collector';
import { RequestThrottle } from '../../infrastructure/request-throttle';
import { scanForSecrets, redactSecrets } from '../../infrastructure/secret-scrubber';
import type { MergeCoreSecretStore } from '../../infrastructure/secret-store';
import { buildReviewDisplayInfo } from '../webview/review-display-context';
import { formatReviewAsMarkdown } from '../webview/review-markdown';
import { FindingDiagnostics } from '../diagnostics/finding-diagnostics';
import { ReviewSessionState } from '../state/review-session.state';
import type { MergeCoreSidebarProvider } from '../webview/mergecore-sidebar.provider';
import { confirmApplyWithDiff } from '../apply-confirmation';

interface Deps {
  review: ReviewCodeUseCase;
  gitDiff: GitDiffService;
  diagnostics: FindingDiagnostics;
  session: ReviewSessionState;
  sidebar: MergeCoreSidebarProvider;
  patchApplier: PatchApplier;
  secrets: MergeCoreSecretStore;
  throttle: RequestThrottle;
  abortSignals: { current: AbortController | undefined };
}

export function registerMergeCoreCommands(context: vscode.ExtensionContext, deps: Deps): void {
  const { review, gitDiff, session, patchApplier, secrets, throttle, abortSignals } = deps;

  const run = async (
    key: string,
    factory: () => Promise<{ request: ReviewRequest; document: vscode.TextDocument } | undefined>
  ): Promise<void> => {
    try {
      const built = await factory();
      if (!built) {
        return;
      }

      const scrubbed = await preflightScrubAndGuard(built.request);
      if (!scrubbed.proceed) {
        return;
      }
      const safeRequest: ReviewRequest = scrubbed.request;

      const rejection = throttle.check(key);
      if (rejection) {
        void vscode.window.showWarningMessage(`MergeCore: ${rejection}`);
        return;
      }
      const release = throttle.begin(key);

      const controller = new AbortController();
      abortSignals.current = controller;

      try {
        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: 'MergeCore: reviewing…',
            cancellable: true,
          },
          async (_progress, token) => {
            token.onCancellationRequested(() => controller.abort(new Error('cancelled')));
            const result = await review.execute(safeRequest);
            await publishResult(result, built.document, safeRequest, deps);
          }
        );
      } finally {
        release();
        if (abortSignals.current === controller) {
          abortSignals.current = undefined;
        }
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      MergeCoreLogger.shared.error(`Command failed: ${key}`, e);
      void vscode.window.showErrorMessage(`MergeCore: ${message}`);
    }
  };

  context.subscriptions.push(
    vscode.commands.registerCommand('mergecore.reviewSelection', () =>
      run('reviewSelection', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
          void vscode.window.showWarningMessage('MergeCore: no active editor.');
          return undefined;
        }
        const selection = editor.selection;
        if (selection.isEmpty) {
          void vscode.window.showWarningMessage('MergeCore: select code to review.');
          return undefined;
        }
        const text = editor.document.getText(selection);
        const request = await buildRequest(editor.document, 'selection', editor.document.uri.fsPath, text, text);
        return { request, document: editor.document };
      })
    ),
    vscode.commands.registerCommand('mergecore.reviewFile', () =>
      run('reviewFile', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
          void vscode.window.showWarningMessage('MergeCore: no active editor.');
          return undefined;
        }
        const doc = editor.document;
        const request = await buildRequest(doc, 'file', doc.fileName, doc.getText(), undefined);
        return { request, document: doc };
      })
    ),
    vscode.commands.registerCommand('mergecore.reviewGitDiff', () =>
      run('reviewGitDiff', async () => {
        const editor = vscode.window.activeTextEditor;
        const folder = vscode.workspace.workspaceFolders?.[0];
        if (!folder) {
          void vscode.window.showWarningMessage('MergeCore: open a workspace folder first.');
          return undefined;
        }
        const diffText = await gitDiff.readDiff(folder.uri.fsPath, 'working');
        if (!diffText.trim()) {
          void vscode.window.showInformationMessage('MergeCore: git diff is empty.');
          return undefined;
        }
        const pathLabel = editor?.document.uri.fsPath ?? 'git-diff';
        const request = await buildGitDiffRequest(folder.uri.fsPath, pathLabel, diffText);
        const document = editor?.document ?? (await openVirtualDiffDoc(diffText));
        return { request, document };
      })
    ),
    vscode.commands.registerCommand('mergecore.reviewStagedDiff', () =>
      run('reviewStagedDiff', async () => {
        const editor = vscode.window.activeTextEditor;
        const folder = vscode.workspace.workspaceFolders?.[0];
        if (!folder) {
          void vscode.window.showWarningMessage('MergeCore: open a workspace folder first.');
          return undefined;
        }
        const diffText = await gitDiff.readDiff(folder.uri.fsPath, 'staged');
        if (!diffText.trim()) {
          void vscode.window.showInformationMessage('MergeCore: staged diff is empty.');
          return undefined;
        }
        const pathLabel = editor?.document.uri.fsPath ?? 'git-staged-diff';
        const request = await buildGitDiffRequest(folder.uri.fsPath, pathLabel, diffText);
        const document = editor?.document ?? (await openVirtualDiffDoc(diffText));
        return { request, document };
      })
    ),
    vscode.commands.registerCommand('mergecore.showSidebar', async () => {
      await vscode.commands.executeCommand('workbench.view.extension.mergecore');
    }),
    vscode.commands.registerCommand('mergecore.showLogs', () => {
      MergeCoreLogger.shared.show();
    }),
    vscode.commands.registerCommand('mergecore.chooseReviewerPersona', async () => {
      const current = readConfiguredPersonaId();
      const items: (vscode.QuickPickItem & { id: ReviewPersonaId })[] = REVIEW_PERSONAS.map((p) => ({
        id: p.id,
        label: p.title,
        description: p.id === current ? 'Currently selected' : undefined,
        detail: p.tagline,
      }));
      const picked = await vscode.window.showQuickPick(items, {
        title: 'MergeCore: choose reviewer persona',
        placeHolder: `Current: ${getPersonaById(current).title}`,
        ignoreFocusOut: true,
      });
      if (!picked) {
        return;
      }
      try {
        await vscode.workspace
          .getConfiguration('mergecore')
          .update('reviewerPersona', picked.id, vscode.ConfigurationTarget.Global);
      } catch (e) {
        MergeCoreLogger.shared.error('Failed to persist reviewerPersona setting', e);
        void vscode.window.showErrorMessage(
          'MergeCore: could not save the persona setting. Check file permissions on your user settings.'
        );
        return;
      }
      void vscode.window.showInformationMessage(
        `MergeCore reviewer persona: ${picked.label}. Re-run a review to apply.`
      );
    }),
    vscode.commands.registerCommand('mergecore.setApiToken', async () => {
      const existing = await secrets.getApiToken();
      const token = await vscode.window.showInputBox({
        prompt: 'Paste your MergeCore API token. It is stored in the OS keychain (SecretStorage) and never written to settings.json.',
        placeHolder: existing ? 'A token is already stored. Paste a new one to replace it.' : 'sk-… or your provider token',
        password: true,
        ignoreFocusOut: true,
      });
      if (token === undefined) {
        return;
      }
      await secrets.setApiToken(token);
      if (token.trim().length === 0) {
        void vscode.window.showInformationMessage('MergeCore: API token cleared.');
      } else {
        void vscode.window.showInformationMessage('MergeCore: API token stored in the OS keychain.');
      }
    }),
    vscode.commands.registerCommand('mergecore.clearApiToken', async () => {
      await secrets.clearApiToken();
      void vscode.window.showInformationMessage('MergeCore: API token cleared from the OS keychain.');
    }),
    vscode.commands.registerCommand('mergecore.exportReviewMarkdown', async () => {
      const snap = session.getSnapshot();
      if (!snap?.result) {
        void vscode.window.showWarningMessage('MergeCore: run a review before exporting.');
        return;
      }
      const md = formatReviewAsMarkdown(snap.result, snap.display);
      await vscode.env.clipboard.writeText(md);
      void vscode.window.showInformationMessage('MergeCore: report copied to clipboard.');
    }),
    vscode.commands.registerCommand('mergecore.applyImprovedCode', async () => {
      const snap = session.getSnapshot();
      const editor = vscode.window.activeTextEditor;
      if (!snap?.result.improvedCode) {
        void vscode.window.showWarningMessage('MergeCore: no improved code to apply.');
        return;
      }
      const doc = await pickTargetDocument(snap.target, editor);
      if (!doc) {
        return;
      }
      const label = shortenLabel(doc.uri.fsPath);
      const confirmed = await confirmApplyWithDiff({
        target: doc,
        proposedContent: snap.result.improvedCode,
        label,
        kind: 'improved',
      });
      if (!confirmed) {
        return;
      }
      try {
        await patchApplier.commitText(doc, snap.result.improvedCode);
        void vscode.window.showInformationMessage('MergeCore: applied improved code. Use Cmd/Ctrl+Z to revert.');
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        MergeCoreLogger.shared.error('applyImprovedCode failed', e);
        void vscode.window.showErrorMessage(message);
      }
    }),
    vscode.commands.registerCommand('mergecore.applyPatch', async () => {
      const snap = session.getSnapshot();
      const editor = vscode.window.activeTextEditor;
      if (!snap?.result.patch) {
        void vscode.window.showWarningMessage('MergeCore: no patch to apply.');
        return;
      }
      const doc = await pickTargetDocument(snap.target, editor);
      if (!doc) {
        return;
      }
      let next: string;
      try {
        next = patchApplier.previewUnifiedPatch(doc, snap.result.patch);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        MergeCoreLogger.shared.error('applyPatch preview failed', e);
        void vscode.window.showErrorMessage(message);
        return;
      }
      const label = shortenLabel(doc.uri.fsPath);
      const confirmed = await confirmApplyWithDiff({
        target: doc,
        proposedContent: next,
        label,
        kind: 'patch-result',
      });
      if (!confirmed) {
        return;
      }
      try {
        await patchApplier.commitText(doc, next);
        void vscode.window.showInformationMessage('MergeCore: applied patch. Use Cmd/Ctrl+Z to revert.');
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        MergeCoreLogger.shared.error('applyPatch commit failed', e);
        void vscode.window.showErrorMessage(message);
      }
    })
  );
}

async function publishResult(
  result: ReviewResult,
  document: vscode.TextDocument,
  request: ReviewRequest,
  deps: {
    diagnostics: FindingDiagnostics;
    session: ReviewSessionState;
    sidebar: MergeCoreSidebarProvider;
  }
): Promise<void> {
  const display = buildReviewDisplayInfo(request);
  deps.session.set(result, document.uri, display);
  deps.diagnostics.setForDocument(document, result.findings);
  await deps.sidebar.showResult(result, display);
}

async function buildRequest(
  doc: vscode.TextDocument,
  scope: ReviewRequest['scope'],
  label: string,
  content: string,
  selectionSnippet: string | undefined
): Promise<ReviewRequest> {
  const workspaceRoot = vscode.workspace.getWorkspaceFolder(doc.uri)?.uri.fsPath;
  const projectProfile = workspaceRoot ? await getProjectProfileCached(workspaceRoot) : undefined;
  const relatedContext = workspaceRoot
    ? await collectRelatedContext({
        scope,
        workspaceRoot,
        filePath: doc.uri.fsPath,
        content,
      })
    : undefined;
  return {
    scope,
    workspaceRoot,
    projectProfile,
    relatedContext,
    filePath: doc.uri.fsPath,
    languageId: doc.languageId,
    label,
    content,
    selectionSnippet,
    reviewerPersonaId: readConfiguredPersonaId(),
  };
}

async function buildGitDiffRequest(
  workspaceRoot: string,
  label: string,
  diffText: string
): Promise<ReviewRequest> {
  const projectProfile = await getProjectProfileCached(workspaceRoot);
  const relatedContext = await collectRelatedContext({
    scope: 'git-diff',
    workspaceRoot,
    filePath: label,
    content: diffText,
  });
  return {
    scope: 'git-diff',
    workspaceRoot,
    projectProfile,
    relatedContext,
    filePath: label,
    languageId: 'diff',
    label,
    content: diffText,
    reviewerPersonaId: readConfiguredPersonaId(),
  };
}

/**
 * Resolve the configured reviewer persona.
 *
 * We treat an unknown/removed persona id as the default rather than throwing:
 * a legacy workspace setting should never block a review.
 */
function readConfiguredPersonaId(): ReviewPersonaId {
  const raw = vscode.workspace
    .getConfiguration('mergecore')
    .get<string>('reviewerPersona', DEFAULT_PERSONA_ID);
  return isPersonaId(raw) ? raw : DEFAULT_PERSONA_ID;
}

async function openVirtualDiffDoc(diffText: string): Promise<vscode.TextDocument> {
  const doc = await vscode.workspace.openTextDocument({
    content: diffText,
    language: 'diff',
  });
  await vscode.window.showTextDocument(doc, { preview: true, preserveFocus: true });
  return doc;
}

async function pickTargetDocument(
  preferred: vscode.Uri,
  editor: vscode.TextEditor | undefined
): Promise<vscode.TextDocument | undefined> {
  if (editor && editor.document.uri.toString() === preferred.toString()) {
    return editor.document;
  }
  const doc = await vscode.workspace.openTextDocument(preferred);
  await vscode.window.showTextDocument(doc);
  return doc;
}

interface ScrubDecision {
  readonly proceed: boolean;
  readonly request: ReviewRequest;
}

/**
 * Size-check and secret-scrub the request *before* it reaches any adapter. If
 * secrets are detected the user gets a modal with three choices: redact and
 * continue, abort, or view the output channel. We never upload the raw match.
 */
async function preflightScrubAndGuard(request: ReviewRequest): Promise<ScrubDecision> {
  const limit = quotaFor(request.scope);
  if (request.content.length > limit) {
    void vscode.window.showErrorMessage(
      `MergeCore: input is ${request.content.length.toLocaleString()} characters, over the ${limit.toLocaleString()} limit for this scope. Narrow the selection or split the diff.`
    );
    return { proceed: false, request };
  }
  if ((request.selectionSnippet?.length ?? 0) > DEFAULT_CLIENT_QUOTA.maxInputChars) {
    void vscode.window.showErrorMessage(
      'MergeCore: selection snippet exceeds the per-selection size limit.'
    );
    return { proceed: false, request };
  }

  const contentHits = scanForSecrets(request.content);
  const snippetHits = request.selectionSnippet ? scanForSecrets(request.selectionSnippet) : [];
  const contextHits = (request.relatedContext?.files ?? []).map((file) => ({
    file,
    hits: scanForSecrets(file.excerpt),
  }));
  const contextHitCount = contextHits.reduce((sum, item) => sum + item.hits.length, 0);
  const totalHits = contentHits.length + snippetHits.length + contextHitCount;

  if (totalHits === 0) {
    return { proceed: true, request };
  }

  const uniqueRules = new Set<string>();
  for (const h of contentHits) uniqueRules.add(h.rule);
  for (const h of snippetHits) uniqueRules.add(h.rule);
  for (const item of contextHits) {
    for (const h of item.hits) uniqueRules.add(h.rule);
  }
  const ruleList = [...uniqueRules].join(', ');

  MergeCoreLogger.shared.warn(
    `Secret scan found ${totalHits} match(es) before upload: ${ruleList}.`
  );

  const redactAction = 'Redact & continue';
  const cancelAction = 'Cancel';
  const showLogs = 'Show details';
  const choice = await vscode.window.showWarningMessage(
    `MergeCore: detected ${totalHits} potential secret(s) (${ruleList}) in the review input. Upload cannot proceed with them intact.`,
    { modal: true, detail: 'Redact & continue replaces each match with <REDACTED:rule-id> locally before the request is sent.' },
    redactAction,
    showLogs,
    cancelAction
  );

  if (choice === showLogs) {
    MergeCoreLogger.shared.show();
    return { proceed: false, request };
  }
  if (choice !== redactAction) {
    return { proceed: false, request };
  }

  const redactedRequest: ReviewRequest = {
    ...request,
    content: redactSecrets(request.content, contentHits),
    selectionSnippet: request.selectionSnippet
      ? redactSecrets(request.selectionSnippet, snippetHits)
      : request.selectionSnippet,
    relatedContext: request.relatedContext
      ? {
          ...request.relatedContext,
          files: request.relatedContext.files.map((file) => {
            const hits = contextHits.find((item) => item.file === file)?.hits ?? [];
            return {
              ...file,
              excerpt: redactSecrets(file.excerpt, hits),
            };
          }),
          totalExcerptChars: request.relatedContext.files.reduce((sum, file) => {
            const hits = contextHits.find((item) => item.file === file)?.hits ?? [];
            return sum + redactSecrets(file.excerpt, hits).length;
          }, 0),
        }
      : request.relatedContext,
  };
  return { proceed: true, request: redactedRequest };
}

function shortenLabel(fsPath: string): string {
  const parts = fsPath.split(/[/\\]/);
  const tail = parts.slice(-2).join('/');
  return tail || fsPath;
}
