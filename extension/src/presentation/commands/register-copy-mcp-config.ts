import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

export const COPY_MCP_CONFIG_COMMAND = 'mergecore.copyMcpConfig';

function resolveMcpEntryPoint(extensionPath: string): { command: string; args: string[] } {
  const distJs = path.join(extensionPath, '..', 'mcp', 'dist', 'index.js');
  const packaged = path.join(extensionPath, 'mcp', 'dist', 'index.js');
  if (fs.existsSync(distJs)) {
    return { command: 'node', args: [distJs] };
  }
  if (fs.existsSync(packaged)) {
    return { command: 'node', args: [packaged] };
  }
  return { command: 'npx', args: ['-y', 'mergecore-mcp'] };
}

export function buildMcpClientConfigs(workspaceRoot: string, extensionPath: string): {
  cursor: Record<string, unknown>;
  codex: Record<string, unknown>;
  combinedMarkdown: string;
} {
  const entry = resolveMcpEntryPoint(extensionPath);
  const env = {
    MERGECORE_WORKSPACE: workspaceRoot,
  };

  const cursor = {
    mcpServers: {
      mergecore: {
        command: entry.command,
        args: entry.args,
        env,
      },
    },
  };

  const codex = {
    mcp_servers: {
      mergecore: {
        command: entry.command,
        args: entry.args,
        env,
      },
    },
  };

  const combinedMarkdown = [
    '# MergeCore MCP client config',
    '',
    'Requires MERGECORE_WORKSPACE (set below). Optional: MERGECORE_ALLOWED_ROOTS.',
    '',
    '## Cursor (`.cursor/mcp.json`)',
    '',
    '```json',
    JSON.stringify(cursor, null, 2),
    '```',
    '',
    '## Codex (stdio MCP env block)',
    '',
    '```json',
    JSON.stringify(codex, null, 2),
    '```',
    '',
  ].join('\n');

  return { cursor, codex, combinedMarkdown };
}

export function registerCopyMcpConfig(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(COPY_MCP_CONFIG_COMMAND, async () => {
      const folder = vscode.workspace.workspaceFolders?.[0];
      if (!folder) {
        void vscode.window.showErrorMessage('Open a workspace folder before copying MCP config.');
        return;
      }
      const workspaceRoot = folder.uri.fsPath;
      const { combinedMarkdown, cursor } = buildMcpClientConfigs(
        workspaceRoot,
        context.extensionPath
      );

      const choice = await vscode.window.showQuickPick(
        [
          {
            label: 'Copy Cursor + Codex config',
            description: 'Both (default)',
            value: 'both' as const,
          },
          {
            label: 'Copy Cursor mcp.json only',
            value: 'cursor' as const,
          },
          {
            label: 'Write .cursor/mcp.json in workspace',
            value: 'write' as const,
          },
        ],
        { placeHolder: 'MergeCore MCP client config' }
      );
      if (!choice) return;

      if (choice.value === 'write') {
        const uri = vscode.Uri.joinPath(folder.uri, '.cursor', 'mcp.json');
        const enc = new TextEncoder();
        await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(folder.uri, '.cursor'));
        await vscode.workspace.fs.writeFile(uri, enc.encode(`${JSON.stringify(cursor, null, 2)}\n`));
        void vscode.window.showInformationMessage(`Wrote ${uri.fsPath}`);
        return;
      }

      const text =
        choice.value === 'cursor' ? JSON.stringify(cursor, null, 2) : combinedMarkdown;
      await vscode.env.clipboard.writeText(text);
      void vscode.window.showInformationMessage('MergeCore MCP client config copied to the clipboard.');
    })
  );
}
