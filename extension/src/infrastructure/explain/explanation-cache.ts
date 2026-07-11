import type { ExplanationCacheEntry, ExplanationMode, RagStore } from '@mergecore/intelligence';

/**
 * Hover explanation cache keyed by (fileHash, symbol, mode).
 * Persists via the workspace RagStore under `.mergecore/rag/`.
 */
export class ExplanationCache {
  constructor(private readonly store: RagStore) {}

  key(fileHash: string, symbol: string, mode: ExplanationMode): string {
    return this.store.explanationKey(fileHash, symbol, mode);
  }

  get(fileHash: string, symbol: string, mode: ExplanationMode): ExplanationCacheEntry | undefined {
    return this.store.getExplanation(this.key(fileHash, symbol, mode));
  }

  set(entry: ExplanationCacheEntry): void {
    this.store.setExplanation(entry);
  }

  async persist(): Promise<void> {
    await this.store.persist();
  }
}
