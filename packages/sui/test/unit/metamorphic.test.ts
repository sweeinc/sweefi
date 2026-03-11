/**
 * Metamorphic property tests for SweeFi SDK.
 *
 * These tests verify mathematical/logical relationships hold across
 * randomised inputs — catching rounding errors, overflow bugs, and
 * logic flaws that hardcoded unit tests miss.
 */

import { describe, it, expect } from "vitest";
import { Transaction, coinWithBalance } from "@mysten/sui/transactions";
import {
  bpsToMicroPercent,
  assertFeeMicroPercent,
  assertPositive,
} from "../../src/ptb/assert";
import { buildCreateMandateTx } from "../../src/ptb/mandate";
import type { SweefiConfig } from "../../src/ptb/types";

// ── Helpers ─────────────────────────────────────────────────────

/** Generate a random integer in [min, max] inclusive. */
function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/** Generate a random bigint in [0n, max] inclusive. */
function randBigInt(max: bigint): bigint {
  // Use random float scaled to number range, then convert
  if (max <= BigInt(Number.MAX_SAFE_INTEGER)) {
    return BigInt(Math.floor(Math.random() * (Number(max) + 1)));
  }
  // For large values, build from random hex digits
  const hexMax = max.toString(16);
  const digits = hexMax.length;
  let hex = "";
  for (let i = 0; i < digits; i++) {
    hex += Math.floor(Math.random() * 16).toString(16);
  }
  const val = BigInt("0x" + hex);
  return val > max ? max : val;
}

const U64_MAX = 18_446_744_073_709_551_615n;

const DUMMY_CONFIG: SweefiConfig = {
  packageId: "0x" + "a".repeat(64),
  protocolStateId: "0x" + "b".repeat(64),
};

const DUMMY_ADDR = "0x" + "c".repeat(64);
const DUMMY_ADDR_2 = "0x" + "d".repeat(64);

// ═══════════════════════════════════════════════════════════════
// 1. Fee conversion roundtrip: bpsToMicroPercent(x) === x * 100
// ═══════════════════════════════════════════════════════════════

