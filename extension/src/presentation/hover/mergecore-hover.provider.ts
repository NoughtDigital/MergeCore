import * as vscode from 'vscode';
import type { IndexerService } from '../../infrastructure/index/indexer.service';
import { workspaceRootForDocument } from '../../infrastructure/index/indexer.service';
import type { Explainer } from '../../infrastructure/explain/explainer';
import {
  buildDeterministicHoverSummary,
  isTsJsLanguage,
  relativeWorkspacePath,
} from './hover-assemble';
import { HoverSummaryCache } from './hover-cache';
import {
  formatHoverMarkdown,
  HOVER_ENABLED_COMMANDS,
} from './hover-markdown';
import type { HoverSummary } from './hover-summary';
import { resolvePhpSymbolAt } from './php-symbol';

export interface HoverProviderDeps {
  readonly indexer: IndexerService;
  readonly explainer: Explainer;
  readonly ensureIndexed?: (workspaceRoot: string) => Promise<void>;
  /** When true, richer model explanation may be offered via command only. */
  readonly isModelExplanationEnabled?: () => boolean;
}

const HOVER_LANGUAGES: vscode.DocumentSelector = [
  { language: 'typescript' },
  { language: 'typescriptreact' },
  { language: 'javascript' },
  { language: 'javascriptreact' },
  { language: 'php' },
  { language: 'blade' },
];

/**
 * Progressive repository-aware hover: deterministic first, model never on mere hover.
 */
export class MergeCoreHoverProvider implements vscode.HoverProvider {
  private readonly inFlight = new Map<string, Promise<vscode.Hover | null>>();
  private readonly cache = new HoverSummaryCache<HoverSummary>();

  constructor(private readonly deps: HoverProviderDeps) {
    // Invalidate when index status updates after file changes
    this.deps.indexer.onStatusDetail((status) => {
      if (status.phase === 'done' || status.phase === 'persisting') {
        this.cache.invalidateWorkspace(status.workspaceRoot);
      }
    });
  }

  /** Test / command access to clear cache. */
  invalidatePaths(workspaceRoot: string, paths: readonly string[]): void {
    void workspaceRoot;
    this.cache.invalidatePaths(paths);
  }

  clearCache(): void {
    this.cache.clear();
  }

