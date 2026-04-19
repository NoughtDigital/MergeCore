import { execFile } from 'child_process';
import { promisify } from 'util';
import * as vscode from 'vscode';

const execFileAsync = promisify(execFile);

export type GitDiffMode = 'working' | 'staged';

export class GitDiffService {
  async readDiff(workspaceRoot: string, mode: GitDiffMode): Promise<string> {
    const args = mode === 'staged' ? ['diff', '--cached'] : ['diff'];
    const { stdout } = await execFileAsync('git', args, {
      cwd: workspaceRoot,
      maxBuffer: 20 * 1024 * 1024,
      windowsHide: true,
    });
    return stdout;
  }

  resolveWorkspaceRoot(uri: vscode.Uri): string | undefined {
    return vscode.workspace.getWorkspaceFolder(uri)?.uri.fsPath;
  }
}
