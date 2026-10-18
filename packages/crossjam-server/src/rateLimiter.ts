export class TokenBucket {
  private tokens: number;
  private lastRefillAt: number;

  constructor(
    private readonly capacity: number,
    private readonly refillPerSecond: number,
    now: number,
  ) {
    this.tokens = capacity;
    this.lastRefillAt = now;
  }

  take(now: number): boolean {
    const elapsedSeconds = Math.max(0, now - this.lastRefillAt) / 1000;
    this.tokens = Math.min(
      this.capacity,
      this.tokens + elapsedSeconds * this.refillPerSecond,
    );
    this.lastRefillAt = now;
    if (this.tokens < 1) {
      return false;
    }
    this.tokens -= 1;
    return true;
  }
}

export class SlidingWindowLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly maxHits: number,
    private readonly windowMs: number,
  ) {}

  allow(key: string, now: number): boolean {
    const recent = (this.hits.get(key) ?? []).filter(
      (hitAt) => now - hitAt < this.windowMs,
    );
    if (recent.length >= this.maxHits) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(now);
    this.hits.set(key, recent);
    return true;
  }

  forget(key: string): void {
    this.hits.delete(key);
  }
}
