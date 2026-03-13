import { describe, it, expect } from "vitest";
import {
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
  ExactSuiClientScheme,
  ExactSuiFacilitatorScheme,
  PrepaidSuiClientScheme,
  PrepaidSuiFacilitatorScheme,
  toClientSuiSigner,
  adaptWallet,
  // $extend() plugin API
  sweefi,
  SweefiClient,
  // Transaction builder contracts
  PaymentContract,
  StreamContract,
  EscrowContract,
  PrepaidContract,
  MandateContract,
  AgentMandateContract,
  AdminContract,
  // Config
  SweefiPluginConfig,
  createBuilderConfig,
  // Errors
  SweefiError,
  ConfigurationError,
  ResourceNotFoundError,
  ValidationError,
  SweefiErrorCode,
  // BCS
  StreamingMeterBcs,
  EscrowBcs,
  PrepaidBalanceBcs,
  ProtocolStateBcs,
  MandateBcs,
  InvoiceBcs,
  AgentMandateBcs,
  // Query state enum
  EscrowState,
} from "../../src/index";

describe("@sweefi/sui", () => {
  it("should export s402 scheme classes", () => {
    expect(ExactSuiClientScheme).toBeDefined();
    expect(ExactSuiFacilitatorScheme).toBeDefined();
    expect(PrepaidSuiClientScheme).toBeDefined();
    expect(PrepaidSuiFacilitatorScheme).toBeDefined();
  });

  it("should export adaptWallet as alias for toClientSuiSigner", () => {
    expect(adaptWallet).toBeDefined();
    expect(typeof adaptWallet).toBe("function");
    expect(adaptWallet).toBe(toClientSuiSigner);
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
      expect(convertToTokenAmount("0.0000001", 6)).toBe("0"); // 0.1 of smallest unit -> 0
      expect(convertToTokenAmount("0.0000009", 6)).toBe("0"); // 0.9 of smallest unit -> 0 (truncate, not round)
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
      expect(
        coinTypesEqual(
          "0x2::sui::SUI",
          "0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI",
        ),
      ).toBe(true);
    });
  });

  // ─────────────────────────────────────────────
  // $extend() Plugin API
  // ─────────────────────────────────────────────

  it("should export $extend() plugin factory and client", () => {
    expect(sweefi).toBeDefined();
    expect(typeof sweefi).toBe("function");
    expect(SweefiClient).toBeDefined();
  });

  it("should export all transaction builder contracts", () => {
    expect(PaymentContract).toBeDefined();
    expect(StreamContract).toBeDefined();
    expect(EscrowContract).toBeDefined();
    expect(PrepaidContract).toBeDefined();
    expect(MandateContract).toBeDefined();
    expect(AgentMandateContract).toBeDefined();
    expect(AdminContract).toBeDefined();
  });

  it("should export config utilities", () => {
    expect(SweefiPluginConfig).toBeDefined();
    expect(createBuilderConfig).toBeDefined();
    expect(typeof createBuilderConfig).toBe("function");
  });

  it("should export error classes and codes", () => {
    expect(SweefiError).toBeDefined();
    expect(ConfigurationError).toBeDefined();
    expect(ResourceNotFoundError).toBeDefined();
    expect(ValidationError).toBeDefined();
    expect(SweefiErrorCode).toBeDefined();
  });

  it("should export BCS type definitions for on-chain parsing", () => {
    expect(StreamingMeterBcs).toBeDefined();
    expect(EscrowBcs).toBeDefined();
    expect(PrepaidBalanceBcs).toBeDefined();
    expect(ProtocolStateBcs).toBeDefined();
    expect(MandateBcs).toBeDefined();
    expect(InvoiceBcs).toBeDefined();
    expect(AgentMandateBcs).toBeDefined();
  });

  it("should export query state enums", () => {
    expect(EscrowState).toBeDefined();
    expect(EscrowState.Active).toBeDefined();
    expect(EscrowState.Disputed).toBeDefined();
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
});