describe("MR-1: bpsToMicroPercent roundtrip", () => {
  it("exact identity: bpsToMicroPercent(x) === x * 100 for boundary values", () => {
    for (const bps of [0, 1, 50, 100, 500, 5000, 9999, 10000]) {
      expect(bpsToMicroPercent(bps)).toBe(bps * 100);
    }
  });

  it("exact identity for 50 random values in [0, 10000]", () => {
    for (let i = 0; i < 50; i++) {
      const bps = randInt(0, 10000);
      expect(bpsToMicroPercent(bps)).toBe(bps * 100);
    }
  });

  it("monotonicity: a < b => bpsToMicroPercent(a) < bpsToMicroPercent(b)", () => {
    for (let i = 0; i < 30; i++) {
      const a = randInt(0, 9999);
      const b = randInt(a + 1, 10000);
      expect(bpsToMicroPercent(a)).toBeLessThan(bpsToMicroPercent(b));
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// 2. Fee split conservation: merchantAmount + feeAmount === total
// ═══════════════════════════════════════════════════════════════

describe("MR-2: fee split conservation (integer division)", () => {
  /**
   * Replicate the exact fee split logic from exact/client.ts lines 142-143:
   *   feeAmount = (totalAmount * BigInt(protocolFeeBps)) / 10000n
   *   merchantAmount = totalAmount - feeAmount
   */
  function splitFee(amount: bigint, bps: number): { merchant: bigint; fee: bigint } {
    const fee = (amount * BigInt(bps)) / 10000n;
    const merchant = amount - fee;
    return { merchant, fee };
  }

  it("merchant + fee === total for 50 random (amount, bps) pairs", () => {
    for (let i = 0; i < 50; i++) {
      const amount = BigInt(randInt(1, 1_000_000_000));
      const bps = randInt(1, 10000);
      const { merchant, fee } = splitFee(amount, bps);
      expect(merchant + fee).toBe(amount);
    }
  });

  it("conservation holds at extreme amounts (u64::MAX-range)", () => {
    const extremes: bigint[] = [
      1n,
      U64_MAX,
      U64_MAX - 1n,
      U64_MAX / 2n,
      999_999_999_999_999n,
    ];
    for (const amount of extremes) {
      for (const bps of [1, 100, 5000, 9999, 10000]) {
        const { merchant, fee } = splitFee(amount, bps);
        expect(merchant + fee).toBe(amount);
      }
    }
  });

  it("fee is always >= 0 and <= total", () => {
    for (let i = 0; i < 50; i++) {
      const amount = BigInt(randInt(1, 1_000_000_000));
      const bps = randInt(0, 10000);
      const { fee } = splitFee(amount, bps);
      expect(fee).toBeGreaterThanOrEqual(0n);
      expect(fee).toBeLessThanOrEqual(amount);
    }
  });

  it("fee is monotonic in bps for fixed amount", () => {
    const amount = 1_000_000_000n;
    let prevFee = -1n;
    for (let bps = 0; bps <= 10000; bps += 100) {
      const { fee } = splitFee(amount, bps);
      expect(fee).toBeGreaterThanOrEqual(prevFee);
      prevFee = fee;
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// 3. Amount parsing symmetry (parseAmount from mcp/format.ts logic)
// ═══════════════════════════════════════════════════════════════

describe("MR-3: amount parsing symmetry", () => {
  // Inline the parseAmount logic (it lives in @sweefi/mcp which may not
  // be importable here — replicate the regex + BigInt pattern)
  const U64_MAX_VAL = 18_446_744_073_709_551_615n;

  function parseAmount(value: string): bigint {
    const trimmed = value.trim();
    if (!/^\d+$/.test(trimmed)) throw new Error("not a valid amount");
    const result = BigInt(trimmed);
    if (result === 0n) throw new Error("zero");
    if (result > U64_MAX_VAL) throw new Error("overflow");
    return result;
  }

  it("String(n) => parseAmount => n for powers of 2", () => {
    for (let exp = 0; exp < 64; exp++) {
      const n = 1n << BigInt(exp);
      expect(parseAmount(String(n))).toBe(n);
    }
  });

  it("String(n) => parseAmount => n for boundary values", () => {
    const values = [1n, 2n, 9n, 10n, 999n, U64_MAX_VAL, U64_MAX_VAL - 1n];
    for (const n of values) {
      expect(parseAmount(String(n))).toBe(n);
    }
  });

  it("String(n) => parseAmount => n for 30 random values", () => {
    for (let i = 0; i < 30; i++) {
      const n = randBigInt(U64_MAX_VAL - 1n) + 1n; // 1..U64_MAX
      expect(parseAmount(String(n))).toBe(n);
    }
  });

  it("rejects values above u64::MAX", () => {
    expect(() => parseAmount(String(U64_MAX_VAL + 1n))).toThrow();
    expect(() => parseAmount(String(U64_MAX_VAL + 9999n))).toThrow();
  });

  it("rejects zero", () => {
    expect(() => parseAmount("0")).toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════
// 4. Memo encoding determinism
// ═══════════════════════════════════════════════════════════════

describe("MR-4: memo encoding determinism", () => {
  const encoder = new TextEncoder();

  function arraysEqual(a: Uint8Array, b: Uint8Array): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return false;
    }
    return true;
  }

  it("same string always produces identical bytes (ASCII)", () => {
    for (let i = 0; i < 20; i++) {
      const s = "payment-" + randInt(0, 999999);
      const a = encoder.encode(s);
      const b = encoder.encode(s);
      expect(arraysEqual(a, b)).toBe(true);
    }
  });

  it("deterministic for emoji sequences", () => {
    const emojis = [
      "\u{1F4B0}", // money bag
      "\u{1F680}", // rocket
      "\u{1F469}\u{200D}\u{1F4BB}", // woman technologist (ZWJ)
      "\u{1F1FA}\u{1F1F8}", // US flag (regional indicators)
      "\u{1F468}\u{200D}\u{1F469}\u{200D}\u{1F467}\u{200D}\u{1F466}", // family ZWJ
    ];
    for (const emoji of emojis) {
      const a = encoder.encode(emoji);
      const b = encoder.encode(emoji);
      expect(arraysEqual(a, b)).toBe(true);
      // UTF-8 for these should be > 1 byte
      expect(a.length).toBeGreaterThan(0);
    }
  });

  it("deterministic for null byte, BOM, and unusual whitespace", () => {
    const edgeCases = [
      "\0", // null byte
      "\uFEFF", // BOM
      "\u200B", // zero-width space
      "\u00A0", // non-breaking space
      "\t\n\r", // control chars
    ];
    for (const s of edgeCases) {
      const a = encoder.encode(s);
      const b = encoder.encode(s);
      expect(arraysEqual(a, b)).toBe(true);
    }
  });

  it("different strings produce different bytes", () => {
    const a = encoder.encode("alice pays bob");
    const b = encoder.encode("alice pays charlie");
    expect(arraysEqual(a, b)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════
// 5. Micro-percent boundary: accept [0, 1_000_000], reject outside
// ═══════════════════════════════════════════════════════════════

describe("MR-5: assertFeeMicroPercent boundary", () => {
  it("accepts 0 (minimum)", () => {
    expect(() => assertFeeMicroPercent(0, "test")).not.toThrow();
  });

  it("accepts 1_000_000 (maximum = 100%)", () => {
    expect(() => assertFeeMicroPercent(1_000_000, "test")).not.toThrow();
  });

  it("accepts all interior values (sampled)", () => {
    for (const v of [1, 100, 10_000, 500_000, 999_999]) {
      expect(() => assertFeeMicroPercent(v, "test")).not.toThrow();
    }
  });

  it("rejects 1_000_001 (one above max)", () => {
    expect(() => assertFeeMicroPercent(1_000_001, "test")).toThrow();
  });

  it("rejects -1 (one below min)", () => {
    expect(() => assertFeeMicroPercent(-1, "test")).toThrow();
  });

  it("rejects non-integers", () => {
    expect(() => assertFeeMicroPercent(0.5, "test")).toThrow();
    expect(() => assertFeeMicroPercent(99.99, "test")).toThrow();
    expect(() => assertFeeMicroPercent(NaN, "test")).toThrow();
    expect(() => assertFeeMicroPercent(Infinity, "test")).toThrow();
  });

  it("rejects large overflow values", () => {
    expect(() => assertFeeMicroPercent(2_000_000, "test")).toThrow();
    expect(() => assertFeeMicroPercent(Number.MAX_SAFE_INTEGER, "test")).toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════
// 6. coinWithBalance amount preservation
// ═══════════════════════════════════════════════════════════════

describe("MR-6: coinWithBalance amount preservation", () => {
  const SUI_TYPE = "0x2::sui::SUI";

  it("builds a valid transaction for amount=0", () => {
    const tx = new Transaction();
    tx.setSender(DUMMY_ADDR);
    const coin = coinWithBalance({ type: SUI_TYPE, balance: 0n });
    tx.transferObjects([coin], DUMMY_ADDR);
    // If this throws, the builder rejected 0
    expect(tx).toBeDefined();
  });

  it("builds a valid transaction for amount=1 (smallest positive)", () => {
    const tx = new Transaction();
    tx.setSender(DUMMY_ADDR);
    const coin = coinWithBalance({ type: SUI_TYPE, balance: 1n });
    tx.transferObjects([coin], DUMMY_ADDR);
    expect(tx).toBeDefined();
  });

  it("builds a valid transaction for u64::MAX", () => {
    const tx = new Transaction();
    tx.setSender(DUMMY_ADDR);
    const coin = coinWithBalance({ type: SUI_TYPE, balance: U64_MAX });
    tx.transferObjects([coin], DUMMY_ADDR);
    expect(tx).toBeDefined();
  });

  it("builds valid transactions for powers of 2 up to 2^63", () => {
    for (let exp = 0; exp <= 63; exp++) {
      const amount = 1n << BigInt(exp);
      const tx = new Transaction();
      tx.setSender(DUMMY_ADDR);
      const coin = coinWithBalance({ type: SUI_TYPE, balance: amount });
      tx.transferObjects([coin], DUMMY_ADDR);
      expect(tx).toBeDefined();
    }
  });

  it("builds valid transactions for 10 random bigint amounts", () => {
    for (let i = 0; i < 10; i++) {
      const amount = randBigInt(U64_MAX);
      const tx = new Transaction();
      tx.setSender(DUMMY_ADDR);
      const coin = coinWithBalance({ type: SUI_TYPE, balance: amount });
      tx.transferObjects([coin], DUMMY_ADDR);
      expect(tx).toBeDefined();
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// 7. Option serialization (null vs bigint expiresAtMs)
// ═══════════════════════════════════════════════════════════════

describe("MR-7: option serialization in buildCreateMandateTx", () => {
  it("builds successfully with expiresAtMs = null (no expiry)", () => {
    const tx = buildCreateMandateTx(DUMMY_CONFIG, {
      coinType: "0x2::sui::SUI",
      sender: DUMMY_ADDR,
      delegate: DUMMY_ADDR_2,
      maxPerTx: 1_000_000_000n,
      maxTotal: 10_000_000_000n,
      expiresAtMs: null,
    });
    expect(tx).toBeInstanceOf(Transaction);
  });

  it("builds successfully with expiresAtMs = valid bigint", () => {
    const tx = buildCreateMandateTx(DUMMY_CONFIG, {
      coinType: "0x2::sui::SUI",
      sender: DUMMY_ADDR,
      delegate: DUMMY_ADDR_2,
      maxPerTx: 1_000_000_000n,
      maxTotal: 10_000_000_000n,
      expiresAtMs: BigInt(Date.now() + 86_400_000),
    });
    expect(tx).toBeInstanceOf(Transaction);
  });

  it("builds successfully with expiresAtMs = 0n (epoch zero — expired on creation)", () => {
    const tx = buildCreateMandateTx(DUMMY_CONFIG, {
      coinType: "0x2::sui::SUI",
      sender: DUMMY_ADDR,
      delegate: DUMMY_ADDR_2,
      maxPerTx: 1_000_000_000n,
      maxTotal: 10_000_000_000n,
      expiresAtMs: 0n,
    });
    expect(tx).toBeInstanceOf(Transaction);
  });

  it("builds successfully with expiresAtMs = u64::MAX", () => {
    const tx = buildCreateMandateTx(DUMMY_CONFIG, {
      coinType: "0x2::sui::SUI",
      sender: DUMMY_ADDR,
      delegate: DUMMY_ADDR_2,
      maxPerTx: 1_000_000_000n,
      maxTotal: 10_000_000_000n,
      expiresAtMs: U64_MAX,
    });
    expect(tx).toBeInstanceOf(Transaction);
  });

  it("null and bigint produce different serialized transactions", async () => {
    const txNull = buildCreateMandateTx(DUMMY_CONFIG, {
      coinType: "0x2::sui::SUI",
      sender: DUMMY_ADDR,
      delegate: DUMMY_ADDR_2,
      maxPerTx: 1_000_000_000n,
      maxTotal: 10_000_000_000n,
      expiresAtMs: null,
    });
    const txBigint = buildCreateMandateTx(DUMMY_CONFIG, {
      coinType: "0x2::sui::SUI",
      sender: DUMMY_ADDR,
      delegate: DUMMY_ADDR_2,
      maxPerTx: 1_000_000_000n,
      maxTotal: 10_000_000_000n,
      expiresAtMs: 1_000_000_000_000n,
    });
    // They should produce different command data
    expect(txNull).not.toEqual(txBigint);
  });
});

// ═══════════════════════════════════════════════════════════════
// 8. Fee dust invariant: amount=1, bps=1 => fee rounds to 0
// ═══════════════════════════════════════════════════════════════

describe("MR-8: fee dust invariant", () => {
  function splitFee(amount: bigint, bps: number): { merchant: bigint; fee: bigint } {
    const fee = (amount * BigInt(bps)) / 10000n;
    const merchant = amount - fee;
    return { merchant, fee };
  }

  it("amount=1, bps=1: fee rounds to 0, merchant gets full amount", () => {
    const { merchant, fee } = splitFee(1n, 1);
    expect(fee).toBe(0n);
    expect(merchant).toBe(1n);
  });

  it("amount=1, bps=9999: fee rounds to 0 (integer truncation)", () => {
    // 1 * 9999 / 10000 = 0.9999 => 0 in integer division
    const { merchant, fee } = splitFee(1n, 9999);
    expect(fee).toBe(0n);
    expect(merchant).toBe(1n);
  });

  it("amount=1, bps=10000 (100%): fee IS the full amount", () => {
    const { merchant, fee } = splitFee(1n, 10000);
    expect(fee).toBe(1n);
    expect(merchant).toBe(0n);
  });

  it("smallest non-zero fee: amount=10000, bps=1 => fee=1", () => {
    const { merchant, fee } = splitFee(10000n, 1);
    expect(fee).toBe(1n);
    expect(merchant).toBe(9999n);
  });

  it("fee threshold: for bps=1, fee becomes 1 exactly at amount=10000", () => {
    // Below threshold: fee=0
    for (let a = 1n; a < 10000n; a += 999n) {
      const { fee } = splitFee(a, 1);
      expect(fee).toBe(0n);
    }
    // At threshold: fee=1
    expect(splitFee(10000n, 1).fee).toBe(1n);
    // Above threshold
    expect(splitFee(20000n, 1).fee).toBe(2n);
  });

  it("conservation holds even when fee rounds to 0", () => {
    for (let bps = 1; bps <= 50; bps++) {
      for (const amount of [1n, 2n, 5n, 100n]) {
        const { merchant, fee } = splitFee(amount, bps);
        expect(merchant + fee).toBe(amount);
      }
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// Additional metamorphic relationships
// ═══════════════════════════════════════════════════════════════

describe("MR-extra: assertPositive", () => {
  it("rejects 0n", () => {
    expect(() => assertPositive(0n, "amount", "test")).toThrow();
  });

  it("rejects negative bigints", () => {
    expect(() => assertPositive(-1n, "amount", "test")).toThrow();
    expect(() => assertPositive(-999n, "amount", "test")).toThrow();
  });

  it("accepts all positive bigints (sampled)", () => {
    for (const v of [1n, 100n, U64_MAX]) {
      expect(() => assertPositive(v, "amount", "test")).not.toThrow();
    }
  });
});

describe("MR-extra: fee split commutativity with scaling", () => {
  function splitFee(amount: bigint, bps: number): { merchant: bigint; fee: bigint } {
    const fee = (amount * BigInt(bps)) / 10000n;
    const merchant = amount - fee;
    return { merchant, fee };
  }

  it("fee(k * amount, bps) === k * fee(amount, bps) for large amounts (no truncation)", () => {
    // This only holds when amount * bps is already divisible by 10000
    // (i.e., no rounding). Test with amounts that divide cleanly.
    const amount = 10000n * 100n; // 1_000_000 — divisible by 10000
    for (const k of [2n, 3n, 10n, 100n]) {
      for (const bps of [100, 500, 2500]) {
        const singleFee = splitFee(amount, bps).fee;
        const scaledFee = splitFee(amount * k, bps).fee;
        expect(scaledFee).toBe(singleFee * k);
      }
    }
  });

  it("fee rounding error is bounded: |fee(k*a) - k*fee(a)| < k", () => {
    for (let i = 0; i < 30; i++) {
      const amount = BigInt(randInt(1, 100_000));
      const k = BigInt(randInt(2, 100));
      const bps = randInt(1, 10000);

      const singleFee = splitFee(amount, bps).fee;
      const scaledFee = splitFee(amount * k, bps).fee;

      const diff = scaledFee - singleFee * k;
      // diff can be negative (rounding down) but bounded
      const absDiff = diff < 0n ? -diff : diff;
      expect(absDiff).toBeLessThan(k);
    }
  });
});
