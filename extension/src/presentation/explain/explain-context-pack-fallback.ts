import {
  createRepositorySearchEngine,
  type RagStore,
} from '@mergecore/intelligence';
import type { ExplainScope } from './explain-scope';

/** Search-engine fallback when ContextPack API is unavailable. */
export async function assembleFallbackPack(
  scope: ExplainScope,
  query: string,
  store: RagStore
): Promise<string> {
  const engine = await createRepositorySearchEngine({
    store,
    useInstructions: false,
  });
  const ctx = scope.symbol
    ? await engine.getContextForSymbol(scope.symbol.id)
    : await engine.searchRepositoryContext(query, {
        pathHint: scope.relPath,
        k: 12,
        budgets: { maxFiles: 10, maxChunks: 10, maxSymbols: 12, maxChars: 12_000 },
      });
  return [
    `# Context pack · ${scope.symbol?.name ?? scope.relPath}`,
    '',
    `Query: ${query}`,
    '',
    '## Retrieved context',
    ...ctx.results.slice(0, 24).map(
      (r) =>
        `- **\`${r.path}\`** (${r.resultType}, score ${r.score.toFixed(1)}, ${r.analysis}): ${r.reason}`
    ),
  ].join('\n');
}
