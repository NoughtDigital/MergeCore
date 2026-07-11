/**
 * Lightweight PHP symbol resolution for hover explanations.
 */
export interface PhpSymbolInfo {
  readonly symbol: string;
  readonly kind: 'method' | 'function' | 'class' | 'unknown';
  readonly startLine: number;
  readonly endLine: number;
  readonly code: string;
}

export function resolvePhpSymbolAt(
  documentText: string,
  lineIndex: number
): PhpSymbolInfo | undefined {
  const lines = documentText.split(/\r?\n/);
  if (lineIndex < 0 || lineIndex >= lines.length) {
    return undefined;
  }

  let className: string | undefined;
  for (let i = 0; i <= lineIndex; i++) {
    const classMatch = lines[i]?.match(
      /^\s*(?:abstract\s+|final\s+)?(?:class|interface|trait|enum)\s+([A-Za-z_][\w]*)/
    );
    if (classMatch) {
      className = classMatch[1];
    }
  }

  // Search upward for the enclosing function/method
  for (let i = lineIndex; i >= 0; i--) {
    const line = lines[i] ?? '';
    const methodMatch = line.match(
      /^\s*(?:public|protected|private|final|static|\s)*\s*function\s+&?([A-Za-z_][\w]*)\s*\(/
    );
    if (methodMatch) {
      const name = methodMatch[1] ?? 'function';
      const end = findBlockEnd(lines, i);
      if (lineIndex > end) {
        continue;
      }
      const symbol = className ? `${className}::${name}` : name;
      return {
        symbol,
        kind: className ? 'method' : 'function',
        startLine: i,
        endLine: end,
        code: lines.slice(i, end + 1).join('\n'),
      };
    }

    const classMatch = line.match(
      /^\s*(?:abstract\s+|final\s+)?(?:class|interface|trait|enum)\s+([A-Za-z_][\w]*)/
    );
    if (classMatch && i === lineIndex) {
      const end = findBlockEnd(lines, i);
      return {
        symbol: classMatch[1] ?? 'class',
        kind: 'class',
        startLine: i,
        endLine: Math.min(end, i + 40),
        code: lines.slice(i, Math.min(end, i + 40) + 1).join('\n'),
      };
    }
  }

  // Fallback: word under approximate line
  const word = lines[lineIndex]?.match(/[A-Za-z_][\w]*/)?.[0];
  if (!word) {
    return undefined;
  }
  const start = Math.max(0, lineIndex - 5);
  const end = Math.min(lines.length - 1, lineIndex + 15);
  return {
    symbol: className ? `${className}::${word}` : word,
    kind: 'unknown',
    startLine: start,
    endLine: end,
    code: lines.slice(start, end + 1).join('\n'),
  };
}

function findBlockEnd(lines: readonly string[], start: number): number {
  let depth = 0;
  let seenBrace = false;
  for (let i = start; i < lines.length; i++) {
    const line = lines[i] ?? '';
    for (const ch of line) {
      if (ch === '{') {
        depth++;
        seenBrace = true;
      } else if (ch === '}') {
        depth--;
        if (seenBrace && depth <= 0) {
          return i;
        }
      }
    }
    if (!seenBrace && /;\s*$/.test(line) && i > start) {
      return i;
    }
  }
  return Math.min(lines.length - 1, start + 80);
}
