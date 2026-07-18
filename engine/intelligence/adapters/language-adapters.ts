import type {
  DependencyEdge,
  DocumentChunk,
  LanguageAdapter,
  SymbolRecord,
} from '../contracts';
import { chunkFile, chunkMarkdown, chunkPhp } from '../rag/chunker';
import { sha256 } from '../rag/hash';
import type { RagChunk } from '../rag/types';
import { extractJsTsDependencies, extractJsTsSymbols } from './js-ts-extract';

function ragToDocumentChunk(chunk: RagChunk): DocumentChunk {
  return {
    id: chunk.id,
    path: chunk.path,
    text: chunk.text,
    startLine: chunk.startLine,
    endLine: chunk.endLine,
    kind: chunk.kind,
    symbol: chunk.symbol,
    weight: chunk.weight,
    fileHash: chunk.fileHash,
  };
}

function extOf(filePath: string): string {
  const base = filePath.replace(/\\/g, '/').split('/').pop() ?? filePath;
  const lower = base.toLowerCase();
  if (lower.endsWith('.blade.php')) {
    return '.blade.php';
  }
  const dot = lower.lastIndexOf('.');
  return dot >= 0 ? lower.slice(dot) : '';
}

abstract class BaseAdapter implements LanguageAdapter {
  abstract readonly languageId: string;
  abstract readonly extensions: readonly string[];

  supports(filePath: string): boolean {
    return this.extensions.includes(extOf(filePath));
  }

  chunk(filePath: string, content: string): DocumentChunk[] {
    return chunkFile(filePath, content).map(ragToDocumentChunk);
  }

  extractSymbols(_path: string, _content: string): SymbolRecord[] {
    return [];
  }

  extractDependencies(_path: string, _content: string): DependencyEdge[] {
    return [];
  }
}

export class TypeScriptLanguageAdapter extends BaseAdapter {
  readonly languageId = 'typescript';
  readonly extensions = ['.ts', '.tsx'] as const;

  chunk(filePath: string, content: string): DocumentChunk[] {
    const fileHash = sha256(content);
    // Prefer symbol-aware windows: reuse config windowing via chunkFile, then
    // annotate with extracted symbol names when a chunk overlaps a symbol.
    const chunks = chunkFile(filePath, content).map(ragToDocumentChunk);
    const symbols = this.extractSymbols(filePath, content);
    return annotateChunksWithSymbols(chunks, symbols, fileHash);
  }

  extractSymbols(filePath: string, content: string): SymbolRecord[] {
    return extractJsTsSymbols(filePath, content, 'typescript');
  }

  extractDependencies(filePath: string, content: string): DependencyEdge[] {
    return extractJsTsDependencies(filePath, content);
  }
}

export class JavaScriptLanguageAdapter extends BaseAdapter {
  readonly languageId = 'javascript';
  readonly extensions = ['.js', '.jsx', '.mjs', '.cjs'] as const;

  chunk(filePath: string, content: string): DocumentChunk[] {
    const fileHash = sha256(content);
    const chunks = chunkFile(filePath, content).map(ragToDocumentChunk);
    const symbols = this.extractSymbols(filePath, content);
    return annotateChunksWithSymbols(chunks, symbols, fileHash);
  }

  extractSymbols(filePath: string, content: string): SymbolRecord[] {
    return extractJsTsSymbols(filePath, content, 'javascript');
  }

  extractDependencies(filePath: string, content: string): DependencyEdge[] {
    return extractJsTsDependencies(filePath, content);
  }
}

export class MarkdownLanguageAdapter extends BaseAdapter {
  readonly languageId = 'markdown';
  readonly extensions = ['.md', '.markdown'] as const;

  chunk(filePath: string, content: string): DocumentChunk[] {
    const fileHash = sha256(content);
    return chunkMarkdown(filePath, content, fileHash).map(ragToDocumentChunk);
  }
}

export class PhpLanguageAdapter extends BaseAdapter {
  readonly languageId = 'php';
  readonly extensions = ['.php', '.blade.php'] as const;

  chunk(filePath: string, content: string): DocumentChunk[] {
    const fileHash = sha256(content);
    return chunkPhp(filePath, content, fileHash).map(ragToDocumentChunk);
  }

  extractSymbols(filePath: string, content: string): SymbolRecord[] {
    const chunks = chunkPhp(filePath, content, sha256(content));
    const out: SymbolRecord[] = [];
    for (const c of chunks) {
      if (!c.symbol) {
        continue;
      }
      out.push({
        id: `php:${filePath}:${c.symbol}:${c.startLine}`,
        name: c.symbol.includes('::') ? (c.symbol.split('::').pop() ?? c.symbol) : c.symbol,
        kind: c.symbol.includes('::') ? 'method' : 'class',
        location: {
          path: filePath.replace(/\\/g, '/'),
          startLine: c.startLine,
          endLine: c.endLine,
        },
        language: 'php',
        containerName: c.symbol.includes('::') ? c.symbol.split('::')[0] : undefined,
      });
    }
    return out;
  }
}

/** Fallback for JSON/YAML/config and unknown text. */
export class GenericLanguageAdapter extends BaseAdapter {
  readonly languageId = 'generic';
  readonly extensions = ['.json', '.yml', '.yaml', '.env.example', '.cursorrules'] as const;
}

const DEFAULT_ADAPTERS: readonly LanguageAdapter[] = [
  new TypeScriptLanguageAdapter(),
  new JavaScriptLanguageAdapter(),
  new MarkdownLanguageAdapter(),
  new PhpLanguageAdapter(),
  new GenericLanguageAdapter(),
];

export function defaultLanguageAdapters(): readonly LanguageAdapter[] {
  return DEFAULT_ADAPTERS;
}

export function resolveLanguageAdapter(
  filePath: string,
  adapters: readonly LanguageAdapter[] = DEFAULT_ADAPTERS
): LanguageAdapter {
  for (const adapter of adapters) {
    if (adapter.supports(filePath)) {
      return adapter;
    }
  }
  return new GenericLanguageAdapter();
}

function annotateChunksWithSymbols(
  chunks: DocumentChunk[],
  symbols: readonly SymbolRecord[],
  _fileHash: string
): DocumentChunk[] {
  if (symbols.length === 0) {
    return chunks;
  }
  return chunks.map((chunk) => {
    if (chunk.symbol) {
      return chunk;
    }
    const hit = symbols.find(
      (s) => s.location.startLine <= chunk.endLine && s.location.endLine >= chunk.startLine
    );
    return hit ? { ...chunk, symbol: hit.name, kind: 'source' as const } : chunk;
  });
}
