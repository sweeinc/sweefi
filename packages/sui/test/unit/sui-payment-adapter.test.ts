/**
 * SuiPaymentAdapter tests
 *
 * All tests use mock Sui SDK dependencies — zero live-network calls.
 * The SuiJsonRpcClient and Signer are stubbed at the module level.
 */

import { describe, it, expect, vi } from "vitest";
import type { Mock } from "vitest";
import { SuiPaymentAdapter } from "../../src/adapter/SuiPaymentAdapter";
import type { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import type { Signer } from "@mysten/sui/cryptography";
import type { s402PaymentRequirements } from "s402";

// ─── Sui SDK mocks ────────────────────────────────────────────────────────────

// Mock @mysten/sui/transactions so Transaction.build() is synchronous and cheap
vi.mock("@mysten/sui/transactions", () => ({
  Transaction: vi.fn().mockImplementation(() => ({
    setSender: vi.fn(),
    splitCoins: vi.fn().mockReturnValue(["coin1", "coin2"]),
    transferObjects: vi.fn(),
    build: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
  })),
  coinWithBalance: vi.fn().mockReturnValue("mockCoin"),
}));

vi.mock("@mysten/sui/utils", () => ({
  toBase64: vi.fn().mockReturnValue("dHJhbnNhY3Rpb24="), // "transaction" in base64
  fromBase64: vi.fn().mockReturnValue(new Uint8Array([1, 2, 3])),
}));

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const mockReqs: s402PaymentRequirements = {
  s402Version: "1",
  accepts: ["exact"],
  network: "sui:testnet",
  asset: "0x2::sui::SUI",
  amount: "1000000000",
  payTo: "0x" + "1".repeat(64),
};

function makeMockSigner(address = "0x" + "a".repeat(64)): Signer {
  return {
    toSuiAddress: vi.fn().mockReturnValue(address),
    signTransaction: vi.fn().mockResolvedValue({
      signature: "mockSignature",
      bytes: new Uint8Array([4, 5, 6]),
    }),
    getPublicKey: vi.fn(),
  } as unknown as Signer;
}

function makeMockDryRunSuccess(gasUsed = { computationCost: "1000", storageCost: "500", storageRebate: "200" }) {
  return {
    effects: {
      status: { status: "success" },
      gasUsed,
    },
  };
}

function makeMockDryRunFailure(error = "InsufficientGas") {
  return {
    effects: {
      status: { status: "failure", error },
      gasUsed: { computationCost: "0", storageCost: "0", storageRebate: "0" },
    },
  };
}

function makeAdapter(
  dryRunResult?: ReturnType<typeof makeMockDryRunSuccess | typeof makeMockDryRunFailure>,
  executeResult?: { digest: string; effects?: { status?: { status: string; error?: string } } },
): {
  adapter: SuiPaymentAdapter;
  mockClient: SuiJsonRpcClient;
  mockSigner: Signer;
} {
  const mockSigner = makeMockSigner();

  const mockClient = {
    dryRunTransactionBlock: vi.fn().mockResolvedValue(
      dryRunResult ?? makeMockDryRunSuccess()
    ),
    executeTransactionBlock: vi.fn().mockResolvedValue(
      executeResult ?? {
        digest: "0xdeadbeef",
        effects: { status: { status: "success" } },
      }
    ),
  } as unknown as SuiJsonRpcClient;

  const adapter = new SuiPaymentAdapter({
    wallet: mockSigner,
    client: mockClient,
    network: "sui:testnet",
  });

  return { adapter, mockClient, mockSigner };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("SuiPaymentAdapter", () => {
  describe("constructor / getAddress()", () => {
    it("returns the wallet address", () => {
      const { adapter } = makeAdapter();
      expect(adapter.getAddress()).toBe("0x" + "a".repeat(64));
    });

    it("exposes the CAIP-2 network identifier", () => {
      const { adapter } = makeAdapter();
      expect(adapter.network).toBe("sui:testnet");
    });
  });

  describe("simulate()", () => {
    it("returns success with estimated gas fee on a passing dry-run", async () => {
      const { adapter } = makeAdapter(
        makeMockDryRunSuccess({ computationCost: "1000", storageCost: "500", storageRebate: "200" })
      );

      const result = await adapter.simulate(mockReqs);

      expect(result.success).toBe(true);
      // net gas = 1000 + 500 - 200 = 1300
      expect(result.estimatedFee?.amount).toBe(1300n);
      expect(result.estimatedFee?.currency).toBe("SUI");
    });

    it("calls dryRunTransactionBlock on the client", async () => {
      const { adapter, mockClient } = makeAdapter();
      await adapter.simulate(mockReqs);
      expect((mockClient.dryRunTransactionBlock as Mock)).toHaveBeenCalledOnce();
    });

    it("returns failure when dry-run fails with InsufficientGas", async () => {
      const { adapter } = makeAdapter(makeMockDryRunFailure("InsufficientGas"));

      const result = await adapter.simulate(mockReqs);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("INSUFFICIENT_GAS");
    });

    it("returns INSUFFICIENT_BALANCE when dry-run reports insufficient funds", async () => {
      const { adapter } = makeAdapter(makeMockDryRunFailure("Insufficient balance for coin type 0x2::sui::SUI"));

      const result = await adapter.simulate(mockReqs);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("INSUFFICIENT_BALANCE");
    });

    it("returns UNSUPPORTED_SCHEME when accepts does not include 'exact'", async () => {
      const { adapter } = makeAdapter();

      const result = await adapter.simulate({
        ...mockReqs,
        accepts: ["stream"],
      });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("UNSUPPORTED_SCHEME");
    });

    it("returns failure (not throws) when client throws", async () => {
      const { adapter, mockClient } = makeAdapter();
      (mockClient.dryRunTransactionBlock as Mock).mockRejectedValue(
        new Error("RPC connection refused")
      );

      const result = await adapter.simulate(mockReqs);
      expect(result.success).toBe(false);
      expect(result.error?.message).toContain("RPC connection refused");
    });
  });

  describe("signAndBroadcast()", () => {
    it("returns the transaction digest as txId", async () => {
      const { adapter } = makeAdapter();
      const result = await adapter.signAndBroadcast(mockReqs);
      expect(result.txId).toBe("0xdeadbeef");
    });

    it("calls executeTransactionBlock on the client", async () => {
      const { adapter, mockClient } = makeAdapter();
      await adapter.signAndBroadcast(mockReqs);
      expect((mockClient.executeTransactionBlock as Mock)).toHaveBeenCalledOnce();
    });

    it("throws when the transaction fails on-chain", async () => {
      const { adapter } = makeAdapter(
        undefined,
        {
          digest: "0xbad",
          effects: { status: { status: "failure", error: "MoveAbort(payment, 0)" } },
        }
      );

      await expect(adapter.signAndBroadcast(mockReqs)).rejects.toThrow("Transaction failed");
    });

    it("propagates client errors", async () => {
      const { adapter, mockClient } = makeAdapter();
      (mockClient.executeTransactionBlock as Mock).mockRejectedValue(
        new Error("Network timeout")
      );

      await expect(adapter.signAndBroadcast(mockReqs)).rejects.toThrow("Network timeout");
    });
  });

  describe("PaymentAdapter interface compliance", () => {
    it("implements all required PaymentAdapter methods", () => {
      const { adapter } = makeAdapter();
      expect(typeof adapter.getAddress).toBe("function");
      expect(typeof adapter.simulate).toBe("function");
      expect(typeof adapter.signAndBroadcast).toBe("function");
      expect(typeof adapter.network).toBe("string");
    });
  });
});
