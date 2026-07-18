/**
 * Debounced deep reconciliation scheduler for graph dependents.
 */
export class GraphReconcileScheduler {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private pending = new Set<string>();
  private disposed = false;

  constructor(
    private readonly delayMs: number,
    private readonly onFlush: (paths: readonly string[]) => void | Promise<void>
  ) {}

  schedule(paths: readonly string[]): void {
    if (this.disposed) {
      return;
    }
    for (const p of paths) {
      this.pending.add(p);
    }
    if (this.timer) {
      clearTimeout(this.timer);
    }
    this.timer = setTimeout(() => {
      void this.flush();
    }, this.delayMs);
  }

  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    const paths = [...this.pending];
    this.pending.clear();
    if (paths.length === 0) {
      return;
    }
    await this.onFlush(paths);
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    this.pending.clear();
  }
}
