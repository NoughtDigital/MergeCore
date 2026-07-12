/**
 * Scope resolvers turn a review level + current editor state into a concrete
 * {@link ReviewRequest}. Each level gets its own resolver so we can add a new
 * level (e.g. "hotfix", "release") without editing the core register-commands
 * dispatcher; register a new resolver and the rest of the plumbing picks it up.
 *
 * Resolvers are intentionally *pure scope selection*: they decide the wire
 * scope (selection/file/git-diff), the input content, the label, and any
 * level-specific notes. They do NOT know about personas, secrets, quotas or
 * throttling — the shared command runner handles those uniformly.
 *
 * Every resolver returns `undefined` when it cannot produce a valid request
 * (no editor, empty selection, empty diff, …) and first shows a user-visible
 * warning so the caller can quietly bail out.
 */

import * as vscode from 'vscode';
import type { ReviewLevelId } from '../../domain/review-levels';
import type { ReviewScope } from '../../domain/review-types';
import { extractEnclosingFunction } from './enclosing-function';
import type { GitDiffService } from '../../infrastructure/git-diff.service';

export interface ResolvedScope {
  readonly scope: ReviewScope;
  readonly document: vscode.TextDocument;
  readonly label: string;
  readonly content: string;
  readonly selectionSnippet?: string;
  /** Throttle bucket key; keeps per-level rate limiting independent. */
  readonly throttleKey: string;
}

export interface ScopeResolverContext {
  readonly gitDiff: GitDiffService;
  /** Opens a virtual diff doc when there is no active editor to anchor to. */
  readonly openVirtualDiffDoc: (diffText: string, languageId?: string) => Promise<vscode.TextDocument>;
}

export type ScopeResolver = (ctx: ScopeResolverContext) => Promise<ResolvedScope | undefined>;

const RESOLVERS: Readonly<Record<ReviewLevelId, ScopeResolver>> = {
  quick: resolveQuickReview,
  file: resolveFileReview,
  flow: resolveFlowReview,
  pr: resolvePrReview,
  disaster: resolveDisasterReview,
};

export function resolverFor(levelId: ReviewLevelId): ScopeResolver {
  return RESOLVERS[levelId] ?? resolveFileReview;
}

/**
 * Quick Review — the user wants to check the function the cursor is in.
 *
 * Resolution order:
 *  1. Explicit selection (user narrowed it themselves)
 *  2. Best-effort enclosing function around the cursor
 *  3. Last resort: refuse and tell the user what to do.
 *
 * We never silently review the whole file here — that would defeat the
 * point of "Quick" and surprise the user who picked the smallest lens.
 */
async function resolveQuickReview(): Promise<ResolvedScope | undefined> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    void vscode.window.showWarningMessage('MergeCore: no active editor.');
    return undefined;
  }

  const selection = editor.selection;
  if (!selection.isEmpty) {
    const text = editor.document.getText(selection);
    return {
      scope: 'selection',
      document: editor.document,
      label: editor.document.uri.fsPath,
      content: text,
      selectionSnippet: text,
      throttleKey: 'review.quick',
    };
  }

  const fn = extractEnclosingFunction(editor.document, selection.active);
  if (fn) {
    return {
      scope: 'selection',
      document: editor.document,
      label: `${editor.document.uri.fsPath} (${fn.label})`,
      content: fn.text,
      selectionSnippet: fn.text,
      throttleKey: 'review.quick',
    };
  }

  void vscode.window.showInformationMessage(
    'MergeCore Quick Review: could not detect an enclosing function. Select the code you want reviewed and try again.'
  );
  return undefined;
}

/** File Review — the active file end-to-end. */
async function resolveFileReview(): Promise<ResolvedScope | undefined> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    void vscode.window.showWarningMessage('MergeCore: no active editor.');
    return undefined;
  }
  const doc = editor.document;
  return {
    scope: 'file',
    document: doc,
    label: doc.fileName,
    content: doc.getText(),
    throttleKey: 'review.file',
  };
}

