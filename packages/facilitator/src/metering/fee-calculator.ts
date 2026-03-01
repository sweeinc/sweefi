/**
 * Calculate facilitator fee from a settled payment amount.
 *
 * @param amount - Settlement amount in smallest token units
 * @param feeMicroPercent - Fee in micro-percent (e.g., 5000 = 0.5%, 1000000 = 100%)
 * @returns Fee amount in smallest token units
 */
export function calculateFee(amount: string, feeMicroPercent: number): bigint {
  const amountBig = BigInt(amount);
  return (amountBig * BigInt(feeMicroPercent)) / 1_000_000n;
}
