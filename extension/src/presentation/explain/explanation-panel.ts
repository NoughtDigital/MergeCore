import * as vscode from 'vscode';
import * as path from 'path';
import type { SelectedCodeExplanation } from './explain-selected-assemble';
import type { ExplainScope } from './explain-scope';
import { markdownToSafeHtml } from './explanation-markdown';

export interface ExplanationPanelState {
  readonly scope: ExplainScope;
  readonly explanation: SelectedCodeExplanation;
}

export interface ExplanationPanelActions {
  readonly buildContextPackMarkdown: (scope: ExplainScope) => Promise<string>;
}

let currentPanel: vscode.WebviewPanel | undefined;
let messageSub: vscode.Disposable | undefined;
let activeState: ExplanationPanelState | undefined;
let activeActions: ExplanationPanelActions | undefined;

function buildPanelHtml(
  webview: vscode.Webview,
  state: ExplanationPanelState
): string {
  const csp = [
    `default-src 'none'`,
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `script-src ${webview.cspSource} 'unsafe-inline'`,
  ].join('; ');

  const banner = state.explanation.modelTransmissionVisible
    ? `<div class="banner model">External/local model used — only retrieved evidence was sent.</div>`
    : `<div class="banner local">Deterministic explanation — no model was used.</div>`;

  const body = markdownToSafeHtml(state.explanation.markdown);

  return `<!DOCTYPE html>
<html lang="en-GB">
<head>
<meta charset="UTF-8"/>
<meta http-equiv="Content-Security-Policy" content="${csp}"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>MergeCore Explanation</title>
<style>
  :root {
    --bg: var(--vscode-editor-background);
    --fg: var(--vscode-editor-foreground);
    --border: var(--vscode-panel-border, #444);
    --btn-bg: var(--vscode-button-background);
    --btn-fg: var(--vscode-button-foreground);
    --muted: var(--vscode-descriptionForeground);
    --banner-bg: var(--vscode-inputValidation-infoBackground, #1e3a5f);
    --banner-model: var(--vscode-inputValidation-warningBackground, #5c4a1e);
  }
  body {
    margin: 0;
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    color: var(--fg);
    background: var(--bg);
  }
  .toolbar {
    position: sticky;
    top: 0;
    z-index: 2;
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    padding: 8px 12px;
    border-bottom: 1px solid var(--border);
    background: var(--bg);
  }
  button {
    background: var(--btn-bg);
    color: var(--btn-fg);
    border: none;
    padding: 4px 10px;
    cursor: pointer;
    font: inherit;
  }
  button:hover { filter: brightness(1.08); }
  .banner {
    margin: 12px 16px 0;
    padding: 8px 12px;
    border-left: 3px solid var(--muted);
    background: var(--banner-bg);
  }
  .banner.model { background: var(--banner-model); }
  article {
    padding: 8px 16px 48px;
    max-width: 52rem;
    line-height: 1.45;
  }
  article h1 { font-size: 1.25rem; margin: 1.2em 0 0.4em; }
  article h2, article h3 { font-size: 1.1rem; margin: 1em 0 0.35em; }
  article pre {
    overflow: auto;
    padding: 8px;
    background: var(--vscode-textCodeBlock-background, rgba(127,127,127,0.12));
  }
  article code { font-family: var(--vscode-editor-font-family, monospace); }
  article blockquote {
    margin: 0.6em 0;
    padding: 0.4em 0.8em;
    border-left: 3px solid var(--muted);
    color: var(--muted);
  }
  article a { color: var(--vscode-textLink-foreground); }
  .readonly-hint {
    color: var(--muted);
    font-size: 0.85em;
    margin: 4px 16px 0;
  }
</style>
</head>
<body>
  <div class="toolbar" role="toolbar" aria-label="Explanation actions">
    <button type="button" data-action="copy">Copy explanation</button>
    <button type="button" data-action="save">Save as Markdown</button>
    <button type="button" data-action="contextPack">Generate context pack</button>
    <button type="button" data-action="openSource">Open source</button>
    <button type="button" data-action="report">Report incorrect context</button>
  </div>
  <p class="readonly-hint">Read-only view — edit via Save as Markdown if you need a file.</p>
  ${banner}
  <article>${body}</article>
  <script>
    const vscode = acquireVsCodeApi();
    document.querySelectorAll('[data-action]').forEach((btn) => {
      btn.addEventListener('click', () => {
        vscode.postMessage({ type: btn.getAttribute('data-action') });
      });
    });
    document.querySelector('article')?.addEventListener('click', (e) => {
      const a = e.target.closest('a[data-href]');
      if (!a) return;
      e.preventDefault();
      vscode.postMessage({ type: 'openLink', href: a.getAttribute('data-href') });
    });
  </script>
</body>
</html>`;
}

async function openSourceAtScope(scope: ExplainScope): Promise<void> {
  const uri = vscode.Uri.file(scope.absPath);
  const doc = await vscode.workspace.openTextDocument(uri);
  const editor = await vscode.window.showTextDocument(doc, {
    preview: true,
    viewColumn: vscode.ViewColumn.One,
  });
  const start = new vscode.Position(
    Math.max(0, scope.range.startLine - 1),
    Math.max(0, scope.range.startColumn - 1)
  );
  const end = new vscode.Position(
    Math.max(0, scope.range.endLine - 1),
    Math.max(0, scope.range.endColumn - 1)
  );
  editor.selection = new vscode.Selection(start, end);
  editor.revealRange(
    new vscode.Range(start, end),
    vscode.TextEditorRevealType.InCenter
  );
}

