/**
 * Calculate facilitator fee from a settled payment amount.
 *
 * @param amount - Settlement amount in smallest token units
 * @param feeBps - Fee in basis points (e.g., 50 = 0.5%)
 * @returns Fee amount in smallest token units
 */
export function calculateFee(amount: string, feeBps: number): bigint {
  const amountBig = BigInt(amount);
  return (amountBig * BigInt(feeBps)) / 10_000n;
}
