import { sha256, type RagHit } from '@mergecore/intelligence';
import * as path from 'path';
import * as vscode from 'vscode';
import {
  getExplanationMode,
  type ExplanationMode,
  type IntelligenceProfile,
} from '../../domain/explanation-modes';
import { ExplanationCache } from '../../infrastructure/explain/explanation-cache';
import type { Explainer } from '../../infrastructure/explain/explainer';
import type { IndexerService } from '../../infrastructure/index/indexer.service';
import { workspaceRootForDocument } from '../../infrastructure/index/indexer.service';
import { resolvePhpSymbolAt } from './php-symbol';

export interface HoverProviderDeps {
  readonly indexer: IndexerService;
  readonly explainer: Explainer;
  readonly embedQuery: (
    text: string,
    signal?: AbortSignal
  ) => Promise<readonly number[] | undefined>;
  readonly getMode: () => ExplanationMode;
  readonly getProfile: () => IntelligenceProfile;
  /** Lazily ensure the workspace has been indexed at least once. */
  readonly ensureIndexed?: (workspaceRoot: string) => Promise<void>;
}

/**
 * PHP / Blade hover provider — six-section engineering explanations.
 */
export class MergeCoreHoverProvider implements vscode.HoverProvider {
  private readonly inFlight = new Map<string, Promise<vscode.Hover | null>>();

  constructor(private readonly deps: HoverProviderDeps) {}

  async provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken
  ): Promise<vscode.Hover | null> {
    if (document.uri.scheme !== 'file') {
      return null;
    }
    if (document.languageId !== 'php' && document.languageId !== 'blade') {
      return null;
    }

    const workspaceRoot = workspaceRootForDocument(document);
    if (!workspaceRoot) {
      return null;
    }

    const symbol = resolvePhpSymbolAt(document.getText(), position.line);
    if (!symbol) {
      return null;
    }

    const mode = this.deps.getMode();
    // Prefer VS Code's document version over hashing the full buffer on every miss.
    const fileHash = `${document.version}:${sha256(symbol.code)}`;
    const cacheKey = `${fileHash}|${symbol.symbol}|${mode}`;
    const flightKey = `${document.uri.fsPath}|${cacheKey}`;

    const existing = this.inFlight.get(flightKey);
    if (existing) {
      return existing;
    }

    const work = this.buildHover(document, workspaceRoot, symbol, mode, fileHash, token);
    this.inFlight.set(flightKey, work);
    try {
      return await work;
    } finally {
      this.inFlight.delete(flightKey);
    }
  }

  private async buildHover(
    document: vscode.TextDocument,
    workspaceRoot: string,
    symbol: NonNullable<ReturnType<typeof resolvePhpSymbolAt>>,
    mode: ExplanationMode,
    fileHash: string,
    token: vscode.CancellationToken
  ): Promise<vscode.Hover | null> {
    const abort = new AbortController();
    const cancelSub = token.onCancellationRequested(() => abort.abort());

    try {
      const store = await this.deps.indexer.getStore(workspaceRoot);
      const cache = new ExplanationCache(store);
      const cached = cache.get(fileHash, symbol.symbol, mode);
      if (cached) {
        const md = new vscode.MarkdownString(cached.markdown, true);
        md.isTrusted = false;
        return new vscode.Hover(md);
      }

      if (token.isCancellationRequested) {
        return null;
      }

      if (this.deps.ensureIndexed) {
        void this.deps.ensureIndexed(workspaceRoot);
      }

      const relPath = path.relative(workspaceRoot, document.uri.fsPath).replace(/\\/g, '/');
      const profile = this.deps.getProfile();

      // Hover relies on RAG retrieve rather than a full related-context pack,
      // which keeps the hot path off dozens of findFiles + disk reads.
      const queryEmbedding = await this.deps.embedQuery(
        `${symbol.symbol}\n${symbol.code.slice(0, 1500)}`,
        abort.signal
      );

      if (token.isCancellationRequested) {
        return null;
      }

      const hits = await this.deps.indexer.retrieve(
        workspaceRoot,
        `${symbol.symbol} ${relPath} ${symbol.code.slice(0, 400)}`,
        { k: 6, mode, profile, pathHint: relPath, preferMemory: true },
        queryEmbedding
      );

      if (token.isCancellationRequested) {
        return null;
      }

      const ragContext = formatHits(hits);
      const architecturalHints = buildArchitecturalHints(relPath, hits);
      const relatedSummary = hits
        .slice(0, 8)
        .map((h) => `- \`${h.chunk.path}\`${h.chunk.symbol ? ` · ${h.chunk.symbol}` : ''}`)
        .join('\n');

      const explanation = await this.deps.explainer.explain({
        symbol: symbol.symbol,
        filePath: relPath,
        code: symbol.code,
        mode,
        profile,
        relatedSummary,
        ragContext,
        architecturalHints,
        signal: abort.signal,
      });

      if (token.isCancellationRequested) {
        return null;
      }

      const modeInfo = getExplanationMode(mode);
      const footer = `\n\n---\n_MergeCore · ${modeInfo.badge} mode · ${explanation.source === 'ollama' ? 'local model' : 'offline template'}_`;
      const markdown = `${explanation.markdown}${footer}`;

      cache.set({
        key: cache.key(fileHash, symbol.symbol, mode),
        markdown,
        mode,
        createdAt: Date.now(),
      });
      void cache.persist();

      const md = new vscode.MarkdownString(markdown, true);
      md.isTrusted = false;
      return new vscode.Hover(md);
    } finally {
      cancelSub.dispose();
    }
  }
}

function formatHits(hits: readonly RagHit[]): string {
  if (hits.length === 0) {
    return '';
  }
  return hits
    .map((h) => {
      const label = h.chunk.symbol ? `${h.chunk.path} · ${h.chunk.symbol}` : h.chunk.path;
      const excerpt = h.chunk.text.replace(/\s+/g, ' ').trim().slice(0, 280);
      return `[${h.chunk.kind}] ${label}: ${excerpt}`;
    })
    .join('\n');
}

function buildArchitecturalHints(relPath: string, hits: readonly RagHit[]): string {
  const parts: string[] = [];
  const lower = relPath.toLowerCase();
  if (lower.includes('/http/controllers/') || /controller\.php$/i.test(relPath)) {
    parts.push(
      'This looks like an HTTP controller. Prefer thin actions that delegate to services/actions and validate via FormRequests.'
    );
  } else if (lower.includes('/jobs/') || /job\.php$/i.test(relPath)) {
    parts.push(
      'This looks like a queued job. Consider idempotency, retries, and failure visibility.'
    );
  } else if (lower.includes('/models/') || lower.startsWith('app/models/')) {
    parts.push(
      'Eloquent models concentrate persistence. Watch for fat models and hidden query side effects.'
    );
  }

  const memory = hits.filter((h) => h.chunk.kind === 'memory').slice(0, 2);
  for (const m of memory) {
    const bit = m.chunk.text.replace(/\s+/g, ' ').trim().slice(0, 180);
    if (bit) {
      parts.push(`From project memory (${m.chunk.path}): ${bit}`);
    }
  }
  return parts.join(' ');
}

export function registerMergeCoreHoverProvider(
  context: vscode.ExtensionContext,
  deps: HoverProviderDeps
): void {
  const provider = new MergeCoreHoverProvider(deps);
  context.subscriptions.push(
    vscode.languages.registerHoverProvider([{ language: 'php' }, { language: 'blade' }], provider)
  );
}
