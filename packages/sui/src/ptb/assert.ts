/** Fail fast with a clear message instead of a confusing on-chain abort. */

/**
 * Validate fee in micro-percent units (0–1,000,000 where 1,000,000 = 100%).
 *
 * Common values:
 *   1_000_000 = 100%     (max)
 *     500_000 = 50%
 *      10_000 = 1%       (= 100 traditional basis points)
 *       5_000 = 0.5%     (= 50 bps)
 *       1_000 = 0.1%     (= 10 bps)
 *         100 = 0.01%    (= 1 bps — traditional minimum)
 *          10 = 0.001%   (sub-bps — enabled by this precision)
 *           1 = 0.0001%  (finest granularity)
 */
export function assertFeeMicroPercent(feeMicroPercent: number, fn: string): void {
  if (!Number.isInteger(feeMicroPercent) || feeMicroPercent < 0 || feeMicroPercent > 1_000_000) {
    throw new Error(`${fn}: feeMicroPercent must be an integer 0–1000000 (got ${feeMicroPercent})`);
  }
}

/**
 * Convert traditional basis points (10,000 = 100%) to micro-percent
 * units used by SweeFi Move contracts (1,000,000 = 100%).
 *
 * Public convenience for callers who think in basis points.
 * Internally, the SDK uses micro-percent throughout — this is only
 * for external callers who prefer the BPS convention.
 *
 * Examples:
 *   50 bps (0.5%)     → 5_000 micro-percent
 *   100 bps (1%)      → 10_000 micro-percent
 *   10_000 bps (100%) → 1_000_000 micro-percent
 */
export function bpsToMicroPercent(feeBps: number): number {
  return feeBps * 100;
}

export function assertPositive(value: bigint, name: string, fn: string): void {
  if (value <= 0n) {
    throw new Error(`${fn}: ${name} must be > 0 (got ${value})`);
  }
}
