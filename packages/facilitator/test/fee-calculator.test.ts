import { describe, it, expect } from "vitest";
import { calculateFee } from "../src/metering/fee-calculator";

describe("calculateFee", () => {
  it("calculates 50 bps (0.5%) fee", () => {
    // 1,000,000 micro-USDC = $1.00
    // 0.5% = 5,000 micro-USDC
    expect(calculateFee("1000000", 50)).toBe(5000n);
  });

  it("calculates 100 bps (1%) fee", () => {
    expect(calculateFee("1000000", 100)).toBe(10000n);
  });

  it("returns 0 for 0 bps", () => {
    expect(calculateFee("1000000", 0)).toBe(0n);
  });

  it("returns 0 for 0 amount", () => {
    expect(calculateFee("0", 50)).toBe(0n);
  });

  it("handles large amounts", () => {
    // $1,000,000 in USDC micro-units = 1_000_000_000_000
    expect(calculateFee("1000000000000", 50)).toBe(5_000_000_000n);
  });

  it("handles sub-penny amounts correctly", () => {
    // $0.001 = 1000 micro-USDC, 50 bps = 5 micro-USDC
    expect(calculateFee("1000", 50)).toBe(5n);
  });

  it("truncates fractional fees (no rounding up)", () => {
    // 1 micro-USDC * 50 bps / 10000 = 0.005 → truncates to 0
    expect(calculateFee("1", 50)).toBe(0n);
  });
});
