import { chunkId, sha256 } from './hash';
import type { RagChunk, RagChunkKind } from './types';

export interface RawChunk {
  readonly symbol?: string;
  readonly text: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly kind: RagChunkKind;
  readonly weight: number;
}

const WINDOW = 80;
const OVERLAP = 12;

function sliceLines(lines: readonly string[], start: number, end: number): string {
  return lines.slice(start, end).join('\n');
}

/** Lightweight PHP class / method / function chunking. */
export function chunkPhp(path: string, content: string, fileHash: string): RagChunk[] {
  const lines = content.split(/\r?\n/);
  const raw: RawChunk[] = [];
  let className: string | undefined;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const classMatch = line.match(
      /^\s*(?:abstract\s+|final\s+)?(?:class|interface|trait|enum)\s+([A-Za-z_][\w]*)/
    );
    if (classMatch) {
      className = classMatch[1];
      const end = findBlockEnd(lines, i);
      raw.push({
        symbol: className,
        text: sliceLines(lines, i, end + 1),
        startLine: i + 1,
        endLine: end + 1,
        kind: 'source',
        weight: 1,
      });
      continue;
    }

    const methodMatch = line.match(
      /^\s*(?:public|protected|private|final|static|\s)*\s*function\s+&?([A-Za-z_][\w]*)\s*\(/
    );
    if (methodMatch) {
      const name = methodMatch[1] ?? 'function';
      const symbol = className ? `${className}::${name}` : name;
      const end = findBlockEnd(lines, i);
      raw.push({
        symbol,
        text: sliceLines(lines, i, end + 1),
        startLine: i + 1,
        endLine: end + 1,
        kind: 'source',
        weight: 1.1,
      });
    }
  }

  if (raw.length === 0) {
    return windowChunks(path, content, fileHash, 'source', 1);
  }

  return raw.map((r) => toChunk(path, fileHash, r));
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
    // Single-line abstract / interface method ending with ;
    if (!seenBrace && /;\s*$/.test(line) && i > start) {
      return i;
    }
  }
  return Math.min(lines.length - 1, start + WINDOW);
}

export function chunkMarkdown(
  path: string,
  content: string,
  fileHash: string,
  weight = 1.5
): RagChunk[] {
  const lines = content.split(/\r?\n/);
  const sections: RawChunk[] = [];
  let start = 0;
  let title = pathBase(path);

  for (let i = 0; i < lines.length; i++) {
    const heading = lines[i]?.match(/^(#{1,3})\s+(.+)\s*$/);
    if (heading && i > start) {
      const text = sliceLines(lines, start, i).trim();
      if (text.length > 0) {
        sections.push({
          symbol: title,
          text,
          startLine: start + 1,
          endLine: i,
          kind: 'memory',
          weight,
        });
      }
      start = i;
      title = (heading[2] ?? title).trim();
    }
  }

  const tail = sliceLines(lines, start, lines.length).trim();
  if (tail.length > 0) {
    sections.push({
      symbol: title,
      text: tail,
      startLine: start + 1,
      endLine: lines.length,
      kind: 'memory',
      weight,
    });
  }

  if (sections.length === 0) {
    return windowChunks(path, content, fileHash, 'memory', weight);
  }
  return sections.map((r) => toChunk(path, fileHash, r));
}

export function chunkConfig(path: string, content: string, fileHash: string): RagChunk[] {
  return windowChunks(path, content, fileHash, 'config', 0.9);
}

export function chunkFile(path: string, content: string, kindHint?: RagChunkKind): RagChunk[] {
  const fileHash = sha256(content);
  const lower = path.replace(/\\/g, '/').toLowerCase();

  if (kindHint === 'memory' || lower.endsWith('.md') || lower.endsWith('.markdown')) {
    const weight = kindHint === 'memory' ? 2 : isPriorityMemoryPath(lower) ? 2 : 1.4;
    return chunkMarkdown(path, content, fileHash, weight);
  }

  if (lower.endsWith('.php') || lower.endsWith('.blade.php')) {
    return chunkPhp(path, content, fileHash);
  }

  return chunkConfig(path, content, fileHash);
}

export function isPriorityMemoryPath(relPath: string): boolean {
  const base = relPath.replace(/\\/g, '/').split('/').pop()?.toLowerCase() ?? '';
  const priority = new Set([
    'readme.md',
    'architecture.md',
    'decisions.md',
    'agents.md',
    'contributing.md',
    'coding-standards.md',
    'agile.md',
    '.cursorrules',
  ]);
  if (priority.has(base)) {
    return true;
  }
  if (relPath.includes('.mergecore/') && base.endsWith('.md')) {
    return true;
  }
  return false;
}

function windowChunks(
  path: string,
  content: string,
  fileHash: string,
  kind: RagChunkKind,
  weight: number
): RagChunk[] {
  const lines = content.split(/\r?\n/);
  if (lines.length === 0 || (lines.length === 1 && (lines[0] ?? '') === '')) {
    return [];
  }
  const out: RagChunk[] = [];
  for (let start = 0; start < lines.length; start += WINDOW - OVERLAP) {
    const end = Math.min(lines.length, start + WINDOW);
    const text = sliceLines(lines, start, end).trim();
    if (text.length === 0) {
      continue;
    }
    out.push(
      toChunk(path, fileHash, {
        text,
        startLine: start + 1,
        endLine: end,
        kind,
        weight,
      })
    );
    if (end >= lines.length) {
      break;
    }
  }
  return out;
}

function toChunk(path: string, fileHash: string, raw: RawChunk): RagChunk {
  return {
    id: chunkId(path, raw.startLine, raw.endLine, raw.symbol),
    path,
    symbol: raw.symbol,
    kind: raw.kind,
    text: raw.text,
    startLine: raw.startLine,
    endLine: raw.endLine,
    weight: raw.weight,
    fileHash,
  };
}

function pathBase(path: string): string {
  return path.replace(/\\/g, '/').split('/').pop() ?? path;
}
