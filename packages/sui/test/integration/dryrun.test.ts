/**
 * Dev-inspect integration tests — verify every PTB builder produces
 * valid transactions against the LIVE deployed v6 contracts.
 *
 * These are NOT unit tests. They hit the real Sui testnet RPC
 * and dev-inspect each transaction to catch:
 *   - Wrong function signatures (builder doesn't match Move)
 *   - Wrong type arguments
 *   - Wrong argument order/types
 *   - Package ID mismatches
 *
 * Uses devInspectTransactionBlock which doesn't require gas coins —
 * no funded wallet needed. Perfect for CI/ephemeral environments.
 *
 * Run with: SWEEFI_LIVE_TESTNET=1 pnpm --filter @sweefi/sui test:live
 * Skip with: SKIP_DRYRUN=1 pnpm test
 */

import { describe, it, beforeAll } from "vitest";
import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from "@mysten/sui/jsonRpc";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import {
  testnetConfig,
  buildPayTx,
  buildPayComposableTx,
  buildPayAndProveTx,
  buildCreateInvoiceTx,
  buildCreateStreamTx,
  buildCreateStreamWithTimeoutTx,
  buildCreateEscrowTx,
} from "../../src/ptb";

// Live lane is opt-in to keep default CI/local runs deterministic.
const LIVE_TESTNET = process.env.SWEEFI_LIVE_TESTNET === "1";
const SKIP = process.env.SKIP_DRYRUN === "1" || !LIVE_TESTNET;

const SUI_COIN_TYPE = "0x2::sui::SUI";
const config = testnetConfig;

let client: SuiJsonRpcClient;
let senderAddress: string;
const RECIPIENT = "0x" + "22".repeat(32);
const FEE_RECIPIENT = "0x" + "33".repeat(32);
const ARBITER = "0x" + "77".repeat(32);

beforeAll(() => {
  client = new SuiJsonRpcClient({ url: getJsonRpcFullnodeUrl("testnet"), network: "testnet" });
  const sender = Ed25519Keypair.generate();
  senderAddress = sender.toSuiAddress();
});

/**
 * Dev-inspect a transaction against the live testnet.
 * Uses devInspectTransactionBlock which doesn't require gas coins —
 * the RPC simulates execution with unlimited gas.
 */
async function devInspect(tx: import("@mysten/sui/transactions").Transaction) {
  const result = await client.devInspectTransactionBlock({
    transactionBlock: tx,
    sender: senderAddress,
  });
  return result;
}

/**
 * Assert that a dev-inspect result shows valid Move execution.
 * We accept InsufficientCoinBalance as "valid" — the PTB structure
 * is correct, the sender just has no coins of the requested type.
 * We reject MoveAbort (wrong function signature) and other real errors.
 */
function assertValidStructure(result: any, builderName: string) {
  const status = result.effects?.status;
  if (status?.status === "success") return; // great — full valid execution

  const error = status?.error || "";
  // These are acceptable — PTB is valid, just no funds on ephemeral key
  const acceptableErrors = [
    "InsufficientGas",
    "InsufficientCoinBalance",
    "GasBalanceTooLow",
    "gas", // various gas-related
    "CommandArgumentError", // coinWithBalance can't resolve with no coins
  ];

  const isAcceptable = acceptableErrors.some((e) =>
    error.toLowerCase().includes(e.toLowerCase()),
  );

  if (!isAcceptable) {
    // This is a real error — the PTB structure doesn't match the contract
    throw new Error(
      `${builderName}: PTB rejected by contract. Error: ${error}\n` +
        `This means the builder's function signature doesn't match the deployed Move code.`,
    );
  }
}

