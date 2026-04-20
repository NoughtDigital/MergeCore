import { execFile } from 'child_process';
import { promisify } from 'util';
import * as vscode from 'vscode';

const execFileAsync = promisify(execFile);

export type GitDiffMode = 'working' | 'staged';

/**
 * Wraps `git diff` invocation. We use `execFile` (no shell) with a pinned argv
 * and a minimised environment so rogue `GIT_ASKPASS`, `GIT_TRACE` or custom
 * `GIT_CONFIG_GLOBAL` values inherited from the parent shell cannot alter
 * behaviour or leak credentials.
 */
export class GitDiffService {
  async readDiff(workspaceRoot: string, mode: GitDiffMode): Promise<string> {
    const args = mode === 'staged' ? ['diff', '--cached', '--no-color'] : ['diff', '--no-color'];
    const { stdout } = await execFileAsync('git', args, {
      cwd: workspaceRoot,
      maxBuffer: 20 * 1024 * 1024,
      windowsHide: true,
      timeout: 20_000,
      env: minimalGitEnv(),
    });
    return stdout;
  }

  resolveWorkspaceRoot(uri: vscode.Uri): string | undefined {
    return vscode.workspace.getWorkspaceFolder(uri)?.uri.fsPath;
  }
}

function minimalGitEnv(): NodeJS.ProcessEnv {
  const parent = process.env;
  const env: NodeJS.ProcessEnv = {
    PATH: parent.PATH ?? '',
    HOME: parent.HOME ?? '',
    LANG: 'C',
    LC_ALL: 'C',
    GIT_TERMINAL_PROMPT: '0',
  };
  if (parent.SystemRoot) {
    env.SystemRoot = parent.SystemRoot;
  }
  if (parent.USERPROFILE) {
    env.USERPROFILE = parent.USERPROFILE;
  }
  if (parent.APPDATA) {
    env.APPDATA = parent.APPDATA;
  }
  return env;
}
