import { describe, it, expect } from "vitest";
import {
  ExactSuiScheme,
  validateSuiAddress,
  convertToTokenAmount,
  getUsdcCoinType,
  coinTypesEqual,
  SUI_ADDRESS_REGEX,
  SUI_MAINNET_CAIP2,
  SUI_TESTNET_CAIP2,
  SUI_DEVNET_CAIP2,
  USDC_MAINNET,
  USDC_TESTNET,
  USDC_DECIMALS,
  SUI_DECIMALS,
  SUI_COIN_TYPE,
} from "../../src/index";
import { ExactSuiScheme as ServerExactSuiScheme } from "../../src/exact/server/scheme";
import { ExactSuiScheme as FacilitatorExactSuiScheme } from "../../src/exact/facilitator/scheme";
import type { FacilitatorSuiSigner } from "../../src/signer";
import type { DryRunTransactionBlockResponse } from "@mysten/sui/client";

// ─────────────────────────────────────────────────
// Test Helpers
// ─────────────────────────────────────────────────

function createMockFacilitatorSigner(
  overrides: Partial<FacilitatorSuiSigner> = {},
): FacilitatorSuiSigner {
  return {
    getAddresses: () => ["0x" + "a".repeat(64)],
    verifySignature: async () => "0x" + "b".repeat(64),
    simulateTransaction: async () => createSuccessfulDryRun(),
    executeTransaction: async () => "mock-digest-" + Date.now(),
    waitForTransaction: async () => {},
    ...overrides,
  };
}

function createSuccessfulDryRun(
  balanceChanges: Array<{
    owner: { AddressOwner: string } | string;
    coinType: string;
    amount: string;
  }> = [],
): DryRunTransactionBlockResponse {
  return {
    effects: {
      status: { status: "success" },
    },
    balanceChanges,
    events: [],
    input: {} as any,
    objectChanges: [],
  } as unknown as DryRunTransactionBlockResponse;
}

function createFailedDryRun(error: string): DryRunTransactionBlockResponse {
  return {
    effects: {
      status: { status: "failure", error },
    },
    balanceChanges: [],
    events: [],
    input: {} as any,
    objectChanges: [],
  } as unknown as DryRunTransactionBlockResponse;
}

const MOCK_PAYER = "0x" + "b".repeat(64);
const MOCK_PAYTO = "0x" + "c".repeat(64);
const MOCK_FACILITATOR = "0x" + "a".repeat(64);

function createMockPayload(scheme = "exact", network = SUI_MAINNET_CAIP2) {
  return {
    x402Version: 2,
    accepted: { scheme, network },
    payload: {
      signature: "mock-signature-base64",
      transaction: "mock-transaction-base64",
    },
  };
}

function createMockRequirements(overrides: Record<string, unknown> = {}) {
  return {
    scheme: "exact",
    network: SUI_MAINNET_CAIP2,
    asset: USDC_MAINNET,
    amount: "100000",
    payTo: MOCK_PAYTO,
    maxTimeoutSeconds: 3600,
    ...overrides,
  };
}

// ─────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────

