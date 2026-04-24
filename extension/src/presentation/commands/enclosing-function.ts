/**
 * Best-effort enclosing function extractor.
 *
 * Rationale
 * ---------
 * Quick Review should scope to the function the cursor sits in. We deliberately
 * avoid VS Code's language-server symbol API here because it requires a running
 * language server for each language and would silently fail on packs that
 * ship in the future without one (Swift, Rust, …). This extractor is therefore
 * a heuristic that works on any text file the extension's supported languages
 * can land in today, and degrades safely: if we cannot confidently locate a
 * function, the caller falls back to asking the user to select the range.
 *
 * Strategy (language-agnostic):
 *  1. Scan upward from the cursor looking for the first line whose pattern
 *     looks like a function/method declaration in one of the supported packs
 *     (PHP, JS/TS, Python, Go, Swift, Rust, Java, C#, Ruby, Vue script block).
 *  2. From that line, find the matching closing brace (or dedent, for Python
 *     and Ruby-style blocks) and return the full range.
 *  3. Cap the extracted text at a generous upper bound so a weirdly huge
 *     function cannot blow the selection quota silently.
 */

import * as vscode from 'vscode';

const MAX_FUNCTION_CHARS = 8_000;
const MAX_FUNCTION_LINES = 400;

export interface EnclosingFunction {
  readonly text: string;
  readonly label: string;
  readonly range: vscode.Range;
}

interface DeclarationMatch {
  readonly line: number;
  readonly label: string;
  /** True if this language uses indentation (Python) rather than braces. */
  readonly indentBased: boolean;
}

export function extractEnclosingFunction(
  doc: vscode.TextDocument,
  cursor: vscode.Position
): EnclosingFunction | undefined {
  const decl = findDeclarationAbove(doc, cursor);
  if (!decl) {
    return undefined;
  }

  const endLine = decl.indentBased
    ? findIndentEnd(doc, decl.line)
    : findBraceEnd(doc, decl.line);

  if (endLine <= decl.line) {
    return undefined;
  }

  const range = new vscode.Range(decl.line, 0, endLine, doc.lineAt(endLine).text.length);
  const text = doc.getText(range);
  if (!text.trim() || text.length > MAX_FUNCTION_CHARS || endLine - decl.line > MAX_FUNCTION_LINES) {
    return undefined;
  }
  return { text, label: decl.label, range };
}

/**
 * Walks upward from the cursor. We stop at the nearest plausible function/
 * method declaration; nested functions naturally win because they are closer.
 */
function findDeclarationAbove(
  doc: vscode.TextDocument,
  cursor: vscode.Position
): DeclarationMatch | undefined {
  for (let line = cursor.line; line >= 0; line--) {
    const text = doc.lineAt(line).text;
    const decl = matchDeclaration(text);
    if (decl) {
      return { line, label: decl.label, indentBased: decl.indentBased };
    }
  }
  return undefined;
}

interface DeclarationShape {
  readonly label: string;
  readonly indentBased: boolean;
}

/**
 * Regex list ordered by specificity. Each entry captures a human-readable
 * label (usually the function name) so we can show it in the review label.
 */
