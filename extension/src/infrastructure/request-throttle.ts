/**
 * Per-key debounce + global concurrency cap for review requests. Stops a
 * keybinding loop or a runaway auto-trigger from hammering the API (and
 * burning a user's quota).
 */
export class RequestThrottle {
  private readonly lastStartByKey = new Map<string, number>();
  private inFlight = 0;

  constructor(
    private readonly minIntervalMs: number = 1500,
    private readonly maxConcurrent: number = 2
  ) {}

  /** Returns a rejection reason, or undefined if the caller may proceed. */
  check(key: string, now: number = Date.now()): string | undefined {
    if (this.inFlight >= this.maxConcurrent) {
      return `Another MergeCore review is in progress (max ${this.maxConcurrent}). Try again when it finishes.`;
    }
    const last = this.lastStartByKey.get(key);
    if (last !== undefined && now - last < this.minIntervalMs) {
      const wait = Math.ceil((this.minIntervalMs - (now - last)) / 100) * 100;
      return `Please wait ${wait} ms before re-running the same review.`;
    }
    return undefined;
  }

  /** Mark a request as started; returns a disposer to be invoked on settle. */
  begin(key: string): () => void {
    this.lastStartByKey.set(key, Date.now());
    this.inFlight++;
    let settled = false;
    return () => {
      if (settled) {
        return;
      }
      settled = true;
      this.inFlight = Math.max(0, this.inFlight - 1);
    };
  }
}