/**
 * Flow Review — the active file, reviewed as the centre of a business flow.
 *
 * The wire scope is still `file`: the pipeline's related-context collector
 * is already responsible for assembling linked files (routes, services,
 * schema, tests). The level id flips the prompt emphasis to "trace the
 * flow", and the sidebar badge tells the user which lens was used.
 * This keeps Flow Review free for any language pack (PHP/Laravel,
 * TS/Node, Python, …) without a pack-specific graph here.
 */
async function resolveFlowReview(): Promise<ResolvedScope | undefined> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    void vscode.window.showWarningMessage('MergeCore: Flow Review needs an active file to anchor the flow.');
    return undefined;
  }
  const doc = editor.document;
  return {
    scope: 'file',
    document: doc,
    label: doc.fileName,
    content: doc.getText(),
    throttleKey: 'review.flow',
  };
}

export type GitReviewMode = 'working' | 'staged' | 'pr';

/**
 * Resolve a git-diff review for a specific mode:
 * - `working` — unstaged working-tree diff only
 * - `staged` — staged (`--cached`) diff only
 * - `pr` — prefer staged when non-empty, else fall back to working tree
 */
export async function resolveGitDiffReview(
  ctx: ScopeResolverContext,
  mode: GitReviewMode
): Promise<ResolvedScope | undefined> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    void vscode.window.showWarningMessage('MergeCore: open a workspace folder first.');
    return undefined;
  }

  const root = folder.uri.fsPath;
  let diffText = '';
  let labelFallback = 'git-diff';

  if (mode === 'working') {
    diffText = (await ctx.gitDiff.readDiff(root, 'working')).trim();
    labelFallback = 'git-working-diff';
    if (!diffText) {
      void vscode.window.showInformationMessage(
        'MergeCore: no working-tree changes detected. Make a change first.'
      );
      return undefined;
    }
  } else if (mode === 'staged') {
    diffText = (await ctx.gitDiff.readDiff(root, 'staged')).trim();
    labelFallback = 'git-staged-diff';
    if (!diffText) {
      void vscode.window.showInformationMessage(
        'MergeCore: no staged changes detected. Stage changes with git add first.'
      );
      return undefined;
    }
  } else {
    const staged = (await ctx.gitDiff.readDiff(root, 'staged')).trim();
    const working = staged.length > 0 ? '' : (await ctx.gitDiff.readDiff(root, 'working')).trim();
    diffText = staged.length > 0 ? staged : working;
    labelFallback = staged.length > 0 ? 'git-staged-diff' : 'git-diff';
    if (!diffText) {
      void vscode.window.showInformationMessage(
        'MergeCore PR Review: no staged or working-tree changes detected. Make a change first.'
      );
      return undefined;
    }
  }

  const editor = vscode.window.activeTextEditor;
  const label = editor?.document.uri.fsPath ?? labelFallback;
  const document = editor?.document ?? (await ctx.openVirtualDiffDoc(diffText, 'diff'));

  return {
    scope: 'git-diff',
    document,
    label,
    content: diffText,
    throttleKey: mode === 'pr' ? 'review.pr' : `review.git.${mode}`,
  };
}

/**
 * PR Review — the changed files prepared for a pull request.
 *
 * Prefers the staged diff when non-empty, otherwise falls back to the
 * working-tree diff.
 */
async function resolvePrReview(ctx: ScopeResolverContext): Promise<ResolvedScope | undefined> {
  return resolveGitDiffReview(ctx, 'pr');
}

/**
 * Disaster Review — find everything wrong with the active file.
 *
 * The wire scope stays `file` (the pipeline's related-context collector
 * still fires, so neighbours and config are in play), but the level id
 * asks the LLM to do a broad, unsparing sweep up to the findings cap.
 */
async function resolveDisasterReview(): Promise<ResolvedScope | undefined> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    void vscode.window.showWarningMessage('MergeCore: Disaster Review needs an active file.');
    return undefined;
  }
  const doc = editor.document;
  return {
    scope: 'file',
    document: doc,
    label: doc.fileName,
    content: doc.getText(),
    throttleKey: 'review.disaster',
  };
}
