import {
  extractJsTsDependencies,
  extractJsTsSymbols,
} from '../../adapters/js-ts-extract';
import type { DependencyEdge, SymbolRecord } from '../../contracts';
import { extractFileWithCompiler, symbolAtPosition } from './extract';
import { isTsJsPath, languageForTsJs, normaliseRel } from './paths';
import { TsProgramHost } from './program-host';

export interface FileGraphExtract {
  readonly symbols: readonly SymbolRecord[];
  readonly edges: readonly DependencyEdge[];
  readonly usedCompiler: boolean;
}

export interface TsJsCodeGraphService {
  readonly host: TsProgramHost;
  bootstrap(seedFiles?: ReadonlyMap<string, string>): void;
  updateFile(relPath: string, content: string): void;
  removeFile(relPath: string): void;
  extractFile(relPath: string, content: string): FileGraphExtract;
  getSymbolAtPosition(
    file: string,
    position: { line: number; column: number }
  ): string | undefined;
  dispose(): void;
}

/**
 * Orchestrates incremental Program host + compiler extraction with heuristic fallback.
 */
export function createTsJsCodeGraphService(workspaceRoot: string): TsJsCodeGraphService {
  const host = new TsProgramHost(workspaceRoot);

  return {
    host,

    bootstrap(seedFiles?: ReadonlyMap<string, string>): void {
      host.bootstrap(seedFiles);
    },

    updateFile(relPath: string, content: string): void {
      if (!isTsJsPath(relPath)) {
        return;
      }
      host.updateFile(normaliseRel(relPath), content);
    },

    removeFile(relPath: string): void {
      host.removeFile(normaliseRel(relPath));
    },

    extractFile(relPath: string, content: string): FileGraphExtract {
      const rel = normaliseRel(relPath);
      if (!isTsJsPath(rel)) {
        return { symbols: [], edges: [], usedCompiler: false };
      }
      host.updateFile(rel, content);
      try {
        const result = extractFileWithCompiler(host, rel);
        if (result) {
          return result;
        }
      } catch {
        // fall through to heuristic
      }
      const language = languageForTsJs(rel);
      const symbols = extractJsTsSymbols(rel, content, language);
      const edges = extractJsTsDependencies(rel, content);
      return { symbols, edges, usedCompiler: false };
    },

    getSymbolAtPosition(
      file: string,
      position: { line: number; column: number }
    ): string | undefined {
      return symbolAtPosition(host, normaliseRel(file), position);
    },

    dispose(): void {
      host.dispose();
    },
  };
}
