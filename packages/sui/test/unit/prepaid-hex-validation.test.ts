/**
 * F6 Verification: hexToBytes input validation tests.
 *
 * hexToBytes is private in prepaid.ts, but called by buildDepositWithReceiptsTx
 * when converting providerPubkey from hex to bytes. We test indirectly by
 * calling buildDepositWithReceiptsTx with malformed pubkey hex strings.
 */

import { describe, it, expect } from "vitest";
import { buildDepositWithReceiptsTx } from "../../src/ptb/prepaid";

const config = { packageId: "0x1", protocolStateId: "0x2" };

const validParams = {
  sender: "0xA1",
  coinType: "0x2::sui::SUI",
  amount: 1_000_000n,
  provider: "0xBEEF",
  ratePerCall: 1000n,
  maxCalls: 100n,
  withdrawalDelayMs: 1_800_000n,
  feeMicroPercent: 50_000,
  feeRecipient: "0xFEE",
  disputeWindowMs: 300_000n,
};

describe("hexToBytes validation (F6)", () => {
  it("should throw on odd-length hex string", () => {
    expect(() =>
      buildDepositWithReceiptsTx(config, {
        ...validParams,
        providerPubkey: "abc", // 3 chars = odd length
      }),
    ).toThrow("odd length");
  });

  it("should throw on non-hex characters", () => {
    expect(() =>
      buildDepositWithReceiptsTx(config, {
        ...validParams,
        providerPubkey: "ZZZZ", // non-hex chars
      }),
    ).toThrow("non-hex characters");
  });

  it("should accept valid hex with 0x prefix", () => {
    // Valid hex — doesn't throw at hexToBytes level
    // (may still fail at contract level if not 32 bytes, but that's a different check)
    expect(() =>
      buildDepositWithReceiptsTx(config, {
        ...validParams,
        providerPubkey: "0xaabbccdd",
      }),
    ).not.toThrow();
  });

  it("should accept valid 64-char hex (32 bytes)", () => {
    expect(() =>
      buildDepositWithReceiptsTx(config, {
        ...validParams,
        providerPubkey:
          "9548a40fe4733bbae93bcc906e38bd6705c3faa2309b42f2b088778934" +
          "9bb738",
      }),
    ).not.toThrow();
  });

  it("should accept empty string (edge case)", () => {
    // Empty string → empty bytes vector. Contract would reject (not 32 bytes),
    // but hexToBytes itself should not throw.
    expect(() =>
      buildDepositWithReceiptsTx(config, {
        ...validParams,
        providerPubkey: "",
      }),
    ).not.toThrow();
  });
});
