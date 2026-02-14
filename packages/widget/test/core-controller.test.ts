import { describe, expect, it, vi } from "vitest";
import { testnetConfig } from "@sweepay/sui/ptb";
import { createCheckoutController, ZERO_ADDRESS } from "../src/core";

function createFixture() {
  const wallet = {
    connect: vi.fn().mockResolvedValue("0xabc"),
    getAddress: vi.fn().mockReturnValue(null as string | null),
    signAndExecuteTransaction: vi.fn().mockResolvedValue({
      digest: "0xdeadbeef",
      objectChanges: [
        {
          type: "created",
          objectType: `${testnetConfig.packageId}::payment::PaymentReceipt`,
          objectId: "0xreceipt",
        },
      ],
    }),
  };

  const suiClient = {
    devInspectTransactionBlock: vi.fn().mockResolvedValue({
      effects: { status: { status: "success" } },
    }),
  } as any;

  const controller = createCheckoutController({
    wallet,
    suiClient,
    config: testnetConfig,
    payment: {
      recipient: "0x1111",
      amount: 1_000n,
      coinType: "0x2::sui::SUI",
      feeBps: 0,
      feeRecipient: ZERO_ADDRESS,
      memo: "test",
    },
  });

  return { wallet, suiClient, controller };
}

describe("SweepayCheckoutController", () => {
  it("connects wallet and sets state", async () => {
    const { controller } = createFixture();
    await controller.connectWallet();
    const state = controller.getState();
    expect(state.status).toBe("connected");
    expect(state.address).toBe("0xabc");
  });

  it("simulates payment and becomes ready", async () => {
    const { controller } = createFixture();
    await controller.connectWallet();
    await controller.simulatePayment();
    expect(controller.getState().status).toBe("ready");
  });

  it("treats insufficient coin dryrun as structurally valid", async () => {
    const { controller, suiClient } = createFixture();
    suiClient.devInspectTransactionBlock.mockResolvedValue({
      effects: { status: { status: "failure", error: "InsufficientCoinBalance" } },
    });
    await controller.connectWallet();
    await controller.simulatePayment();
    expect(controller.getState().status).toBe("ready");
  });

  it("pays and returns digest + receipt", async () => {
    const { controller } = createFixture();
    await controller.connectWallet();
    const result = await controller.pay();
    expect(result.digest).toBe("0xdeadbeef");
    expect(result.receiptId).toBe("0xreceipt");
    expect(controller.getState().status).toBe("paid");
  });

  it("fails if payment result has no digest", async () => {
    const { controller, wallet } = createFixture();
    wallet.signAndExecuteTransaction.mockResolvedValue({});
    await controller.connectWallet();
    await expect(controller.pay()).rejects.toThrow("transaction digest");
    expect(controller.getState().status).toBe("error");
  });
});
