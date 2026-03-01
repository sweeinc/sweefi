import { describe, it, expect } from "vitest";
import { calculateFee } from "../src/metering/fee-calculator";

describe("calculateFee", () => {
  it("calculates 5_000 micro-percent (0.5%) fee", () => {
    // 1,000,000 micro-USDC = $1.00
    // 0.5% = 5_000 micro-percent → 5,000 micro-USDC
    expect(calculateFee("1000000", 5_000)).toBe(5000n);
  });

  it("calculates 10_000 micro-percent (1%) fee", () => {
    expect(calculateFee("1000000", 10_000)).toBe(10000n);
  });

  it("returns 0 for 0 micro-percent", () => {
    expect(calculateFee("1000000", 0)).toBe(0n);
  });

  it("returns 0 for 0 amount", () => {
    expect(calculateFee("0", 5_000)).toBe(0n);
  });

  it("handles large amounts", () => {
    // $1,000,000 in USDC micro-units = 1_000_000_000_000
    expect(calculateFee("1000000000000", 5_000)).toBe(5_000_000_000n);
  });

  it("handles sub-penny amounts correctly", () => {
    // $0.001 = 1000 micro-USDC, 5_000 micro-percent (0.5%) = 5 micro-USDC
    expect(calculateFee("1000", 5_000)).toBe(5n);
  });

  it("truncates fractional fees (no rounding up)", () => {
    // 1 micro-USDC * 5_000 / 1_000_000 = 0.005 → truncates to 0
    expect(calculateFee("1", 5_000)).toBe(0n);
  });
});
