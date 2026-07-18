import * as fs from 'fs';
import * as path from 'path';
import type {
  AdapterCapabilityLevel,
  AdapterDiagnostic,
  DependencyEdge,
  DocumentChunk,
  LanguageAdapter,
  LanguageAdapterCapabilities,
  LanguageProjectHint,
  SymbolRecord,
} from '../contracts';
import { chunkFile, chunkMarkdown, chunkPhp } from '../rag/chunker';
import { sha256 } from '../rag/hash';
import type { RagChunk } from '../rag/types';
import { extractJsTsDependencies, extractJsTsSymbols } from './js-ts-extract';
import {
  collectPhpInvalidationTargets,
  detectPhpProject,
  extractPhpCallersOrReferences,
  extractPhpDependencies,
  extractPhpDiagnostics,
  extractPhpSymbols,
  extractPhpTestRelationships,
  extractPhpTypeRelationships,
  loadComposerPsr4Map,
} from './php-extract';

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

function caps(partial: {
  projectDetection?: AdapterCapabilityLevel;
  parsing?: AdapterCapabilityLevel;
  symbolExtraction?: AdapterCapabilityLevel;
  importsAndDependencies?: AdapterCapabilityLevel;
  callersOrReferences?: AdapterCapabilityLevel;
  typeRelationships?: AdapterCapabilityLevel;
  testRelationships?: AdapterCapabilityLevel;
  diagnostics?: AdapterCapabilityLevel;
  incrementalInvalidation?: AdapterCapabilityLevel;
  prefersCompilerGraph?: boolean;
}): LanguageAdapterCapabilities {
  return {
    fileExtensionDetection: true,
    projectDetection: partial.projectDetection ?? 'none',
    parsing: partial.parsing ?? 'none',
    symbolExtraction: partial.symbolExtraction ?? 'none',
    importsAndDependencies: partial.importsAndDependencies ?? 'none',
    callersOrReferences: partial.callersOrReferences ?? 'none',
    typeRelationships: partial.typeRelationships ?? 'none',
    testRelationships: partial.testRelationships ?? 'none',
    diagnostics: partial.diagnostics ?? 'none',
    incrementalInvalidation: partial.incrementalInvalidation ?? 'none',
    ...(partial.prefersCompilerGraph ? { prefersCompilerGraph: true } : {}),
  };
}

abstract class BaseAdapter implements LanguageAdapter {
  abstract readonly adapterId: string;
  abstract readonly languageId: string;
  abstract readonly extensions: readonly string[];
  abstract readonly capabilities: LanguageAdapterCapabilities;

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

  extractCallersOrReferences(_path: string, _content: string): DependencyEdge[] {
    return [];
  }

  extractTypeRelationships(_path: string, _content: string): DependencyEdge[] {
    return [];
  }

  extractTestRelationships(_path: string, _content: string): DependencyEdge[] {
    return [];
  }

  extractDiagnostics(_path: string, _content: string): AdapterDiagnostic[] {
    return [];
  }

  collectInvalidationTargets(
    changedPath: string,
    edges: readonly DependencyEdge[]
  ): readonly string[] {
    const changed = changedPath.replace(/\\/g, '/');
    const out = new Set<string>();
    for (const e of edges) {
      if (e.toPath === changed && e.fromPath !== changed) out.add(e.fromPath);
      if (e.fromPath === changed && e.toPath && e.toPath !== changed) out.add(e.toPath);
    }
    return [...out];
  }
}

export class TypeScriptLanguageAdapter extends BaseAdapter {
  readonly adapterId = 'typescript';
  readonly languageId = 'typescript';
  readonly extensions = ['.ts', '.tsx'] as const;
  readonly capabilities = caps({
    projectDetection: 'deterministic',
    parsing: 'deterministic',
    symbolExtraction: 'deterministic',
    importsAndDependencies: 'deterministic',
    callersOrReferences: 'deterministic',
    typeRelationships: 'deterministic',
    testRelationships: 'deterministic',
    diagnostics: 'heuristic',
    incrementalInvalidation: 'deterministic',
    prefersCompilerGraph: true,
  });

