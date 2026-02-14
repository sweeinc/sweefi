import type { Context, Next } from "hono";

/**
 * Token-bucket rate limiter per API key.
 */
export class RateLimiter {
  private buckets = new Map<string, TokenBucket>();
  private readonly maxTokens: number;
  private readonly refillRate: number;

  /**
   * @param maxTokens - Maximum requests per window (default: 100)
   * @param refillRate - Tokens added per second (default: 10)
   */
  constructor(maxTokens = 100, refillRate = 10) {
    this.maxTokens = maxTokens;
    this.refillRate = refillRate;
  }

  middleware() {
    return async (c: Context, next: Next) => {
      const apiKey = c.get("apiKey") as string | undefined;
      if (!apiKey) {
        await next();
        return;
      }

      const bucket = this.getBucket(apiKey);
      if (!bucket.consume()) {
        return c.json({ error: "Rate limit exceeded" }, 429);
      }

      await next();
    };
  }

  private getBucket(key: string): TokenBucket {
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = new TokenBucket(this.maxTokens, this.refillRate);
      this.buckets.set(key, bucket);
    }
    return bucket;
  }
}

class TokenBucket {
  private tokens: number;
  private lastRefill: number;

  constructor(
    private readonly maxTokens: number,
    private readonly refillRate: number,
  ) {
    this.tokens = maxTokens;
    this.lastRefill = Date.now();
  }

  consume(): boolean {
    this.refill();
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