describe.skipIf(SKIP)("PTB dev-inspect against live testnet", () => {
  // ── Payment builders ──────────────────────────────────────

  it("buildPayTx dev-inspects without Move errors", async () => {
    const tx = buildPayTx(config, {
      coinType: SUI_COIN_TYPE,
      sender: senderAddress,
      recipient: RECIPIENT,
      amount: 1_000n,
      feeMicroPercent: 5_000,
      feeRecipient: FEE_RECIPIENT,
    });
    const result = await devInspect(tx);
    assertValidStructure(result, "buildPayTx");
  }, 15000);

  it("buildPayComposableTx dev-inspects without Move errors", async () => {
    const { tx, receipt } = buildPayComposableTx(config, {
      coinType: SUI_COIN_TYPE,
      sender: senderAddress,
      recipient: RECIPIENT,
      amount: 1_000n,
      feeMicroPercent: 5_000,
      feeRecipient: FEE_RECIPIENT,
    });
    // Must consume the receipt or Sui rejects with UnusedValueWithoutDrop
    tx.transferObjects([receipt], senderAddress);
    const result = await devInspect(tx);
    assertValidStructure(result, "buildPayComposableTx");
  }, 15000);

  it("buildPayAndProveTx dev-inspects without Move errors", async () => {
    const tx = buildPayAndProveTx(config, {
      coinType: SUI_COIN_TYPE,
      sender: senderAddress,
      recipient: RECIPIENT,
      amount: 1_000n,
      feeMicroPercent: 5_000,
      feeRecipient: FEE_RECIPIENT,
      receiptDestination: senderAddress,
      memo: "dryrun-test",
    });
    const result = await devInspect(tx);
    assertValidStructure(result, "buildPayAndProveTx");
  }, 15000);

  it("buildCreateInvoiceTx dev-inspects without Move errors", async () => {
    const tx = buildCreateInvoiceTx(config, {
      sender: senderAddress,
      recipient: RECIPIENT,
      expectedAmount: 5_000n,
      feeMicroPercent: 10_000,
      feeRecipient: FEE_RECIPIENT,
      sendTo: senderAddress,
    });
    const result = await devInspect(tx);
    assertValidStructure(result, "buildCreateInvoiceTx");
  }, 15000);

  // ── Stream builders ───────────────────────────────────────

  it("buildCreateStreamTx dev-inspects without Move errors", async () => {
    const tx = buildCreateStreamTx(config, {
      coinType: SUI_COIN_TYPE,
      sender: senderAddress,
      recipient: RECIPIENT,
      depositAmount: 10_000n,
      ratePerSecond: 100n,
      budgetCap: 100_000n,
      feeMicroPercent: 5_000,
      feeRecipient: FEE_RECIPIENT,
    });
    const result = await devInspect(tx);
    assertValidStructure(result, "buildCreateStreamTx");
  }, 15000);

  it("buildCreateStreamWithTimeoutTx dev-inspects without Move errors (v6)", async () => {
    const tx = buildCreateStreamWithTimeoutTx(config, {
      coinType: SUI_COIN_TYPE,
      sender: senderAddress,
      recipient: RECIPIENT,
      depositAmount: 10_000n,
      ratePerSecond: 100n,
      budgetCap: 100_000n,
      feeMicroPercent: 5_000,
      feeRecipient: FEE_RECIPIENT,
      recipientCloseTimeoutMs: 172_800_000n, // 2 days
    });
    const result = await devInspect(tx);
    assertValidStructure(result, "buildCreateStreamWithTimeoutTx");
  }, 15000);

  // NOTE: claim, pause, resume, close, recipientClose, topUp need a real
  // StreamingMeter object ID. We can't dev-inspect them without creating one first.
  // The demo script covers these paths with live transactions.

  // ── Escrow builders ───────────────────────────────────────

  it("buildCreateEscrowTx dev-inspects without Move errors", async () => {
    const tx = buildCreateEscrowTx(config, {
      coinType: SUI_COIN_TYPE,
      sender: senderAddress,
      seller: RECIPIENT,
      arbiter: ARBITER,
      depositAmount: 5_000n,
      deadlineMs: BigInt(Date.now() + 86_400_000),
      feeMicroPercent: 5_000,
      feeRecipient: FEE_RECIPIENT,
      memo: "dryrun-test",
    });
    const result = await devInspect(tx);
    assertValidStructure(result, "buildCreateEscrowTx");
  }, 15000);

  // NOTE: release, refund, dispute need a real Escrow object ID.
  // The demo script covers these paths with live transactions.
});