  detectProject(
    workspaceRoot: string,
    topLevelNames: readonly string[]
  ): LanguageProjectHint | undefined {
    const names = new Set(topLevelNames.map((n) => n.toLowerCase()));
    const signals: string[] = [];
    if (names.has('tsconfig.json')) signals.push('tsconfig.json');
    if (names.has('package.json')) {
      try {
        const raw = fs.readFileSync(path.join(workspaceRoot, 'package.json'), 'utf8');
        if (/"typescript"\s*:/.test(raw)) signals.push('typescript-dep');
      } catch {
        // ignore
      }
    }
    if (signals.length === 0) return undefined;
    return {
      languageId: 'typescript',
      adapterId: this.adapterId,
      confidence: names.has('tsconfig.json') ? 'high' : 'medium',
      signals,
    };
  }

  chunk(filePath: string, content: string): DocumentChunk[] {
    const fileHash = sha256(content);
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
  readonly adapterId = 'javascript';
  readonly languageId = 'javascript';
  readonly extensions = ['.js', '.jsx', '.mjs', '.cjs'] as const;
  readonly capabilities = caps({
    projectDetection: 'heuristic',
    parsing: 'deterministic',
    symbolExtraction: 'deterministic',
    importsAndDependencies: 'deterministic',
    callersOrReferences: 'deterministic',
    typeRelationships: 'heuristic',
    testRelationships: 'deterministic',
    diagnostics: 'heuristic',
    incrementalInvalidation: 'deterministic',
    prefersCompilerGraph: true,
  });

  detectProject(
    _workspaceRoot: string,
    topLevelNames: readonly string[]
  ): LanguageProjectHint | undefined {
    const names = new Set(topLevelNames.map((n) => n.toLowerCase()));
    if (!names.has('package.json')) return undefined;
    return {
      languageId: 'javascript',
      adapterId: this.adapterId,
      confidence: 'medium',
      signals: ['package.json'],
    };
  }

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
  readonly adapterId = 'markdown';
  readonly languageId = 'markdown';
  readonly extensions = ['.md', '.markdown'] as const;
  readonly capabilities = caps({
    parsing: 'heuristic',
    symbolExtraction: 'none',
    importsAndDependencies: 'none',
  });

  chunk(filePath: string, content: string): DocumentChunk[] {
    const fileHash = sha256(content);
    return chunkMarkdown(filePath, content, fileHash).map(ragToDocumentChunk);
  }
}

export class PhpLanguageAdapter extends BaseAdapter {
  readonly adapterId = 'php';
  readonly languageId = 'php';
  readonly extensions = ['.php', '.blade.php'] as const;
  readonly capabilities = caps({
    projectDetection: 'deterministic',
    parsing: 'heuristic',
    symbolExtraction: 'heuristic',
    importsAndDependencies: 'heuristic',
    callersOrReferences: 'heuristic',
    typeRelationships: 'heuristic',
    testRelationships: 'heuristic',
    diagnostics: 'heuristic',
    incrementalInvalidation: 'heuristic',
  });

  private readonly workspaceRoot: string | undefined;
  private namespaceMap: ReadonlyMap<string, string> | undefined;

  constructor(workspaceRoot?: string) {
    super();
    this.workspaceRoot = workspaceRoot;
  }

  private ctx() {
    if (!this.namespaceMap) {
      this.namespaceMap = loadComposerPsr4Map(this.workspaceRoot);
    }
    return {
      workspaceRoot: this.workspaceRoot,
      namespaceMap: this.namespaceMap,
      adapterId: this.adapterId,
    };
  }

  detectProject(
    workspaceRoot: string,
    topLevelNames: readonly string[]
  ): LanguageProjectHint | undefined {
    return detectPhpProject(workspaceRoot, topLevelNames);
  }

