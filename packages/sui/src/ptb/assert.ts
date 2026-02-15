/** Fail fast with a clear message instead of a confusing on-chain abort. */

export function assertFeeBps(feeBps: number, fn: string): void {
  if (!Number.isInteger(feeBps) || feeBps < 0 || feeBps > 10_000) {
    throw new Error(`${fn}: feeBps must be an integer 0–10000 (got ${feeBps})`);
  }
}

export function assertPositive(value: bigint, name: string, fn: string): void {
  if (value <= 0n) {
    throw new Error(`${fn}: ${name} must be > 0 (got ${value})`);
  }
}
