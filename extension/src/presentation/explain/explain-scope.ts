import * as path from 'path';
import type { RagStore, SymbolRecord } from '@mergecore/intelligence';
import {
  isTsJsLanguage,
  relativeWorkspacePath,
  resolveSymbolForHover,
} from '../hover/hover-assemble';

export const SUPPORTED_EXPLAIN_LANGS = [
  'typescript',
  'typescriptreact',
  'javascript',
  'javascriptreact',
] as const;

export type ExplainScopeErrorCode =
  | 'unsupported-scheme'
  | 'unsupported-language'
  | 'no-selection-or-symbol'
  | 'index-unavailable'
  | 'untrusted';

export interface ExplainScopeRange {
  readonly startLine: number;
  readonly endLine: number;
  readonly startColumn: number;
  readonly endColumn: number;
}

export interface ExplainScope {
  readonly workspaceRoot: string;
  readonly absPath: string;
  readonly relPath: string;
  readonly languageId: string;
  readonly selectedText: string;
  readonly range: ExplainScopeRange;
  readonly symbol?: SymbolRecord;
  readonly fromSelection: boolean;
}

export interface EditorLike {
  readonly document: {
    readonly uri: { readonly scheme: string; readonly fsPath: string };
    readonly languageId: string;
    readonly version: number;
    getText(range?: { start: { line: number; character: number }; end: { line: number; character: number } }): string;
    lineAt(line: number): { text: string; range: { end: { character: number } } };
  };
  readonly selection: {
    readonly isEmpty: boolean;
    readonly start: { line: number; character: number };
    readonly end: { line: number; character: number };
    readonly active: { line: number; character: number };
  };
}

export function validateExplainLanguage(languageId: string): boolean {
  return isTsJsLanguage(languageId);
}

/**
 * Resolve explain scope from editor selection or symbol under cursor.
 * Pure enough for unit tests with an EditorLike stub.
 */
export async function resolveExplainScope(input: {
  readonly editor: EditorLike;
  readonly workspaceRoot: string | undefined;
  readonly isTrusted: boolean;
  readonly store?: RagStore;
  readonly graphService?: {
    getSymbolAtPosition(
      file: string,
      position: { line: number; column: number }
    ): string | undefined;
    updateFile?(relPath: string, content: string): void;
  };
}): Promise<{ ok: true; scope: ExplainScope } | { ok: false; code: ExplainScopeErrorCode; message: string }> {
  if (!input.isTrusted) {
    return {
      ok: false,
      code: 'untrusted',
      message: 'MergeCore requires a trusted workspace to explain code.',
    };
  }

  const { editor } = input;
  if (editor.document.uri.scheme !== 'file') {
    return {
      ok: false,
      code: 'unsupported-scheme',
      message: 'Explain Selected Code only works on local files.',
    };
  }

  if (!validateExplainLanguage(editor.document.languageId)) {
    return {
      ok: false,
      code: 'unsupported-language',
      message:
        'Explain Selected Code supports TypeScript and JavaScript files only.',
    };
  }

  if (!input.workspaceRoot) {
    return {
      ok: false,
      code: 'index-unavailable',
      message: 'Open a workspace folder to explain code with repository context.',
    };
  }

  if (!input.store || input.store.chunkCount === 0) {
    return {
      ok: false,
      code: 'index-unavailable',
      message:
        'No local MergeCore index found. Run “MergeCore: Index Repository” first.',
    };
  }

  const workspaceRoot = input.workspaceRoot;
  const absPath = editor.document.uri.fsPath;
  const relPath = relativeWorkspacePath(workspaceRoot, absPath);

  // Warm graph buffer for current document
  try {
    input.graphService?.updateFile?.(relPath, editor.document.getText());
  } catch {
    // ignore
  }

  if (!editor.selection.isEmpty) {
    const start = editor.selection.start;
    const end = editor.selection.end;
    const selectedText = editor.document.getText({
      start,
      end,
    });
    if (!selectedText.trim()) {
      return {
        ok: false,
        code: 'no-selection-or-symbol',
        message: 'Selection is empty. Select code or place the cursor on a symbol.',
      };
    }
    // Prefer symbol if selection sits on one declaration
    let symbol: SymbolRecord | undefined;
    try {
      symbol = await resolveSymbolForHover(
        input.store,
        input.graphService,
        relPath,
        { line: start.line + 1, column: start.character + 1 }
      );
    } catch {
      symbol = undefined;
    }
    return {
      ok: true,
      scope: {
        workspaceRoot,
        absPath,
        relPath,
        languageId: editor.document.languageId,
        selectedText,
        range: {
          startLine: start.line + 1,
          endLine: end.line + 1,
          startColumn: start.character + 1,
          endColumn: end.character + 1,
        },
        symbol,
        fromSelection: true,
      },
    };
  }

  // Cursor: resolve symbol
  const active = editor.selection.active;
  let symbol: SymbolRecord | undefined;
  try {
    symbol = await resolveSymbolForHover(
      input.store,
      input.graphService,
      relPath,
      { line: active.line + 1, column: active.character + 1 }
    );
  } catch {
    symbol = undefined;
  }

  if (!symbol) {
    return {
      ok: false,
      code: 'no-selection-or-symbol',
      message:
        'No selection and no recognised symbol under the cursor. Select code or hover a function/class/interface.',
    };
  }

  const startLine = Math.max(0, symbol.location.startLine - 1);
  const endLine = Math.max(startLine, symbol.location.endLine - 1);
  const lines: string[] = [];
  for (let i = startLine; i <= endLine && i < 10_000; i++) {
    try {
      lines.push(editor.document.lineAt(i).text);
    } catch {
      break;
    }
  }
  const selectedText = lines.join('\n');

  return {
    ok: true,
    scope: {
      workspaceRoot,
      absPath,
      relPath,
      languageId: editor.document.languageId,
      selectedText,
      range: {
        startLine: symbol.location.startLine,
        endLine: symbol.location.endLine,
        startColumn: symbol.location.startColumn ?? 1,
        endColumn: symbol.location.endColumn ?? 1,
      },
      symbol,
      fromSelection: false,
    },
  };
}

export function basenamePath(p: string): string {
  return path.posix.basename(p.replace(/\\/g, '/'));
}