const DECLARATION_PATTERNS: ReadonlyArray<{
  readonly regex: RegExp;
  readonly indentBased: boolean;
  readonly label: (m: RegExpExecArray) => string;
}> = [
  // PHP methods + functions
  {
    regex: /^\s*(?:public|protected|private|static|final|abstract|\s)*\s*function\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/,
    indentBased: false,
    label: (m) => `${m[1]}()`,
  },
  // TS/JS: named functions, class methods, arrow assigned to const/let.
  {
    regex: /^\s*(?:export\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/,
    indentBased: false,
    label: (m) => `${m[1]}()`,
  },
  // Class-method shape: identifier(args) {  or  identifier(args): Type {
  // Guarded against control-flow keywords so `if (x) {` / `while (y) {` /
  // `for (…)` do not count as enclosing "functions".
  {
    regex: /^\s*(?:public|private|protected|static|async|override|\s)*\s*(?!if\b|while\b|for\b|switch\b|catch\b|return\b|do\b|else\b)([A-Za-z_$][A-Za-z0-9_$]*)\s*\([^)]*\)\s*(?::\s*[^{;]+)?\s*\{/,
    indentBased: false,
    label: (m) => `${m[1]}()`,
  },
  {
    regex: /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*(?:async\s+)?(?:function\b|\([^)]*\)\s*=>)/,
    indentBased: false,
    label: (m) => `${m[1]} =()`,
  },
  // Python
  {
    regex: /^(\s*)(?:async\s+)?def\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/,
    indentBased: true,
    label: (m) => `${m[2]}()`,
  },
  // Go
  {
    regex: /^\s*func\s+(?:\([^)]*\)\s*)?([A-Za-z_][A-Za-z0-9_]*)\s*\(/,
    indentBased: false,
    label: (m) => `${m[1]}()`,
  },
  // Rust
  {
    regex: /^\s*(?:pub(?:\s*\([^)]*\))?\s+)?(?:async\s+)?fn\s+([A-Za-z_][A-Za-z0-9_]*)/,
    indentBased: false,
    label: (m) => `${m[1]}()`,
  },
  // Swift
  {
    regex: /^\s*(?:public|internal|private|fileprivate|open|\s)*\s*func\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/,
    indentBased: false,
    label: (m) => `${m[1]}()`,
  },
  // Java / Kotlin / C#
  {
    regex: /^\s*(?:public|private|protected|internal|static|final|abstract|override|\s)+[A-Za-z_<>[\],\s]+\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/,
    indentBased: false,
    label: (m) => `${m[1]}()`,
  },
  // Ruby
  {
    regex: /^(\s*)def\s+(?:self\.)?([A-Za-z_][A-Za-z0-9_?!]*)/,
    indentBased: true,
    label: (m) => `${m[2]}`,
  },
];

function matchDeclaration(lineText: string): DeclarationShape | undefined {
  for (const pattern of DECLARATION_PATTERNS) {
    const m = pattern.regex.exec(lineText);
    if (m) {
      return { label: pattern.label(m), indentBased: pattern.indentBased };
    }
  }
  return undefined;
}

/**
 * Walks forward finding the matching closing brace for a brace-based
 * function. We ignore braces inside strings/comments cheaply: for a review
 * scoping heuristic, fewer false positives from quoted '{' are fine —
 * if the user has a pathological line they can select manually.
 */
function findBraceEnd(doc: vscode.TextDocument, startLine: number): number {
  let depth = 0;
  let seenOpen = false;
  const lastLine = Math.min(doc.lineCount - 1, startLine + MAX_FUNCTION_LINES);
  for (let line = startLine; line <= lastLine; line++) {
    const text = doc.lineAt(line).text;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (ch === '{') {
        depth++;
        seenOpen = true;
      } else if (ch === '}') {
        depth--;
        if (seenOpen && depth === 0) {
          return line;
        }
      }
    }
  }
  return startLine;
}

/**
 * Python/Ruby-style: the function body ends at the first non-blank line
 * whose indentation is less than or equal to the declaration's indentation.
 */
function findIndentEnd(doc: vscode.TextDocument, startLine: number): number {
  const startIndent = indentOf(doc.lineAt(startLine).text);
  const lastLine = Math.min(doc.lineCount - 1, startLine + MAX_FUNCTION_LINES);
  let lastBody = startLine;
  for (let line = startLine + 1; line <= lastLine; line++) {
    const text = doc.lineAt(line).text;
    if (text.trim() === '') {
      continue;
    }
    if (indentOf(text) <= startIndent) {
      return lastBody;
    }
    lastBody = line;
  }
  return lastBody;
}

function indentOf(text: string): number {
  let i = 0;
  while (i < text.length && (text[i] === ' ' || text[i] === '\t')) {
    i++;
  }
  return i;
}
