/**
 * In-memory hover summary cache with path-based invalidation.
 */

export class HoverSummaryCache<T> {
  private readonly byKey = new Map<string, { value: T; paths: Set<string>; at: number }>();
  private readonly maxEntries: number;

  constructor(maxEntries = 200) {
    this.maxEntries = maxEntries;
  }

  static key(parts: {
    workspaceRoot: string;
    symbolId: string;
    fileVersion: string | number;
  }): string {
    return `${parts.workspaceRoot}|${parts.symbolId}|${parts.fileVersion}`;
  }

  get(key: string): T | undefined {
    return this.byKey.get(key)?.value;
  }

  set(key: string, value: T, relatedPaths: readonly string[]): void {
    if (this.byKey.size >= this.maxEntries) {
      // Drop oldest
      let oldestKey: string | undefined;
      let oldestAt = Number.POSITIVE_INFINITY;
      for (const [k, v] of this.byKey) {
        if (v.at < oldestAt) {
          oldestAt = v.at;
          oldestKey = k;
        }
      }
      if (oldestKey) {
        this.byKey.delete(oldestKey);
      }
    }
    this.byKey.set(key, {
      value,
      paths: new Set(relatedPaths.map((p) => p.replace(/\\/g, '/'))),
      at: Date.now(),
    });
  }

  /** Invalidate entries that touch any of the given relative paths. */
  invalidatePaths(paths: readonly string[]): number {
    if (paths.length === 0) return 0;
    const set = new Set(paths.map((p) => p.replace(/\\/g, '/')));
    let n = 0;
    for (const [k, v] of this.byKey) {
      for (const p of v.paths) {
        if (set.has(p)) {
          this.byKey.delete(k);
          n++;
          break;
        }
      }
    }
    return n;
  }

  invalidateWorkspace(workspaceRoot: string): number {
    let n = 0;
    for (const k of [...this.byKey.keys()]) {
      if (k.startsWith(`${workspaceRoot}|`)) {
        this.byKey.delete(k);
        n++;
      }
    }
    return n;
  }

  clear(): void {
    this.byKey.clear();
  }

  get size(): number {
    return this.byKey.size;
  }
}
