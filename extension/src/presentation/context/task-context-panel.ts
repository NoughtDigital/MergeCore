import * as path from 'path';
import * as vscode from 'vscode';
import {
  hashRelativePath,
  recordUsageEvent,
  type TaskContextDepth,
  type TaskContextPack,
} from '@mergecore/intelligence';
import { markdownToSafeHtml } from '../explain/explanation-markdown';

export interface TaskContextPanelState {
  readonly pack: TaskContextPack;
  readonly workspaceRoot: string;
  readonly savedPath?: string;
}

export interface TaskContextPanelActions {
  readonly regenerate: (input: {
    depth: TaskContextDepth;
    selectedFiles: readonly string[];
  }) => Promise<TaskContextPack>;
  readonly savePack: (pack: TaskContextPack) => Promise<string>;
}

let currentPanel: vscode.WebviewPanel | undefined;
let messageSub: vscode.Disposable | undefined;
let activeState: TaskContextPanelState | undefined;
let activeActions: TaskContextPanelActions | undefined;

function buildHtml(webview: vscode.Webview, state: TaskContextPanelState): string {
  const csp = [
    `default-src 'none'`,
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `script-src ${webview.cspSource} 'unsafe-inline'`,
  ].join('; ');
  const usedModel = state.pack.meta.modelProvider && state.pack.meta.modelProvider !== 'none';
  const banner = !usedModel
    ? `<div class="banner local">Deterministic task context — no model was used.</div>`
    : state.pack.meta.dataLeftMachine
      ? `<div class="banner model">External model — repository evidence left this machine. Structure remains deterministic.</div>`
      : `<div class="banner model">Local model wording — only retrieved evidence was sent. Structure remains deterministic.</div>`;
  const meta = `Depth: <code>${state.pack.meta.depth}</code> · confidence ${state.pack.meta.confidence.toFixed(2)} · files pinned: ${state.pack.meta.selectedFiles.length}${state.savedPath ? ` · saved <code>${state.savedPath}</code>` : ''}`;

  return `<!DOCTYPE html>
<html lang="en-GB">
<head>
<meta charset="UTF-8"/>
<meta http-equiv="Content-Security-Policy" content="${csp}"/>
<title>MergeCore Task Context</title>
<style>
  body { margin:0; font-family:var(--vscode-font-family); color:var(--vscode-editor-foreground); background:var(--vscode-editor-background); }
  .toolbar { position:sticky; top:0; z-index:2; display:flex; flex-wrap:wrap; gap:6px; padding:8px 12px; border-bottom:1px solid var(--vscode-panel-border,#444); background:var(--vscode-editor-background); }
  button { background:var(--vscode-button-background); color:var(--vscode-button-foreground); border:none; padding:4px 10px; cursor:pointer; font:inherit; }
  .banner { margin:12px 16px 0; padding:8px 12px; border-left:3px solid var(--vscode-descriptionForeground); }
  .banner.model { background:var(--vscode-inputValidation-warningBackground,#5c4a1e); }
  .banner.local { background:var(--vscode-inputValidation-infoBackground,#1e3a5f); }
  .meta { margin:8px 16px; color:var(--vscode-descriptionForeground); font-size:0.9em; }
  article { padding:8px 16px 48px; max-width:52rem; line-height:1.45; }
  article h1 { font-size:1.2rem; margin:1.1em 0 0.35em; }
  article pre { overflow:auto; padding:8px; background:var(--vscode-textCodeBlock-background,rgba(127,127,127,.12)); }
  article code { font-family:var(--vscode-editor-font-family,monospace); }
</style>
</head>
<body>
  <div class="toolbar" role="toolbar">
    <button type="button" data-action="copy">Copy</button>
    <button type="button" data-action="save">Save pack</button>
    <button type="button" data-action="regenerate">Regenerate</button>
    <button type="button" data-action="depth">Change depth</button>
    <button type="button" data-action="pins">Add/remove files</button>
    <button type="button" data-action="mcp">Send via MCP</button>
  </div>
  ${banner}
  <p class="meta">${meta}</p>
  <article>${markdownToSafeHtml(state.pack.markdown)}</article>
  <script>
    const vscode = acquireVsCodeApi();
    document.querySelectorAll('[data-action]').forEach((btn) => {
      btn.addEventListener('click', () => vscode.postMessage({ type: btn.getAttribute('data-action') }));
    });
  </script>
</body>
</html>`;
}