  async provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken
  ): Promise<vscode.Hover | null> {
    if (document.uri.scheme !== 'file') {
      return null;
    }

    // Workspace trust: package disables Restricted Mode; also gate at runtime.
    if (!vscode.workspace.isTrusted) {
      return null;
    }

    const lang = document.languageId;
    const isPhp = lang === 'php' || lang === 'blade';
    const isTsJs = isTsJsLanguage(lang);
    if (!isPhp && !isTsJs) {
      return null;
    }

    const workspaceRoot = workspaceRootForDocument(document);
    if (!workspaceRoot) {
      return null;
    }

    const flightKey = `${document.uri.fsPath}|${document.version}|${position.line}|${position.character}`;
    const existing = this.inFlight.get(flightKey);
    if (existing) {
      return existing;
    }

    const work = this.buildHover(document, position, workspaceRoot, isPhp, token);
    this.inFlight.set(flightKey, work);
    try {
      return await work;
    } finally {
      this.inFlight.delete(flightKey);
    }
  }

  private async buildHover(
    document: vscode.TextDocument,
    position: vscode.Position,
    workspaceRoot: string,
    isPhp: boolean,
    token: vscode.CancellationToken
  ): Promise<vscode.Hover | null> {
    const abort = new AbortController();
    const cancelSub = token.onCancellationRequested(() => abort.abort());

    try {
      if (this.deps.ensureIndexed) {
        // Never await a full index on the hover hot path
        void this.deps.ensureIndexed(workspaceRoot);
      }

      if (token.isCancellationRequested) {
        return null;
      }

      const store = await this.deps.indexer.getStore(workspaceRoot);
      if (token.isCancellationRequested) {
        return null;
      }

      const relPath = relativeWorkspacePath(workspaceRoot, document.uri.fsPath);
      const graphService = this.deps.indexer.getCodeGraphService(workspaceRoot);

      // Warm graph buffer for current file so position resolve works
      if (graphService && !isPhp) {
        try {
          graphService.updateFile(relPath, document.getText());
        } catch {
          // ignore
        }
      }

      let summary: HoverSummary | undefined;

      if (!isPhp) {
        const cacheKey = HoverSummaryCache.key({
          workspaceRoot,
          symbolId: `${relPath}:${position.line}:${position.character}`,
          fileVersion: document.version,
        });
        // Position-based provisional key; refine after resolve
        const line = document.lineAt(position.line).text;
        const codeSample = extractNearbyCode(document, position);

        summary = await buildDeterministicHoverSummary({
          workspaceRoot,
          store,
          graphService,
          relPath,
          position: { line: position.line + 1, column: position.character + 1 },
          codeSample,
          signal: abort.signal,
        });

        if (token.isCancellationRequested) {
          return null;
        }

        if (summary) {
          const stableKey = HoverSummaryCache.key({
            workspaceRoot,
            symbolId: summary.symbolId,
            fileVersion: document.version,
          });
          const cached = this.cache.get(stableKey);
          if (cached) {
            summary = cached;
          } else {
            this.cache.set(stableKey, summary, [
              summary.path,
              ...summary.callers.map((c) => c.path),
              ...summary.relatedTests.map((t) => t.path),
            ]);
          }
          void cacheKey;
          void line;
        }
      } else {
        // PHP: keep lightweight symbol resolve; still no model on hover
        const phpSym = resolvePhpSymbolAt(document.getText(), position.line);
        if (!phpSym) {
          return null;
        }
        summary = {
          symbolId: `php:${relPath}:${phpSym.symbol}`,
          name: phpSym.symbol,
          kind: phpSym.kind,
          language: 'php',
          path: relPath,
          startLine: position.line + 1,
          endLine: position.line + 1,
          purpose: {
            text: phpSym.kind === 'method' ? `PHP method \`${phpSym.symbol}\`` : `PHP ${phpSym.kind}`,
            kind: 'inference',
          },
          role: { text: `Defined in \`${relPath}\``, kind: 'evidence' },
          inputs: { text: 'see signature', kind: 'inference' },
          output: { text: 'unknown', kind: 'inference' },
          dependencies: [],
          callers: [],
          relatedTests: [],
          instructions: [],
          risks: [],
          confidence: 'medium',
          analysis: 'heuristic',
          callerCount: 0,
          dependencyCount: 0,
          relatedTestCount: 0,
        };
      }

      if (!summary) {
        return null;
      }

      const markdown = formatHoverMarkdown(summary, workspaceRoot);
      const md = new vscode.MarkdownString(markdown, true);
      md.isTrusted = { enabledCommands: [...HOVER_ENABLED_COMMANDS] };
      md.supportHtml = false;

      const range = new vscode.Range(
        Math.max(0, summary.startLine - 1),
        0,
        Math.max(0, summary.endLine - 1),
        999
      );
      return new vscode.Hover(md, range);
    } finally {
      cancelSub.dispose();
    }
  }
}

function extractNearbyCode(document: vscode.TextDocument, position: vscode.Position): string {
  const start = Math.max(0, position.line - 2);
  const end = Math.min(document.lineCount - 1, position.line + 12);
  const lines: string[] = [];
  for (let i = start; i <= end; i++) {
    lines.push(document.lineAt(i).text);
  }
  return lines.join('\n').slice(0, 2000);
}

export function registerMergeCoreHoverProvider(
  context: vscode.ExtensionContext,
  deps: HoverProviderDeps
): MergeCoreHoverProvider {
  const provider = new MergeCoreHoverProvider(deps);
  context.subscriptions.push(
    vscode.languages.registerHoverProvider(HOVER_LANGUAGES, provider)
  );
  return provider;
}