async function saveMarkdown(markdown: string, suggestedName: string): Promise<void> {
  const uri = await vscode.window.showSaveDialog({
    defaultUri: vscode.Uri.file(suggestedName),
    filters: { Markdown: ['md'] },
  });
  if (!uri) return;
  await vscode.workspace.fs.writeFile(uri, Buffer.from(markdown, 'utf8'));
  void vscode.window.showInformationMessage(`Saved explanation to ${uri.fsPath}`);
}

async function generateContextPack(scope: ExplainScope): Promise<void> {
  try {
    const markdown = await activeActions!.buildContextPackMarkdown(scope);
    const doc = await vscode.workspace.openTextDocument({
      content: markdown,
      language: 'markdown',
    });
    await vscode.window.showTextDocument(doc, {
      preview: true,
      viewColumn: vscode.ViewColumn.Beside,
    });
  } catch (err) {
    void vscode.window.showWarningMessage(
      `Could not build context pack: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

async function reportIncorrectContext(state: ExplanationPanelState): Promise<void> {
  const note = await vscode.window.showInputBox({
    prompt: 'What looks wrong in this explanation? (stored locally only)',
    placeHolder: 'e.g. wrong caller, missing import, invented path…',
  });
  if (note === undefined) return;
  const { scope, explanation } = state;
  const body = [
    '# MergeCore incorrect-context report',
    '',
    '_Local only — not sent over the network._',
    '',
    `Path: \`${scope.relPath}\``,
    `Range: L${scope.range.startLine}–${scope.range.endLine}`,
    scope.symbol
      ? `Symbol: \`${scope.symbol.name}\` (\`${scope.symbol.id}\`)`
      : 'Symbol: _(selection only)_',
    `Model used: ${explanation.usedModel ? 'yes' : 'no'}`,
    '',
    '## User note',
    '',
    note || '_(none)_',
    '',
    '## Explanation snapshot',
    '',
    explanation.markdown.slice(0, 8000),
  ].join('\n');
  const doc = await vscode.workspace.openTextDocument({
    content: body,
    language: 'markdown',
  });
  await vscode.window.showTextDocument(doc, { preview: true });
}

async function openRelativeLink(
  scope: ExplainScope,
  href: string
): Promise<void> {
  const m = href.match(/^([^#:]+)(?:#L?|:|@)(\d+)/);
  const rel = m?.[1] ?? href.split('#')[0] ?? href;
  const line = m?.[2] ? Number(m[2]) : 1;
  const abs = path.isAbsolute(rel)
    ? rel
    : path.join(scope.workspaceRoot, rel);
  try {
    const uri = vscode.Uri.file(abs);
    const doc = await vscode.workspace.openTextDocument(uri);
    const editor = await vscode.window.showTextDocument(doc, {
      preview: true,
      viewColumn: vscode.ViewColumn.One,
    });
    const pos = new vscode.Position(Math.max(0, line - 1), 0);
    editor.selection = new vscode.Selection(pos, pos);
    editor.revealRange(
      new vscode.Range(pos, pos),
      vscode.TextEditorRevealType.InCenter
    );
  } catch {
    void vscode.window.showWarningMessage(`Could not open ${href}`);
  }
}

async function handleMessage(msg: { type?: string; href?: string }): Promise<void> {
  const state = activeState;
  if (!state) return;
  switch (msg.type) {
    case 'copy':
      await vscode.env.clipboard.writeText(state.explanation.markdown);
      void vscode.window.showInformationMessage('Explanation copied to clipboard.');
      break;
    case 'save': {
      const base = state.scope.symbol?.name ?? 'selection';
      await saveMarkdown(
        state.explanation.markdown,
        path.join(state.scope.workspaceRoot, `mergecore-explain-${base}.md`)
      );
      break;
    }
    case 'contextPack':
      await generateContextPack(state.scope);
      break;
    case 'openSource':
      await openSourceAtScope(state.scope);
      break;
    case 'report':
      await reportIncorrectContext(state);
      break;
    case 'openLink':
      if (msg.href) await openRelativeLink(state.scope, msg.href);
      break;
    default:
      break;
  }
}

/**
 * Show (or refresh) the read-only MergeCore Explanation webview panel.
 */
export function showExplanationPanel(
  state: ExplanationPanelState,
  actions: ExplanationPanelActions
): void {
  activeState = state;
  activeActions = actions;
  const title = 'MergeCore Explanation';

  if (currentPanel) {
    currentPanel.title = title;
    currentPanel.webview.html = buildPanelHtml(currentPanel.webview, state);
    currentPanel.reveal(vscode.ViewColumn.Beside, true);
    return;
  }

  const panel = vscode.window.createWebviewPanel(
    'mergecore.explanation',
    title,
    { viewColumn: vscode.ViewColumn.Beside, preserveFocus: false },
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [],
    }
  );
  currentPanel = panel;
  panel.webview.html = buildPanelHtml(panel.webview, state);
  messageSub?.dispose();
  messageSub = panel.webview.onDidReceiveMessage((msg) => {
    void handleMessage(msg as { type?: string; href?: string });
  });
  panel.onDidDispose(() => {
    if (currentPanel === panel) {
      currentPanel = undefined;
      messageSub?.dispose();
      messageSub = undefined;
      activeState = undefined;
      activeActions = undefined;
    }
  });
}
