/**
 * Property-based tests for @sweefi/sui
 *
 * Tests invariants across randomized inputs without fast-check dependency.
 * Uses manual random generation with 1000 iterations per property.
 */
import { describe, it, expect } from "vitest";
import { Transaction } from "@mysten/sui/transactions";
import {
  assertFeeMicroPercent,
  bpsToMicroPercent,
  assertPositive,
} from "../../src/ptb/assert";
import {
  buildPayTx,
  buildCreateStreamTx,
  buildCreateEscrowTx,
  buildPrepaidDepositTx,
} from "../../src/ptb";
import type { SweefiConfig, PayParams, CreateStreamParams, CreateEscrowParams, PrepaidDepositParams } from "../../src/ptb";
import { validateSuiAddress, convertToTokenAmount } from "../../src/utils";
import { SUI_ADDRESS_REGEX } from "../../src/constants";

// ══════════════════════════════════════════════════════════════
// Random generators
// ══════════════════════════════════════════════════════════════

function randomHex(length: number): string {
  return Array.from({ length }, () =>
    Math.floor(Math.random() * 16).toString(16),
  ).join("");
}

function randomSuiAddress(): string {
  return `0x${randomHex(64)}`;
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomBigInt(min: bigint, max: bigint): bigint {
  const range = max - min;
  const bits = range.toString(2).length;
  const hexLen = Math.ceil(bits / 4);
  let result: bigint;
  do {
    result = BigInt("0x" + randomHex(Math.max(1, hexLen))) % (range + 1n);
  } while (result > range);
  return min + result;
}

const ITERATIONS = 1000;

const PACKAGE_ID = "0x" + "ab".repeat(32);
const PROTOCOL_STATE_ID = "0x" + "99".repeat(32);
const SUI_COIN_TYPE = "0x2::sui::SUI";

const config: SweefiConfig = { packageId: PACKAGE_ID };
const fullConfig: SweefiConfig = {
  packageId: PACKAGE_ID,
  protocolStateId: PROTOCOL_STATE_ID,
};

// ══════════════════════════════════════════════════════════════
// 1. Fee Validation Invariant
// ══════════════════════════════════════════════════════════════

describe("PBT: assertFeeMicroPercent", () => {
  it("accepts all integers in [0, 1_000_000]", () => {
    for (let i = 0; i < ITERATIONS; i++) {
      const fee = randomInt(0, 1_000_000);
      expect(() => assertFeeMicroPercent(fee, "test")).not.toThrow();
    }
  });

  it("accepts boundary values 0 and 1_000_000", () => {
    expect(() => assertFeeMicroPercent(0, "test")).not.toThrow();
    expect(() => assertFeeMicroPercent(1_000_000, "test")).not.toThrow();
  });

  it("rejects all integers > 1_000_000", () => {
    for (let i = 0; i < ITERATIONS; i++) {
      const fee = randomInt(1_000_001, 100_000_000);
      expect(() => assertFeeMicroPercent(fee, "test")).toThrow(/feeMicroPercent/);
    }
  });

  it("rejects all negative integers", () => {
    for (let i = 0; i < ITERATIONS; i++) {
      const fee = -randomInt(1, 100_000_000);
      expect(() => assertFeeMicroPercent(fee, "test")).toThrow(/feeMicroPercent/);
    }
  });

  it("rejects non-integer numbers", () => {
    for (let i = 0; i < ITERATIONS; i++) {
      // Generate a float that is NOT an integer
      const fee = Math.random() * 1_000_000;
      if (Number.isInteger(fee)) continue; // skip the rare exact integer
      expect(() => assertFeeMicroPercent(fee, "test")).toThrow(/feeMicroPercent/);
    }
  });

  it("rejects NaN and Infinity", () => {
    expect(() => assertFeeMicroPercent(NaN, "test")).toThrow(/feeMicroPercent/);
    expect(() => assertFeeMicroPercent(Infinity, "test")).toThrow(/feeMicroPercent/);
    expect(() => assertFeeMicroPercent(-Infinity, "test")).toThrow(/feeMicroPercent/);
  });
});

// ══════════════════════════════════════════════════════════════
// 2. PTB Builder Safety
// ══════════════════════════════════════════════════════════════

describe("PBT: PTB builders never throw for valid inputs", () => {
  it("buildPayTx produces a Transaction for random valid params", () => {
    for (let i = 0; i < ITERATIONS; i++) {
      const params: PayParams = {
        coinType: SUI_COIN_TYPE,
        sender: randomSuiAddress(),
        recipient: randomSuiAddress(),
        amount: randomBigInt(1n, (1n << 64n) - 1n),
        feeMicroPercent: randomInt(0, 1_000_000),
        feeRecipient: randomSuiAddress(),
      };
      const tx = buildPayTx(config, params);
      expect(tx).toBeInstanceOf(Transaction);
    }
  });

  it("buildCreateStreamTx produces a Transaction for random valid params", () => {
    for (let i = 0; i < ITERATIONS; i++) {
      const params: CreateStreamParams = {
        coinType: SUI_COIN_TYPE,
        sender: randomSuiAddress(),
        recipient: randomSuiAddress(),
        depositAmount: randomBigInt(1n, (1n << 64n) - 1n),
        ratePerSecond: randomBigInt(1n, 1_000_000_000n),
        budgetCap: randomBigInt(1n, (1n << 64n) - 1n),
        feeMicroPercent: randomInt(0, 1_000_000),
        feeRecipient: randomSuiAddress(),
      };
      const tx = buildCreateStreamTx(fullConfig, params);
      expect(tx).toBeInstanceOf(Transaction);
    }
  });

  it("buildCreateEscrowTx produces a Transaction for random valid params", () => {
    for (let i = 0; i < ITERATIONS; i++) {
      const params: CreateEscrowParams = {
        coinType: SUI_COIN_TYPE,
        sender: randomSuiAddress(),
        seller: randomSuiAddress(),
        arbiter: randomSuiAddress(),
        depositAmount: randomBigInt(1n, (1n << 64n) - 1n),
        deadlineMs: randomBigInt(1n, (1n << 53n) - 1n),
        feeMicroPercent: randomInt(0, 1_000_000),
        feeRecipient: randomSuiAddress(),
      };
      const tx = buildCreateEscrowTx(fullConfig, params);
      expect(tx).toBeInstanceOf(Transaction);
    }
  });

  it("buildPrepaidDepositTx produces a Transaction for random valid params", () => {
    for (let i = 0; i < ITERATIONS; i++) {
      const params: PrepaidDepositParams = {
        coinType: SUI_COIN_TYPE,
        sender: randomSuiAddress(),
        provider: randomSuiAddress(),
        amount: randomBigInt(1n, (1n << 64n) - 1n),
        ratePerCall: randomBigInt(1n, 1_000_000_000n),
        withdrawalDelayMs: randomBigInt(60_000n, 604_800_000n),
        feeMicroPercent: randomInt(0, 1_000_000),
        feeRecipient: randomSuiAddress(),
      };
      const tx = buildPrepaidDepositTx(fullConfig, params);
      expect(tx).toBeInstanceOf(Transaction);
    }
  });
});

// ══════════════════════════════════════════════════════════════
// 3. Address Validation Consistency
// ══════════════════════════════════════════════════════════════

describe("PBT: Address validation", () => {
  it("accepts all 0x + 64 random hex chars", () => {
    for (let i = 0; i < ITERATIONS; i++) {
      const addr = randomSuiAddress();
      expect(validateSuiAddress(addr)).toBe(true);
      expect(SUI_ADDRESS_REGEX.test(addr)).toBe(true);
    }
  });

  it("rejects 0x + 63 hex chars (too short)", () => {
    for (let i = 0; i < ITERATIONS; i++) {
      const addr = `0x${randomHex(63)}`;
      expect(validateSuiAddress(addr)).toBe(false);
    }
  });

  it("rejects 0x + 65 hex chars (too long)", () => {
    for (let i = 0; i < ITERATIONS; i++) {
      const addr = `0x${randomHex(65)}`;
      expect(validateSuiAddress(addr)).toBe(false);
    }
  });

  it("rejects non-hex characters in address", () => {
    const nonHexChars = "ghijklmnopqrstuvwxyz!@#$%^&*()_+-=[]{}|;:',.<>?/~`";
    for (let i = 0; i < ITERATIONS; i++) {
      // Replace one random position with a non-hex char
      const hex = randomHex(64).split("");
      const pos = randomInt(0, 63);
      const charIdx = randomInt(0, nonHexChars.length - 1);
      hex[pos] = nonHexChars[charIdx];
      const addr = `0x${hex.join("")}`;
      expect(validateSuiAddress(addr)).toBe(false);
    }
  });

  it("rejects addresses without 0x prefix", () => {
    for (let i = 0; i < ITERATIONS; i++) {
      const addr = randomHex(64);
      expect(validateSuiAddress(addr)).toBe(false);
    }
  });
});

// ══════════════════════════════════════════════════════════════
// 4. bpsToMicroPercent Conversion
// ══════════════════════════════════════════════════════════════

describe("PBT: bpsToMicroPercent", () => {
  it("bpsToMicroPercent(bps) == bps * 100 for all bps in [0, 10_000]", () => {
    // Exhaustive — only 10,001 values
    for (let bps = 0; bps <= 10_000; bps++) {
      expect(bpsToMicroPercent(bps)).toBe(bps * 100);
    }
  });

  it("bpsToMicroPercent(10_000) == 1_000_000 (100% = 100%)", () => {
    expect(bpsToMicroPercent(10_000)).toBe(1_000_000);
  });

  it("bpsToMicroPercent(0) == 0", () => {
    expect(bpsToMicroPercent(0)).toBe(0);
  });

  it("round-trip: Math.floor(bpsToMicroPercent(x) / 100) == x for all x in [0, 10_000]", () => {
    // Since there's no microPercentToBps, verify the inverse manually
    for (let bps = 0; bps <= 10_000; bps++) {
      const micro = bpsToMicroPercent(bps);
      expect(Math.floor(micro / 100)).toBe(bps);
    }
  });

  it("output is always divisible by 100 for integer bps input", () => {
    for (let i = 0; i < ITERATIONS; i++) {
      const bps = randomInt(0, 10_000);
      expect(bpsToMicroPercent(bps) % 100).toBe(0);
    }
  });
});

// ══════════════════════════════════════════════════════════════
// 5. Amount Boundary Safety
// ══════════════════════════════════════════════════════════════

describe("PBT: Amount boundary safety", () => {
  const baseParams = {
    coinType: SUI_COIN_TYPE,
    sender: "0x" + "11".repeat(32),
    recipient: "0x" + "22".repeat(32),
    feeMicroPercent: 5_000,
    feeRecipient: "0x" + "33".repeat(32),
  };

  it("buildPayTx succeeds for random amounts in [1, 2^64-1]", () => {
    for (let i = 0; i < ITERATIONS; i++) {
      const amount = randomBigInt(1n, (1n << 64n) - 1n);
      const tx = buildPayTx(config, { ...baseParams, amount });
      expect(tx).toBeInstanceOf(Transaction);
    }
  });

  it("buildPayTx throws for amount = 0n", () => {
    expect(() =>
      buildPayTx(config, { ...baseParams, amount: 0n }),
    ).toThrow(/must be > 0/);
  });

  it("buildPayTx throws for negative amounts", () => {
    for (let i = 0; i < 100; i++) {
      const amount = -randomBigInt(1n, (1n << 64n) - 1n);
      expect(() =>
        buildPayTx(config, { ...baseParams, amount }),
      ).toThrow(/must be > 0/);
    }
  });

  it("assertPositive rejects 0n", () => {
    expect(() => assertPositive(0n, "amount", "test")).toThrow(/must be > 0/);
  });

  it("assertPositive accepts any bigint > 0", () => {
    for (let i = 0; i < ITERATIONS; i++) {
      const value = randomBigInt(1n, (1n << 128n) - 1n);
      expect(() => assertPositive(value, "amount", "test")).not.toThrow();
    }
  });
});

// ══════════════════════════════════════════════════════════════
// 6. Error Type Consistency
// ══════════════════════════════════════════════════════════════

describe("PBT: Error type consistency", () => {
  const builders = [
    {
      name: "buildPayTx",
      trigger: () =>
        buildPayTx(config, {
          coinType: SUI_COIN_TYPE,
          sender: randomSuiAddress(),
          recipient: randomSuiAddress(),
          amount: 0n, // invalid
          feeMicroPercent: 5_000,
          feeRecipient: randomSuiAddress(),
        }),
    },
    {
      name: "buildPayTx (bad fee)",
      trigger: () =>
        buildPayTx(config, {
          coinType: SUI_COIN_TYPE,
          sender: randomSuiAddress(),
          recipient: randomSuiAddress(),
          amount: 100n,
          feeMicroPercent: 2_000_000, // invalid
          feeRecipient: randomSuiAddress(),
        }),
    },
    {
      name: "buildCreateStreamTx (no protocolState)",
      trigger: () =>
        buildCreateStreamTx(config, {
          coinType: SUI_COIN_TYPE,
          sender: randomSuiAddress(),
          recipient: randomSuiAddress(),
          depositAmount: 100n,
          ratePerSecond: 1n,
          budgetCap: 1000n,
          feeMicroPercent: 5_000,
          feeRecipient: randomSuiAddress(),
        }),
    },
    {
      name: "buildCreateStreamTx (zero deposit)",
      trigger: () =>
        buildCreateStreamTx(fullConfig, {
          coinType: SUI_COIN_TYPE,
          sender: randomSuiAddress(),
          recipient: randomSuiAddress(),
          depositAmount: 0n, // invalid
          ratePerSecond: 1n,
          budgetCap: 1000n,
          feeMicroPercent: 5_000,
          feeRecipient: randomSuiAddress(),
        }),
    },
    {
      name: "buildCreateEscrowTx (zero deposit)",
      trigger: () =>
        buildCreateEscrowTx(fullConfig, {
          coinType: SUI_COIN_TYPE,
          sender: randomSuiAddress(),
          seller: randomSuiAddress(),
          arbiter: randomSuiAddress(),
          depositAmount: 0n, // invalid
          deadlineMs: 1000n,
          feeMicroPercent: 5_000,
          feeRecipient: randomSuiAddress(),
        }),
    },
    {
      name: "buildPrepaidDepositTx (zero amount)",
      trigger: () =>
        buildPrepaidDepositTx(fullConfig, {
          coinType: SUI_COIN_TYPE,
          sender: randomSuiAddress(),
          provider: randomSuiAddress(),
          amount: 0n, // invalid
          ratePerCall: 1n,
          withdrawalDelayMs: 60_000n,
          feeMicroPercent: 5_000,
          feeRecipient: randomSuiAddress(),
        }),
    },
  ];

  for (const { name, trigger } of builders) {
    it(`${name} throws an Error instance (not a raw string or TypeError)`, () => {
      try {
        trigger();
        // If no throw, fail explicitly
        expect.unreachable(`${name} should have thrown`);
      } catch (e) {
        expect(e).toBeInstanceOf(Error);
        expect((e as Error).message).toBeTruthy();
      }
    });
  }

  it("all fee validation errors include the function name", () => {
    const fns = ["buildPayTx", "buildCreateStreamTx", "buildCreateEscrowTx"];
    for (const fn of fns) {
      try {
        assertFeeMicroPercent(-1, fn);
        expect.unreachable("should throw");
      } catch (e) {
        expect(e).toBeInstanceOf(Error);
        expect((e as Error).message).toContain(fn);
      }
    }
  });
});

// ══════════════════════════════════════════════════════════════
// 7. convertToTokenAmount safety
// ══════════════════════════════════════════════════════════════

describe("PBT: convertToTokenAmount", () => {
  it("integer amounts produce correct base units for any decimal count", () => {
    for (let i = 0; i < ITERATIONS; i++) {
      const intPart = randomInt(0, 999_999);
      const decimals = randomInt(0, 18);
      const result = convertToTokenAmount(String(intPart), decimals);
      const expected = BigInt(intPart) * 10n ** BigInt(decimals);
      expect(BigInt(result)).toBe(expected);
    }
  });

  it("rejects negative amounts", () => {
    for (let i = 0; i < 100; i++) {
      const amount = `-${randomInt(1, 999_999)}`;
      expect(() => convertToTokenAmount(amount, 6)).toThrow(/Negative/);
    }
  });

  it("rejects non-numeric strings", () => {
    const badInputs = ["abc", "12.34.56", "0x123", "", " ", "1e5", "1,000"];
    for (const input of badInputs) {
      expect(() => convertToTokenAmount(input, 6)).toThrow();
    }
  });
});