describe("@x402/sui", () => {
  it("should export main classes", () => {
    expect(ExactSuiScheme).toBeDefined();
  });

  // ─────────────────────────────────────────────
  // Constants & Utilities
  // ─────────────────────────────────────────────

  describe("validateSuiAddress", () => {
    it("should validate correct Sui addresses", () => {
      expect(validateSuiAddress("0x" + "a".repeat(64))).toBe(true);
      expect(validateSuiAddress("0x" + "0".repeat(64))).toBe(true);
      expect(validateSuiAddress("0x" + "f".repeat(64))).toBe(true);
    });

    it("should reject invalid addresses", () => {
      expect(validateSuiAddress("")).toBe(false);
      expect(validateSuiAddress("invalid")).toBe(false);
      expect(validateSuiAddress("0x1234")).toBe(false); // too short
      expect(validateSuiAddress("a".repeat(64))).toBe(false); // no 0x prefix
      expect(validateSuiAddress("0x" + "g".repeat(64))).toBe(false); // invalid hex
    });
  });

  describe("convertToTokenAmount", () => {
    it("should convert decimal amounts to USDC units (6 decimals)", () => {
      expect(convertToTokenAmount("4.02", 6)).toBe("4020000");
      expect(convertToTokenAmount("0.10", 6)).toBe("100000");
      expect(convertToTokenAmount("1.00", 6)).toBe("1000000");
      expect(convertToTokenAmount("0.01", 6)).toBe("10000");
      expect(convertToTokenAmount("123.456789", 6)).toBe("123456789");
    });

    it("should handle whole numbers", () => {
      expect(convertToTokenAmount("1", 6)).toBe("1000000");
      expect(convertToTokenAmount("100", 6)).toBe("100000000");
    });

    it("should handle SUI decimals (9)", () => {
      expect(convertToTokenAmount("1", 9)).toBe("1000000000");
      expect(convertToTokenAmount("0.5", 9)).toBe("500000000");
    });

    it("should throw for invalid amounts", () => {
      expect(() => convertToTokenAmount("abc", 6)).toThrow("Invalid amount");
      expect(() => convertToTokenAmount("", 6)).toThrow("Invalid amount");
      expect(() => convertToTokenAmount("NaN", 6)).toThrow("Invalid amount");
    });

    it("should reject negative amounts", () => {
      expect(() => convertToTokenAmount("-1.00", 6)).toThrow("Negative amounts not allowed");
      expect(() => convertToTokenAmount("-0.01", 6)).toThrow("Negative amounts not allowed");
    });

    it("should truncate sub-atomic amounts (no floating-point rounding)", () => {
      expect(convertToTokenAmount("0.0000001", 6)).toBe("0"); // 0.1 of smallest unit → 0
      expect(convertToTokenAmount("0.0000009", 6)).toBe("0"); // 0.9 of smallest unit → 0 (truncate, not round)
    });
  });

  describe("getUsdcCoinType", () => {
    it("should return mainnet USDC", () => {
      expect(getUsdcCoinType(SUI_MAINNET_CAIP2)).toBe(USDC_MAINNET);
    });

    it("should return testnet USDC", () => {
      expect(getUsdcCoinType(SUI_TESTNET_CAIP2)).toBe(USDC_TESTNET);
    });

    it("should return devnet USDC", () => {
      expect(getUsdcCoinType(SUI_DEVNET_CAIP2)).toBe(USDC_TESTNET);
    });

    it("should throw for unsupported networks", () => {
      expect(() => getUsdcCoinType("ethereum:1")).toThrow("No USDC coin type configured");
    });
  });

  describe("coinTypesEqual", () => {
    it("should match identical coin types", () => {
      expect(coinTypesEqual(USDC_MAINNET, USDC_MAINNET)).toBe(true);
      expect(coinTypesEqual(SUI_COIN_TYPE, SUI_COIN_TYPE)).toBe(true);
    });

    it("should match after normalization", () => {
      // normalizeStructTag handles variations in address formatting
      expect(
        coinTypesEqual(
          "0x2::sui::SUI",
          "0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI",
        ),
      ).toBe(true);
    });
  });

  describe("Constants", () => {
    it("should export correct USDC address", () => {
      expect(USDC_MAINNET).toContain("::usdc::USDC");
    });

    it("should export correct SUI coin type", () => {
      expect(SUI_COIN_TYPE).toBe("0x2::sui::SUI");
    });

    it("should export correct decimals", () => {
      expect(USDC_DECIMALS).toBe(6);
      expect(SUI_DECIMALS).toBe(9);
    });

    it("should export correct CAIP-2 identifiers", () => {
      expect(SUI_MAINNET_CAIP2).toBe("sui:mainnet");
      expect(SUI_TESTNET_CAIP2).toBe("sui:testnet");
      expect(SUI_DEVNET_CAIP2).toBe("sui:devnet");
    });

    it("should have valid address regex", () => {
      expect(SUI_ADDRESS_REGEX).toBeInstanceOf(RegExp);
    });
  });

  // ─────────────────────────────────────────────
  // Server Scheme
  // ─────────────────────────────────────────────

  describe("ExactSuiScheme (Server)", () => {
    const server = new ServerExactSuiScheme();

    describe("parsePrice", () => {
      it("should parse dollar string prices to USDC", async () => {
        const result = await server.parsePrice("$0.10", SUI_MAINNET_CAIP2);
        expect(result.amount).toBe("100000");
        expect(result.asset).toBe(USDC_MAINNET);
      });

      it("should parse simple number string prices", async () => {
        const result = await server.parsePrice("0.10", SUI_MAINNET_CAIP2);
        expect(result.amount).toBe("100000");
        expect(result.asset).toBe(USDC_MAINNET);
      });

      it("should parse number prices", async () => {
        const result = await server.parsePrice(0.1, SUI_MAINNET_CAIP2);
        expect(result.amount).toBe("100000");
        expect(result.asset).toBe(USDC_MAINNET);
      });

      it("should parse explicit USDC suffix", async () => {
        const result = await server.parsePrice("0.10 USDC", SUI_MAINNET_CAIP2);
        expect(result.amount).toBe("100000");
      });

      it("should parse USD as USDC", async () => {
        const result = await server.parsePrice("0.10 USD", SUI_MAINNET_CAIP2);
        expect(result.amount).toBe("100000");
      });

      it("should use testnet USDC for testnet network", async () => {
        const result = await server.parsePrice("1.00", SUI_TESTNET_CAIP2);
        expect(result.asset).toBe(USDC_TESTNET);
        expect(result.amount).toBe("1000000");
      });

      it("should handle pre-parsed price objects", async () => {
        const result = await server.parsePrice(
          { amount: "123456", asset: SUI_COIN_TYPE, extra: {} },
          SUI_MAINNET_CAIP2,
        );
        expect(result.amount).toBe("123456");
        expect(result.asset).toBe(SUI_COIN_TYPE);
      });

      it("should throw for invalid price formats", async () => {
        await expect(
          async () => await server.parsePrice("not-a-price!", SUI_MAINNET_CAIP2),
        ).rejects.toThrow("Invalid money format");
      });

      it("should throw for price objects without asset", async () => {
        await expect(
          async () => await server.parsePrice({ amount: "123456" } as never, SUI_MAINNET_CAIP2),
        ).rejects.toThrow("Asset address must be specified");
      });

      it("should avoid floating-point rounding error", async () => {
        const result = await server.parsePrice("$4.02", SUI_MAINNET_CAIP2);
        expect(result.amount).toBe("4020000");
      });
    });

    describe("enhancePaymentRequirements", () => {
      it("should pass through facilitator extras", async () => {
        const requirements = createMockRequirements({ extra: {} });
        const result = await server.enhancePaymentRequirements(
          requirements as never,
          {
            x402Version: 2,
            scheme: "exact",
            network: SUI_MAINNET_CAIP2,
            extra: { gasStation: "https://gas.example.com" },
          },
          [],
        );

        expect(result.extra).toEqual({ gasStation: "https://gas.example.com" });
      });

      it("should preserve existing extra fields", async () => {
        const requirements = createMockRequirements({ extra: { custom: "value" } });
        const result = await server.enhancePaymentRequirements(
          requirements as never,
          {
            x402Version: 2,
            scheme: "exact",
            network: SUI_MAINNET_CAIP2,
            extra: { gasStation: "https://gas.example.com" },
          },
          [],
        );

        expect(result.extra).toEqual({
          custom: "value",
          gasStation: "https://gas.example.com",
        });
      });
    });
  });

  // ─────────────────────────────────────────────
  // Facilitator Scheme
  // ─────────────────────────────────────────────

  describe("ExactSuiScheme (Facilitator)", () => {
    describe("interface conformance", () => {
      const signer = createMockFacilitatorSigner();
      const facilitator = new FacilitatorExactSuiScheme(signer);

      it("should have scheme 'exact'", () => {
        expect(facilitator.scheme).toBe("exact");
      });

      it("should have caipFamily 'sui:*'", () => {
        expect(facilitator.caipFamily).toBe("sui:*");
      });

      it("should implement getExtra", () => {
        expect(typeof facilitator.getExtra).toBe("function");
      });

      it("should implement getSigners", () => {
        expect(typeof facilitator.getSigners).toBe("function");
      });

      it("should implement verify", () => {
        expect(typeof facilitator.verify).toBe("function");
      });

      it("should implement settle", () => {
        expect(typeof facilitator.settle).toBe("function");
      });
    });

    describe("getExtra", () => {
      it("should return undefined when no gas station configured", () => {
        const signer = createMockFacilitatorSigner();
        const facilitator = new FacilitatorExactSuiScheme(signer);
        expect(facilitator.getExtra(SUI_MAINNET_CAIP2)).toBeUndefined();
      });

      it("should return gasStation URL when configured", () => {
        const signer = createMockFacilitatorSigner();
        const facilitator = new FacilitatorExactSuiScheme(signer, "https://gas.example.com");
        expect(facilitator.getExtra(SUI_MAINNET_CAIP2)).toEqual({
          gasStation: "https://gas.example.com",
        });
      });
    });

    describe("getSigners", () => {
      it("should return signer addresses", () => {
        const signer = createMockFacilitatorSigner();
        const facilitator = new FacilitatorExactSuiScheme(signer);
        expect(facilitator.getSigners(SUI_MAINNET_CAIP2)).toEqual([MOCK_FACILITATOR]);
      });
    });

    describe("verify", () => {
      it("should return isValid:true for valid payment", async () => {
        const signer = createMockFacilitatorSigner({
          verifySignature: async () => MOCK_PAYER,
          simulateTransaction: async () =>
            createSuccessfulDryRun([
              {
                owner: { AddressOwner: MOCK_PAYTO },
                coinType: USDC_MAINNET,
                amount: "100000",
              },
            ]),
        });
        const facilitator = new FacilitatorExactSuiScheme(signer);
        const result = await facilitator.verify(
          createMockPayload() as any,
          createMockRequirements() as any,
        );

        expect(result.isValid).toBe(true);
        expect(result.payer).toBe(MOCK_PAYER);
      });

      it("should reject unsupported scheme", async () => {
        const signer = createMockFacilitatorSigner();
        const facilitator = new FacilitatorExactSuiScheme(signer);
        const result = await facilitator.verify(
          createMockPayload("other") as any,
          createMockRequirements() as any,
        );

        expect(result.isValid).toBe(false);
        expect(result.invalidReason).toBe("unsupported_scheme");
      });

      it("should reject network mismatch", async () => {
        const signer = createMockFacilitatorSigner();
        const facilitator = new FacilitatorExactSuiScheme(signer);
        const result = await facilitator.verify(
          createMockPayload("exact", SUI_TESTNET_CAIP2) as any,
          createMockRequirements() as any,
        );

        expect(result.isValid).toBe(false);
        expect(result.invalidReason).toBe("network_mismatch");
      });

      it("should reject malformed payload (missing transaction)", async () => {
        const signer = createMockFacilitatorSigner();
        const facilitator = new FacilitatorExactSuiScheme(signer);
        const payload = {
          x402Version: 2,
          accepted: { scheme: "exact", network: SUI_MAINNET_CAIP2 },
          payload: { signature: "sig" },
        };
        const result = await facilitator.verify(payload as any, createMockRequirements() as any);

        expect(result.isValid).toBe(false);
        expect(result.invalidReason).toBe(
          "invalid_exact_sui_payload_transaction_could_not_be_decoded",
        );
      });

      it("should reject invalid signature", async () => {
        const signer = createMockFacilitatorSigner({
          verifySignature: async () => {
            throw new Error("Invalid signature");
          },
        });
        const facilitator = new FacilitatorExactSuiScheme(signer);
        const result = await facilitator.verify(
          createMockPayload() as any,
          createMockRequirements() as any,
        );

        expect(result.isValid).toBe(false);
        expect(result.invalidReason).toBe(
          "invalid_exact_sui_payload_transaction_signature_verification_failed",
        );
      });

      it("should reject dry-run failure", async () => {
        const signer = createMockFacilitatorSigner({
          verifySignature: async () => MOCK_PAYER,
          simulateTransaction: async () => createFailedDryRun("InsufficientCoinBalance"),
        });
        const facilitator = new FacilitatorExactSuiScheme(signer);
        const result = await facilitator.verify(
          createMockPayload() as any,
          createMockRequirements() as any,
        );

        expect(result.isValid).toBe(false);
        expect(result.invalidReason).toBe("invalid_exact_sui_payload_transaction_dry_run_failed");
      });

      it("should reject wrong recipient (recipient mismatch)", async () => {
        const signer = createMockFacilitatorSigner({
          verifySignature: async () => MOCK_PAYER,
          simulateTransaction: async () =>
            createSuccessfulDryRun([
              {
                owner: { AddressOwner: "0x" + "d".repeat(64) }, // wrong recipient
                coinType: USDC_MAINNET,
                amount: "100000",
              },
            ]),
        });
        const facilitator = new FacilitatorExactSuiScheme(signer);
        const result = await facilitator.verify(
          createMockPayload() as any,
          createMockRequirements() as any,
        );

        expect(result.isValid).toBe(false);
        expect(result.invalidReason).toBe("invalid_exact_sui_payload_recipient_mismatch");
      });

      it("should reject wrong coin type (asset mismatch)", async () => {
        const signer = createMockFacilitatorSigner({
          verifySignature: async () => MOCK_PAYER,
          simulateTransaction: async () =>
            createSuccessfulDryRun([
              {
                owner: { AddressOwner: MOCK_PAYTO },
                coinType: SUI_COIN_TYPE, // wrong coin type — sent SUI not USDC
                amount: "100000",
              },
            ]),
        });
        const facilitator = new FacilitatorExactSuiScheme(signer);
        const result = await facilitator.verify(
          createMockPayload() as any,
          createMockRequirements() as any,
        );

        expect(result.isValid).toBe(false);
        expect(result.invalidReason).toBe("invalid_exact_sui_payload_asset_mismatch");
      });

      it("should reject insufficient amount", async () => {
        const signer = createMockFacilitatorSigner({
          verifySignature: async () => MOCK_PAYER,
          simulateTransaction: async () =>
            createSuccessfulDryRun([
              {
                owner: { AddressOwner: MOCK_PAYTO },
                coinType: USDC_MAINNET,
                amount: "50000", // only 0.05 USDC, need 0.10
              },
            ]),
        });
        const facilitator = new FacilitatorExactSuiScheme(signer);
        const result = await facilitator.verify(
          createMockPayload() as any,
          createMockRequirements() as any,
        );

        expect(result.isValid).toBe(false);
        expect(result.invalidReason).toBe("invalid_exact_sui_payload_amount_insufficient");
      });

      it("should accept overpayment", async () => {
        const signer = createMockFacilitatorSigner({
          verifySignature: async () => MOCK_PAYER,
          simulateTransaction: async () =>
            createSuccessfulDryRun([
              {
                owner: { AddressOwner: MOCK_PAYTO },
                coinType: USDC_MAINNET,
                amount: "200000", // 0.20 USDC, need 0.10
              },
            ]),
        });
        const facilitator = new FacilitatorExactSuiScheme(signer);
        const result = await facilitator.verify(
          createMockPayload() as any,
          createMockRequirements() as any,
        );

        expect(result.isValid).toBe(true);
      });
    });

    describe("settle", () => {
      it("should return success:true and tx digest for valid payment", async () => {
        const mockDigest = "mock-digest-123";
        const signer = createMockFacilitatorSigner({
          verifySignature: async () => MOCK_PAYER,
          simulateTransaction: async () =>
            createSuccessfulDryRun([
              {
                owner: { AddressOwner: MOCK_PAYTO },
                coinType: USDC_MAINNET,
                amount: "100000",
              },
            ]),
          executeTransaction: async () => mockDigest,
        });
        const facilitator = new FacilitatorExactSuiScheme(signer);
        const result = await facilitator.settle(
          createMockPayload() as any,
          createMockRequirements() as any,
        );

        expect(result.success).toBe(true);
        expect(result.transaction).toBe(mockDigest);
        expect(result.network).toBe(SUI_MAINNET_CAIP2);
        expect(result.payer).toBe(MOCK_PAYER);
      });

      it("should return success:false when verification fails", async () => {
        const signer = createMockFacilitatorSigner({
          verifySignature: async () => {
            throw new Error("Invalid signature");
          },
        });
        const facilitator = new FacilitatorExactSuiScheme(signer);
        const result = await facilitator.settle(
          createMockPayload() as any,
          createMockRequirements() as any,
        );

        expect(result.success).toBe(false);
        expect(result.errorReason).toBeTruthy();
      });

      it("should return success:false when execution fails", async () => {
        const signer = createMockFacilitatorSigner({
          verifySignature: async () => MOCK_PAYER,
          simulateTransaction: async () =>
            createSuccessfulDryRun([
              {
                owner: { AddressOwner: MOCK_PAYTO },
                coinType: USDC_MAINNET,
                amount: "100000",
              },
            ]),
          executeTransaction: async () => {
            throw new Error("Network error");
          },
        });
        const facilitator = new FacilitatorExactSuiScheme(signer);
        const result = await facilitator.settle(
          createMockPayload() as any,
          createMockRequirements() as any,
        );

        expect(result.success).toBe(false);
        expect(result.errorReason).toBe("transaction_failed");
      });
    });
  });

  // ─────────────────────────────────────────────
  // Integration placeholders
  // ─────────────────────────────────────────────

  describe("Integration (placeholder)", () => {
    it.todo("should create a valid payment payload with ExactSuiScheme client");
    it.todo("should verify a valid payment with ExactSuiScheme facilitator");
    it.todo("should reject replayed (already-executed) transactions");
    it.todo("should settle valid payments end-to-end");
    it.todo("should handle sponsored transactions");
  });
});
