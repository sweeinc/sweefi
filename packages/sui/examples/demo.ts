#!/usr/bin/env tsx
/**
 * SweeFi Testnet Demo — Run all 3 contracts against live Sui testnet
 *
 * Exercises the full contract suite:
 *   1. Direct payment (pay SUI → recipient, with fee split + receipt)
 *   2. Streaming micropayments (create → claim → pause → close)
 *   3. Time-locked escrow (create → release → verify receipt)
 *
 * Usage:
 *   SUI_TESTNET_PRIVATE_KEY=suiprivkey... pnpm demo     # pre-funded key (recommended)
 *   pnpm demo                                            # generates key + faucet (may rate-limit)
 *
 * Requires: network access to Sui testnet
 */

import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from "@mysten/sui/jsonRpc";
import { requestSuiFromFaucetV2, getFaucetHost } from "@mysten/sui/faucet";
import { Transaction } from "@mysten/sui/transactions";
import { testnetConfig } from "../src/ptb";
import { PaymentContract, StreamContract, EscrowContract, createBuilderConfig } from "../src";

// ══════════════════════════════════════════════════════════════
// Config
// ══════════════════════════════════════════════════════════════

const SUI_COIN_TYPE = "0x2::sui::SUI";
const PAYMENT_AMOUNT = 1_000_000n; // 0.001 SUI
const STREAM_DEPOSIT = 10_000_000n; // 0.01 SUI
const STREAM_RATE = 1_000n; // 1000 MIST/sec = 0.000001 SUI/sec
const STREAM_BUDGET_CAP = 5_000_000n; // 0.005 SUI max
const ESCROW_DEPOSIT = 2_000_000n; // 0.002 SUI
const FEE_MICRO_PCT = 5_000; // 0.5% fee (micro-percent: 5_000 / 1_000_000)

const client = new SuiJsonRpcClient({ url: getJsonRpcFullnodeUrl("testnet"), network: "testnet" });
const config = testnetConfig;
const builderConfig = createBuilderConfig({
  packageId: config.packageId,
  protocolState: config.protocolStateId,
});
const payment = new PaymentContract(builderConfig);
const stream = new StreamContract(builderConfig);
const escrowContract = new EscrowContract(builderConfig);

// ══════════════════════════════════════════════════════════════
// Helpers
// ══════════════════════════════════════════════════════════════

function log(section: string, msg: string) {
  console.log(`  [${section}] ${msg}`);
}

function header(title: string) {
  console.log(`\n${"═".repeat(60)}`);
  console.log(`  ${title}`);
  console.log(`${"═".repeat(60)}`);
}