  chunk(filePath: string, content: string): DocumentChunk[] {
    const fileHash = sha256(content);
    return chunkPhp(filePath, content, fileHash).map(ragToDocumentChunk);
  }

  extractSymbols(filePath: string, content: string): SymbolRecord[] {
    return extractPhpSymbols(filePath, content, this.ctx());
  }

  extractDependencies(filePath: string, content: string): DependencyEdge[] {
    return extractPhpDependencies(filePath, content, this.ctx());
  }

  extractCallersOrReferences(filePath: string, content: string): DependencyEdge[] {
    return extractPhpCallersOrReferences(filePath, content, this.ctx());
  }

  extractTypeRelationships(filePath: string, content: string): DependencyEdge[] {
    return extractPhpTypeRelationships(filePath, content, this.ctx());
  }

  extractTestRelationships(filePath: string, content: string): DependencyEdge[] {
    return extractPhpTestRelationships(filePath, content, this.ctx());
  }

  extractDiagnostics(filePath: string, content: string): AdapterDiagnostic[] {
    return extractPhpDiagnostics(filePath, content);
  }

  collectInvalidationTargets(
    changedPath: string,
    edges: readonly DependencyEdge[]
  ): readonly string[] {
    return collectPhpInvalidationTargets(changedPath, edges);
  }
}

/** Fallback for JSON/YAML/config and unknown text. */
export class GenericLanguageAdapter extends BaseAdapter {
  readonly adapterId = 'generic';
  readonly languageId = 'generic';
  readonly extensions = ['.json', '.yml', '.yaml', '.env.example', '.cursorrules'] as const;
  readonly capabilities = caps({
    parsing: 'heuristic',
  });
}

export interface DefaultLanguageAdaptersOptions {
  readonly workspaceRoot?: string;
}

export function defaultLanguageAdapters(
  options: DefaultLanguageAdaptersOptions = {}
): readonly LanguageAdapter[] {
  return [
    new TypeScriptLanguageAdapter(),
    new JavaScriptLanguageAdapter(),
    new MarkdownLanguageAdapter(),
    new PhpLanguageAdapter(options.workspaceRoot),
    new GenericLanguageAdapter(),
  ];
}

export function resolveLanguageAdapter(
  filePath: string,
  adapters: readonly LanguageAdapter[]
): LanguageAdapter {
  for (const adapter of adapters) {
    if (adapter.supports(filePath)) {
      return adapter;
    }
  }
  return new GenericLanguageAdapter();
}

/** Detect all languages present via adapter project hints + file extensions. */
export function detectWorkspaceLanguages(
  workspaceRoot: string,
  topLevelNames: readonly string[],
  adapters: readonly LanguageAdapter[] = defaultLanguageAdapters({ workspaceRoot })
): readonly LanguageProjectHint[] {
  const hints: LanguageProjectHint[] = [];
  for (const adapter of adapters) {
    const hint = adapter.detectProject?.(workspaceRoot, topLevelNames);
    if (hint) hints.push(hint);
  }
  return hints;
}

/**
 * Collect all graph edges an adapter can produce for a file.
 * Deduplicates by edge id.
 */
export function collectAdapterEdges(
  adapter: LanguageAdapter,
  filePath: string,
  content: string
): DependencyEdge[] {
  const raw: DependencyEdge[] = [
    ...adapter.extractDependencies(filePath, content),
    ...(adapter.extractCallersOrReferences?.(filePath, content) ?? []),
    ...(adapter.extractTypeRelationships?.(filePath, content) ?? []),
    ...(adapter.extractTestRelationships?.(filePath, content) ?? []),
  ];
  const seen = new Set<string>();
  const out: DependencyEdge[] = [];
  for (const e of raw) {
    if (seen.has(e.id)) continue;
    seen.add(e.id);
    out.push(e);
  }
  return out;
}

export function stampAdapterId(
  symbols: readonly SymbolRecord[],
  adapterId: string
): SymbolRecord[] {
  return symbols.map((s) =>
    s.adapterId ? s : { ...s, adapterId }
  );
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
