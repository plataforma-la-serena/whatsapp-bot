export class MessageDeduplicator {
  private readonly seen = new Map<string, number>();

  constructor(private readonly ttlMs = 10 * 60 * 1000) {}

  firstTime(id: string): boolean {
    const now = Date.now();
    this.cleanup(now);

    if (this.seen.has(id)) {
      return false;
    }

    this.seen.set(id, now);
    return true;
  }

  private cleanup(now: number): void {
    if (this.seen.size < 1000) {
      return;
    }

    for (const [id, timestamp] of this.seen) {
      if (now - timestamp >= this.ttlMs) {
        this.seen.delete(id);
      }
    }
  }
}