async function handleMessage(msg: { type?: string }): Promise<void> {
  const state = activeState;
  const actions = activeActions;
  if (!state || !actions) return;

  switch (msg.type) {
    case 'copy':
      await vscode.env.clipboard.writeText(state.pack.markdown);
      void vscode.window.showInformationMessage('Task context copied to clipboard.');
      break;
    case 'save': {
      const saved = await actions.savePack(state.pack);
      activeState = { ...state, savedPath: saved };
      if (currentPanel) {
        currentPanel.webview.html = buildHtml(currentPanel.webview, activeState);
      }
      void vscode.window.showInformationMessage(`Saved task context to ${saved}`);
      break;
    }
    case 'regenerate': {
      const pack = await actions.regenerate({
        depth: state.pack.meta.depth,
        selectedFiles: state.pack.meta.selectedFiles,
      });
      activeState = { ...state, pack, savedPath: undefined };
      if (currentPanel) {
        currentPanel.webview.html = buildHtml(currentPanel.webview, activeState);
      }
      break;
    }
    case 'depth': {
      const picked = await vscode.window.showQuickPick(
        [
          { label: 'Shallow', depth: 'shallow' as const },
          { label: 'Standard', depth: 'standard' as const },
          { label: 'Deep', depth: 'deep' as const },
        ],
        { title: 'Task context retrieval depth' }
      );
      if (!picked) return;
      const pack = await actions.regenerate({
        depth: picked.depth,
        selectedFiles: state.pack.meta.selectedFiles,
      });
      activeState = { ...state, pack, savedPath: undefined };
      if (currentPanel) {
        currentPanel.webview.html = buildHtml(currentPanel.webview, activeState);
      }
      break;
    }
    case 'pins': {
      const open = vscode.window.visibleTextEditors
        .filter((e) => e.document.uri.scheme === 'file')
        .map((e) => {
          const folder = vscode.workspace.getWorkspaceFolder(e.document.uri);
          if (!folder) return undefined;
          return path.relative(folder.uri.fsPath, e.document.uri.fsPath).replace(/\\/g, '/');
        })
        .filter((p): p is string => Boolean(p));
      const current = new Set(state.pack.meta.selectedFiles);
      const items = [...new Set([...open, ...state.pack.meta.selectedFiles])].map((f) => ({
        label: f,
        picked: current.has(f),
      }));
      const picked = await vscode.window.showQuickPick(items, {
        title: 'Pin files for task context',
        canPickMany: true,
      });
      if (!picked) return;
      const next = picked.map((p) => p.label);
      const nextSet = new Set(next);
      for (const f of next) {
        if (!current.has(f)) {
          void recordUsageEvent(state.workspaceRoot, {
            kind: 'manually_added_file',
            pathHash: hashRelativePath(f),
          }).catch(() => undefined);
        }
      }
      for (const f of current) {
        if (!nextSet.has(f)) {
          void recordUsageEvent(state.workspaceRoot, {
            kind: 'manually_removed_file',
            pathHash: hashRelativePath(f),
          }).catch(() => undefined);
        }
      }
      const pack = await actions.regenerate({
        depth: state.pack.meta.depth,
        selectedFiles: next,
      });
      activeState = { ...state, pack, savedPath: undefined };
      if (currentPanel) {
        currentPanel.webview.html = buildHtml(currentPanel.webview, activeState);
      }
      break;
    }
    case 'mcp': {
      await vscode.env.clipboard.writeText(state.pack.markdown);
      void vscode.window.showInformationMessage(
        'Task context copied. Use MCP tool mergecore_generate_task_context from an agent host, or paste this pack into the agent.'
      );
      break;
    }
    default:
      break;
  }
}

export function showTaskContextPanel(
  state: TaskContextPanelState,
  actions: TaskContextPanelActions
): void {
  activeState = state;
  activeActions = actions;
  const title = 'MergeCore Task Context';

  if (currentPanel) {
    currentPanel.title = title;
    currentPanel.webview.html = buildHtml(currentPanel.webview, state);
    currentPanel.reveal(vscode.ViewColumn.Beside, true);
    return;
  }

  const panel = vscode.window.createWebviewPanel(
    'mergecore.taskContext',
    title,
    { viewColumn: vscode.ViewColumn.Beside, preserveFocus: false },
    { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [] }
  );
  currentPanel = panel;
  panel.webview.html = buildHtml(panel.webview, state);
  messageSub?.dispose();
  messageSub = panel.webview.onDidReceiveMessage((msg) => {
    void handleMessage(msg as { type?: string });
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