async function signAndExecute(
  keypair: Ed25519Keypair,
  tx: import("@mysten/sui/transactions").Transaction,
): Promise<string> {
  const txBytes = await tx.build({ client });
  const { signature } = await keypair.signTransaction(txBytes);

  const result = await client.executeTransactionBlock({
    transactionBlock: txBytes,
    signature,
    options: { showEffects: true, showBalanceChanges: true, showEvents: true },
  });

  if (result.effects?.status?.status !== "success") {
    throw new Error(`TX failed: ${result.effects?.status?.error}`);
  }

  return result.digest;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// ══════════════════════════════════════════════════════════════
// Setup
// ══════════════════════════════════════════════════════════════

async function setup(): Promise<{
  payer: Ed25519Keypair;
  recipient: Ed25519Keypair;
  feeRecipient: Ed25519Keypair;
}> {
  header("SETUP");

  const payer = process.env.SUI_TESTNET_PRIVATE_KEY
    ? Ed25519Keypair.fromSecretKey(process.env.SUI_TESTNET_PRIVATE_KEY)
    : Ed25519Keypair.generate();

  const recipient = Ed25519Keypair.generate();
  const feeRecipient = Ed25519Keypair.generate();

  log("setup", `Payer:        ${payer.toSuiAddress()}`);
  log("setup", `Recipient:    ${recipient.toSuiAddress()}`);
  log("setup", `Fee recipient: ${feeRecipient.toSuiAddress()}`);
  log("setup", `Package:      ${config.packageId}`);

  if (!process.env.SUI_TESTNET_PRIVATE_KEY) {
    log("setup", "No SUI_TESTNET_PRIVATE_KEY — requesting from faucet...");
    try {
      await requestSuiFromFaucetV2({
        host: getFaucetHost("testnet"),
        recipient: payer.toSuiAddress(),
      });
      log("setup", "Faucet funded. Waiting for indexing...");
      await sleep(3000);
    } catch (err: any) {
      if (err.message?.includes("Too many requests") || err.message?.includes("rate")) {
        console.error("\nFaucet rate-limited. Set SUI_TESTNET_PRIVATE_KEY to use a pre-funded key.");
        process.exit(1);
      }
      throw err;
    }
  }

  const balance = await client.getBalance({
    owner: payer.toSuiAddress(),
    coinType: SUI_COIN_TYPE,
  });
  log("setup", `Balance: ${balance.totalBalance} MIST (${Number(balance.totalBalance) / 1e9} SUI)`);

  // 2x payment + 2x stream + escrow + gas for all 5 demos
  const needed = (PAYMENT_AMOUNT * 2n) + (STREAM_DEPOSIT * 2n) + ESCROW_DEPOSIT + 50_000_000n;
  if (BigInt(balance.totalBalance) < needed) {
    console.error(`\nInsufficient balance. Need ~${needed} MIST, have ${balance.totalBalance}.`);
    process.exit(1);
  }

  return { payer, recipient, feeRecipient };
}

// ══════════════════════════════════════════════════════════════
// Demo 1: Direct Payment
// ══════════════════════════════════════════════════════════════

async function demoPayment(
  payer: Ed25519Keypair,
  recipient: Ed25519Keypair,
  feeRecipient: Ed25519Keypair,
) {
  header("DEMO 1: Direct Payment");
  log("pay", `Paying ${Number(PAYMENT_AMOUNT) / 1e9} SUI to recipient with ${FEE_MICRO_PCT / 10_000}% fee`);

  const tx = new Transaction();
  payment.pay({
    coinType: SUI_COIN_TYPE,
    sender: payer.toSuiAddress(),
    recipient: recipient.toSuiAddress(),
    amount: PAYMENT_AMOUNT,
    feeMicroPercent: FEE_MICRO_PCT,
    feeRecipient: feeRecipient.toSuiAddress(),
    memo: "SweeFi demo payment",
  })(tx);

  const digest = await signAndExecute(payer, tx);
  log("pay", `TX digest: ${digest}`);
  log("pay", `Explorer: https://suiscan.xyz/testnet/tx/${digest}`);

  // Verify on-chain
  await client.waitForTransaction({ digest });
  const txn = await client.getTransactionBlock({
    digest,
    options: { showEffects: true, showBalanceChanges: true, showEvents: true },
  });

  log("pay", `Status: ${txn.effects?.status?.status}`);

  const recipientChange = txn.balanceChanges?.find(
    (c) =>
      c.owner &&
      typeof c.owner === "object" &&
      "AddressOwner" in c.owner &&
      c.owner.AddressOwner === recipient.toSuiAddress(),
  );
  if (recipientChange) {
    log("pay", `Recipient received: ${recipientChange.amount} MIST`);
  }

  // Check for PaymentSettled event
  const paymentEvent = txn.events?.find((e) => e.type.includes("::payment::PaymentSettled"));
  if (paymentEvent) {
    log("pay", `PaymentSettled event emitted (receipt created on-chain)`);
  }

  return digest;
}

// ══════════════════════════════════════════════════════════════
// Demo 2: Streaming Micropayments
// ══════════════════════════════════════════════════════════════

async function demoStream(
  payer: Ed25519Keypair,
  recipient: Ed25519Keypair,
  feeRecipient: Ed25519Keypair,
) {
  header("DEMO 2: Streaming Micropayments");
  log("stream", `Creating stream: ${Number(STREAM_RATE)} MIST/sec, ${Number(STREAM_DEPOSIT) / 1e9} SUI deposit`);

  // Step 1: Create stream
  const createTx = new Transaction();
  stream.create({
    coinType: SUI_COIN_TYPE,
    sender: payer.toSuiAddress(),
    recipient: recipient.toSuiAddress(),
    depositAmount: STREAM_DEPOSIT,
    ratePerSecond: STREAM_RATE,
    budgetCap: STREAM_BUDGET_CAP,
    feeMicroPercent: FEE_MICRO_PCT,
    feeRecipient: feeRecipient.toSuiAddress(),
  })(createTx);

  const createDigest = await signAndExecute(payer, createTx);
  log("stream", `Created: ${createDigest}`);

  // Find the StreamingMeter object from events
  await client.waitForTransaction({ digest: createDigest });
  const createTxn = await client.getTransactionBlock({
    digest: createDigest,
    options: { showEvents: true, showObjectChanges: true },
  });

  const streamEvent = createTxn.events?.find((e) => e.type.includes("::stream::StreamCreated"));
  const meterId = streamEvent?.parsedJson && typeof streamEvent.parsedJson === "object" && "meter_id" in streamEvent.parsedJson
    ? String(streamEvent.parsedJson.meter_id)
    : undefined;

  if (!meterId) {
    log("stream", "Could not find meter ID from event. Checking object changes...");
    const sharedObj = createTxn.objectChanges?.find(
      (c) => c.type === "created" && "objectType" in c && c.objectType.includes("StreamingMeter"),
    );
    if (sharedObj && "objectId" in sharedObj) {
      log("stream", `Meter ID (from object changes): ${sharedObj.objectId}`);
    }
    return createDigest;
  }

  log("stream", `Meter ID: ${meterId}`);

  // Step 2: Wait for accrual, then claim
  log("stream", "Waiting 5 seconds for accrual...");
  await sleep(5000);

  // Fund recipient for gas (they need to call claim)
  try {
    await requestSuiFromFaucetV2({
      host: getFaucetHost("testnet"),
      recipient: recipient.toSuiAddress(),
    });
    await sleep(2000);
  } catch {
    log("stream", "Faucet unavailable for recipient — skipping claim (payer will close instead)");
  }

  // Check if recipient has gas
  const recipientBalance = await client.getBalance({
    owner: recipient.toSuiAddress(),
    coinType: SUI_COIN_TYPE,
  });

  if (BigInt(recipientBalance.totalBalance) > 1_000_000n) {
    const claimTx = new Transaction();
    stream.claim({
      coinType: SUI_COIN_TYPE,
      meterId,
      sender: recipient.toSuiAddress(),
    })(claimTx);

    try {
      const claimDigest = await signAndExecute(recipient, claimTx);
      log("stream", `Claimed: ${claimDigest}`);

      await client.waitForTransaction({ digest: claimDigest });
      const claimTxn = await client.getTransactionBlock({
        digest: claimDigest,
        options: { showEvents: true },
      });
      const claimEvent = claimTxn.events?.find((e) => e.type.includes("::stream::StreamClaimed"));
      if (claimEvent?.parsedJson && typeof claimEvent.parsedJson === "object" && "amount" in claimEvent.parsedJson) {
        log("stream", `Claimed amount: ${claimEvent.parsedJson.amount} MIST`);
      }
    } catch (err: any) {
      log("stream", `Claim failed (expected if no accrual yet): ${err.message?.slice(0, 80)}`);
    }
  } else {
    log("stream", "Recipient has no gas — skipping claim step");
  }

  // Step 3: Payer closes the stream (final claim + refund)
  log("stream", "Closing stream (final claim to recipient, remainder refunded to payer)...");
  const closeTx = new Transaction();
  stream.close({
    coinType: SUI_COIN_TYPE,
    meterId,
    sender: payer.toSuiAddress(),
  })(closeTx);

  const closeDigest = await signAndExecute(payer, closeTx);
  log("stream", `Closed: ${closeDigest}`);
  log("stream", `Explorer: https://suiscan.xyz/testnet/tx/${closeDigest}`);

  return createDigest;
}

// ══════════════════════════════════════════════════════════════
// Demo 3: Time-Locked Escrow
// ══════════════════════════════════════════════════════════════

async function demoEscrow(
  payer: Ed25519Keypair,
  recipient: Ed25519Keypair,
  feeRecipient: Ed25519Keypair,
) {
  header("DEMO 3: Time-Locked Escrow");
  const deadlineMs = BigInt(Date.now() + 300_000); // 5 minutes from now
  log("escrow", `Creating escrow: ${Number(ESCROW_DEPOSIT) / 1e9} SUI, 5-min deadline`);

  // Use payer as arbiter for demo simplicity
  const arbiter = payer;

  // Step 1: Create escrow (buyer deposits)
  const createTx = new Transaction();
  escrowContract.create({
    coinType: SUI_COIN_TYPE,
    sender: payer.toSuiAddress(),
    seller: recipient.toSuiAddress(),
    arbiter: arbiter.toSuiAddress(),
    depositAmount: ESCROW_DEPOSIT,
    deadlineMs,
    feeMicroPercent: FEE_MICRO_PCT,
    feeRecipient: feeRecipient.toSuiAddress(),
    memo: "SweeFi demo escrow — API access license",
  })(createTx);

  const createDigest = await signAndExecute(payer, createTx);
  log("escrow", `Created: ${createDigest}`);

  await client.waitForTransaction({ digest: createDigest });
  const createTxn = await client.getTransactionBlock({
    digest: createDigest,
    options: { showEvents: true, showObjectChanges: true },
  });

  // Find Escrow object ID
  const escrowEvent = createTxn.events?.find((e) => e.type.includes("::escrow::EscrowCreated"));
  let escrowId: string | undefined;

  if (escrowEvent?.parsedJson && typeof escrowEvent.parsedJson === "object" && "escrow_id" in escrowEvent.parsedJson) {
    escrowId = String(escrowEvent.parsedJson.escrow_id);
  }

  if (!escrowId) {
    const createdObj = createTxn.objectChanges?.find(
      (c) => c.type === "created" && "objectType" in c && c.objectType.includes("Escrow"),
    );
    if (createdObj && "objectId" in createdObj) {
      escrowId = createdObj.objectId;
    }
  }

  if (!escrowId) {
    log("escrow", "Could not find escrow ID from events/objects");
    return createDigest;
  }

  log("escrow", `Escrow ID: ${escrowId}`);
  log("escrow", `  -> This ID is the SEAL access condition for encrypted deliverables`);

  // Step 2: Buyer confirms delivery and releases funds to seller.
  // In ACTIVE state, only the buyer can release. In DISPUTED state, only the arbiter.
  // This ensures the buyer explicitly confirms receipt before funds move.
  log("escrow", "Buyer confirms delivery — releasing escrow to seller...");

  const releaseTx = new Transaction();
  escrowContract.release({
    coinType: SUI_COIN_TYPE,
    escrowId,
    sender: payer.toSuiAddress(), // buyer releases
  })(releaseTx);

  const releaseDigest = await signAndExecute(payer, releaseTx);
  log("escrow", `Released: ${releaseDigest}`);
  log("escrow", `Explorer: https://suiscan.xyz/testnet/tx/${releaseDigest}`);

  // Verify release event
  await client.waitForTransaction({ digest: releaseDigest });
  const releaseTxn = await client.getTransactionBlock({
    digest: releaseDigest,
    options: { showEvents: true },
  });

  const releaseEvent = releaseTxn.events?.find((e) => e.type.includes("::escrow::EscrowReleased"));
  if (releaseEvent) {
    log("escrow", "EscrowReleased event emitted (EscrowReceipt created for SEAL)");
  }

  return createDigest;
}

// ══════════════════════════════════════════════════════════════
// Demo 4: Atomic Pay-and-Prove (Composable PTB)
// ══════════════════════════════════════════════════════════════

async function demoPayAndProve(
  payer: Ed25519Keypair,
  recipient: Ed25519Keypair,
  feeRecipient: Ed25519Keypair,
) {
  header("DEMO 4: Atomic Pay-and-Prove (SEAL Flow)");
  log("prove", "One PTB: pay + get receipt + transfer proof. Atomic — no reconciliation gap.");

  const tx = new Transaction();
  const receipt = payment.payComposable({
    coinType: SUI_COIN_TYPE,
    sender: payer.toSuiAddress(),
    recipient: recipient.toSuiAddress(),
    amount: PAYMENT_AMOUNT,
    feeMicroPercent: FEE_MICRO_PCT,
    feeRecipient: feeRecipient.toSuiAddress(),
    memo: "seal:content-id:demo-encrypted-api-docs",
  })(tx);
  tx.transferObjects([receipt], payer.toSuiAddress());

  const digest = await signAndExecute(payer, tx);
  log("prove", `TX digest: ${digest}`);
  log("prove", `Explorer: https://suiscan.xyz/testnet/tx/${digest}`);

  await client.waitForTransaction({ digest });
  const txn = await client.getTransactionBlock({
    digest,
    options: { showEffects: true, showEvents: true, showObjectChanges: true },
  });

  log("prove", `Status: ${txn.effects?.status?.status}`);

  // Find the PaymentReceipt object
  const receiptObj = txn.objectChanges?.find(
    (c) => c.type === "created" && "objectType" in c && c.objectType.includes("PaymentReceipt"),
  );
  if (receiptObj && "objectId" in receiptObj) {
    log("prove", `PaymentReceipt: ${receiptObj.objectId}`);
    log("prove", `  -> This receipt ID = SEAL access condition for encrypted content`);
    log("prove", `  -> Seller encrypted against this ID BEFORE payment`);
    log("prove", `  -> Buyer owns receipt -> can decrypt. Atomic. No gap.`);
  }

  return digest;
}

// ══════════════════════════════════════════════════════════════
// Demo 5: Abandoned Stream Recovery (recipient_close)
// ══════════════════════════════════════════════════════════════

async function demoRecipientClose(
  payer: Ed25519Keypair,
  recipient: Ed25519Keypair,
  feeRecipient: Ed25519Keypair,
) {
  header("DEMO 5: Abandoned Stream Recovery");
  log("recover", "The safety valve: what happens when the payer agent crashes?");
  log("recover", "Creating stream, then recipient force-closes (simulating abandoned payer)...");

  // Step 1: Create a stream
  const createTx = new Transaction();
  stream.create({
    coinType: SUI_COIN_TYPE,
    sender: payer.toSuiAddress(),
    recipient: recipient.toSuiAddress(),
    depositAmount: STREAM_DEPOSIT,
    ratePerSecond: STREAM_RATE,
    budgetCap: STREAM_BUDGET_CAP,
    feeMicroPercent: FEE_MICRO_PCT,
    feeRecipient: feeRecipient.toSuiAddress(),
  })(createTx);

  const createDigest = await signAndExecute(payer, createTx);
  log("recover", `Stream created: ${createDigest}`);

  await client.waitForTransaction({ digest: createDigest });
  const createTxn = await client.getTransactionBlock({
    digest: createDigest,
    options: { showEvents: true, showObjectChanges: true },
  });

  const streamEvent = createTxn.events?.find((e) => e.type.includes("::stream::StreamCreated"));
  const meterId = streamEvent?.parsedJson && typeof streamEvent.parsedJson === "object" && "meter_id" in streamEvent.parsedJson
    ? String(streamEvent.parsedJson.meter_id)
    : undefined;

  if (!meterId) {
    const sharedObj = createTxn.objectChanges?.find(
      (c) => c.type === "created" && "objectType" in c && c.objectType.includes("StreamingMeter"),
    );
    if (!sharedObj || !("objectId" in sharedObj)) {
      log("recover", "Could not find meter ID — skipping");
      return createDigest;
    }
  }

  log("recover", `Meter ID: ${meterId}`);
  log("recover", "Payer agent 'crashes' here. Keys lost. Stream abandoned.");
  log("recover", "");
  log("recover", "NOTE: On mainnet, recipient_close requires 7 days of inactivity.");
  log("recover", "This call will abort with ETimeoutNotReached (109) — which PROVES");
  log("recover", "the safety check is working. The contract enforces the timeout.");

  // Fund recipient for gas
  try {
    await requestSuiFromFaucetV2({
      host: getFaucetHost("testnet"),
      recipient: recipient.toSuiAddress(),
    });
    await sleep(2000);
  } catch {
    log("recover", "Faucet unavailable — using payer to close instead");
    const closeTx = new Transaction();
    stream.close({
      coinType: SUI_COIN_TYPE,
      meterId: meterId!,
      sender: payer.toSuiAddress(),
    })(closeTx);
    const closeDigest = await signAndExecute(payer, closeTx);
    log("recover", `Closed by payer (faucet fallback): ${closeDigest}`);
    return createDigest;
  }

  // Step 2: Recipient tries recipient_close (will fail with timeout check — that's the point)
  const recipientCloseTx = new Transaction();
  stream.recipientClose({
    coinType: SUI_COIN_TYPE,
    meterId: meterId!,
    sender: recipient.toSuiAddress(),
  })(recipientCloseTx);

  try {
    const closeDigest = await signAndExecute(recipient, recipientCloseTx);
    log("recover", `Recovered! TX: ${closeDigest}`);
    log("recover", `Explorer: https://suiscan.xyz/testnet/tx/${closeDigest}`);
  } catch (err: any) {
    const msg = err.message || "";
    if (msg.includes("109") || msg.includes("ETimeoutNotReached")) {
      log("recover", "MoveAbort 109 (ETimeoutNotReached) — CORRECT!");
      log("recover", "The contract rejected early close. 7-day timeout enforced.");
      log("recover", "On a real abandoned stream, this succeeds after 7 days.");
      log("recover", "No admin. No support ticket. Just the contract doing its job.");
    } else {
      log("recover", `Unexpected error: ${msg.slice(0, 120)}`);
    }

    // Clean up — payer closes since timeout hasn't passed
    log("recover", "Cleaning up (payer closes for demo purposes)...");
    const closeTx = new Transaction();
    stream.close({
      coinType: SUI_COIN_TYPE,
      meterId: meterId!,
      sender: payer.toSuiAddress(),
    })(closeTx);
    const closeDigest = await signAndExecute(payer, closeTx);
    log("recover", `Cleaned up: ${closeDigest}`);
  }

  return createDigest;
}

// ══════════════════════════════════════════════════════════════
// Main
// ══════════════════════════════════════════════════════════════

async function main() {
  console.log(`
╔═══════════════════════════════════════════════════════════╗
║     SweeFi — Testnet Demo (4 Modules, 5 Scenarios)      ║
║                                                           ║
║  Safety guardrails for autonomous agent commerce on Sui   ║
╚═══════════════════════════════════════════════════════════╝`);

  const { payer, recipient, feeRecipient } = await setup();

  const digests: string[] = [];

  try {
    digests.push(await demoPayment(payer, recipient, feeRecipient));
  } catch (err: any) {
    console.error(`\nPayment demo failed: ${err.message}`);
  }

  try {
    digests.push(await demoStream(payer, recipient, feeRecipient));
  } catch (err: any) {
    console.error(`\nStream demo failed: ${err.message}`);
  }

  try {
    digests.push(await demoEscrow(payer, recipient, feeRecipient));
  } catch (err: any) {
    console.error(`\nEscrow demo failed: ${err.message}`);
  }

  try {
    digests.push(await demoPayAndProve(payer, recipient, feeRecipient));
  } catch (err: any) {
    console.error(`\nPay-and-prove demo failed: ${err.message}`);
  }

  try {
    digests.push(await demoRecipientClose(payer, recipient, feeRecipient));
  } catch (err: any) {
    console.error(`\nRecipient-close demo failed: ${err.message}`);
  }

  header("DONE");
  console.log(`
  5 scenarios exercised on Sui testnet:
    1. Direct payment (instant settlement + receipt)
    2. Streaming micropayments (create → claim → close)
    3. Time-locked escrow (create → release + SEAL receipt)
    4. Atomic pay-and-prove (composable PTB → SEAL access)
    5. Abandoned stream recovery (recipient_close safety valve)

  Package: ${config.packageId}
  Transactions:
${digests.map((d) => `    https://suiscan.xyz/testnet/tx/${d}`).join("\n")}

  These are REAL on-chain transactions — not simulations.
  Every safety guardrail enforced by Move code, not trust.
`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
