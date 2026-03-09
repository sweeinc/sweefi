/**
 * Gas Sponsor Rate Tracker
 *
 * Limits gas-sponsored transactions per API key per hour.
 * Token bucket algorithm (same as RateLimiter) prevents burst-at-boundary
 * attacks that fixed-window counters are vulnerable to.
 *
 * Phase 1: In-memory (lost on restart — acceptable for gas sponsorship).
 * Phase 2: Swap to Redis via IGasSponsorTracker interface.
 */

/**
 * Interface for gas sponsorship rate tracking.
 * All methods are async to support Redis/persistent backends in Phase 2.
 */
export interface IGasSponsorTracker {
  /** Check if this API key can sponsor another transaction right now. */
  canSponsor(apiKey: string): Promise<boolean>;
  /** Record that a sponsored transaction was settled for this API key. */
  recordSponsored(apiKey: string): Promise<void>;
  /**
   * Atomically check and consume a sponsorship token.
   * Returns true if a token was consumed, false if rate limit exceeded.
   * Prevents TOCTOU race between canSponsor() and recordSponsored()
   * (concurrent requests during async work can both pass canSponsor).
   */
  tryConsume(apiKey: string): Promise<boolean>;
}

/**
 * In-memory gas sponsor tracker using a token bucket per API key.
 *
 * @param maxPerHour - Maximum sponsored transactions per key per hour (bucket capacity).
 *                     0 = gas sponsorship disabled entirely.
 */
export class InMemoryGasSponsorTracker implements IGasSponsorTracker {
  private buckets = new Map<string, GasBucket>();

  constructor(private readonly maxPerHour: number) {}

  async canSponsor(apiKey: string): Promise<boolean> {
    if (this.maxPerHour <= 0) return false;
    const bucket = this.getOrCreate(apiKey);
    return bucket.tokens() >= 1;
  }

  async recordSponsored(apiKey: string): Promise<void> {
    if (this.maxPerHour <= 0) return;
    const bucket = this.getOrCreate(apiKey);
    bucket.consume();
  }

  async tryConsume(apiKey: string): Promise<boolean> {
    if (this.maxPerHour <= 0) return false;
    const bucket = this.getOrCreate(apiKey);
    return bucket.consume();
  }

  private getOrCreate(apiKey: string): GasBucket {
    let bucket = this.buckets.get(apiKey);
    if (!bucket) {
      this.evictStaleIfNeeded();
      bucket = new GasBucket(this.maxPerHour);
      this.buckets.set(apiKey, bucket);
    }
    return bucket;
  }

  /** Evict buckets not accessed in the last 2 hours. */
  private evictStaleIfNeeded(): void {
    if (this.buckets.size < 10_000) return;
    const twoHoursAgo = Date.now() - 7_200_000;
    for (const [key, bucket] of this.buckets) {
      if (bucket.lastAccess < twoHoursAgo) {
        this.buckets.delete(key);
      }
    }
  }
}

/**
 * Token bucket that refills at maxPerHour/3600 tokens per second.
 * This gives smooth, continuous rate limiting (no burst-at-boundary).
 */
class GasBucket {
  private _tokens: number;
  private lastRefill: number;
  lastAccess: number;

  constructor(private readonly capacity: number) {
    this._tokens = capacity;
    this.lastRefill = Date.now();
    this.lastAccess = Date.now();
  }

  tokens(): number {
    this.refill();
    this.lastAccess = Date.now();
    return this._tokens;
  }

  consume(): boolean {
    this.refill();
    this.lastAccess = Date.now();
    if (this._tokens < 1) return false;
    this._tokens -= 1;
    return true;
  }

  private refill(): void {
    const now = Date.now();
    const elapsedSec = (now - this.lastRefill) / 1000;
    // Refill rate: capacity tokens per hour = capacity/3600 per second
    this._tokens = Math.min(this.capacity, this._tokens + elapsedSec * (this.capacity / 3600));
    this.lastRefill = now;
  }
}
