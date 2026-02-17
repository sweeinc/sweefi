import type { Context, Next } from "hono";

/**
 * Token-bucket rate limiter per API key.
 *
 * D-13/D-14 (IP spoofing): For unauthenticated requests, the rate limiter
 * falls back to x-forwarded-for / x-real-ip headers. These are trivially
 * spoofable if the facilitator is directly exposed to the internet (no reverse
 * proxy). When behind a trusted proxy (Cloudflare, nginx), these headers are
 * set by the proxy and are reliable. For direct exposure, consider:
 *   - Requiring API key authentication for all settlement endpoints
 *   - Using cf-connecting-ip or similar trusted proxy headers
 *   - Adding a middleware that strips client-provided forwarded headers
 * Authenticated requests use the API key for rate limiting, which is not
 * spoofable (the auth middleware validates the key before this point).
 */
export class RateLimiter {
  private buckets = new Map<string, TokenBucket>();
  private readonly maxTokens: number;
  private readonly refillRate: number;
  private readonly maxBuckets: number;

  /**
   * @param maxTokens - Maximum requests per window (default: 100)
   * @param refillRate - Tokens added per second (default: 10)
   * @param maxBuckets - Maximum tracked keys before eviction (default: 10000)
   */
  constructor(maxTokens = 100, refillRate = 10, maxBuckets = 10_000) {
    this.maxTokens = maxTokens;
    this.refillRate = refillRate;
    this.maxBuckets = maxBuckets;
  }

  middleware() {
    return async (c: Context, next: Next) => {
      const apiKey = c.get("apiKey") as string | undefined;
      // Use API key for authenticated routes, IP for unauthenticated
      const key = apiKey ?? c.req.header("x-forwarded-for")?.split(",")[0]?.trim()
        ?? c.req.header("x-real-ip")
        ?? "unknown-ip";

      const bucket = this.getBucket(key);
      if (!bucket.consume()) {
        return c.json({ error: "Rate limit exceeded" }, 429);
      }

      await next();
    };
  }

  private getBucket(key: string): TokenBucket {
    let bucket = this.buckets.get(key);
    if (!bucket) {
      this.evictStaleIfNeeded();
      bucket = new TokenBucket(this.maxTokens, this.refillRate);
      this.buckets.set(key, bucket);
    }
    return bucket;
  }

  /**
   * Evict stale buckets when approaching capacity.
   * Removes buckets not accessed in the last hour. If still over limit,
   * removes oldest entries (FIFO via Map insertion order).
   */
  private evictStaleIfNeeded(): void {
    if (this.buckets.size < this.maxBuckets) return;

    const oneHourAgo = Date.now() - 3_600_000;
    for (const [key, bucket] of this.buckets) {
      if (bucket.lastAccess < oneHourAgo) {
        this.buckets.delete(key);
      }
    }

    // If still over limit, drop oldest entries (FIFO)
    if (this.buckets.size >= this.maxBuckets) {
      const toRemove = this.buckets.size - Math.floor(this.maxBuckets * 0.8);
      let removed = 0;
      for (const key of this.buckets.keys()) {
        if (removed >= toRemove) break;
        this.buckets.delete(key);
        removed++;
      }
    }
  }
}

class TokenBucket {
  private tokens: number;
  private lastRefill: number;
  lastAccess: number;

  constructor(
    private readonly maxTokens: number,
    private readonly refillRate: number,
  ) {
    this.tokens = maxTokens;
    this.lastRefill = Date.now();
    this.lastAccess = Date.now();
  }

  consume(): boolean {
    this.refill();
    this.lastAccess = Date.now();
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    this.tokens = Math.min(this.maxTokens, this.tokens + elapsed * this.refillRate);
    this.lastRefill = now;
  }
}
