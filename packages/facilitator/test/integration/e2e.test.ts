/**
 * Day 6: End-to-End Integration Test
 *
 * Full pipeline: client → facilitator → Sui testnet
 *
 * 1. Generate or load Ed25519 keypair
 * 2. Fund from Sui testnet faucet (or use pre-funded key)
 * 3. Client signs a payment transaction (SUI coin — faucet gives SUI, not USDC)
 * 4. Facilitator verifies the signed payload against testnet RPC
 * 5. Facilitator settles (broadcasts) the transaction on-chain
 * 6. Verify the transaction exists on-chain with success status
 *
 * Run:
 *   pnpm test:integration                              # uses faucet (may rate-limit)
 *   SUI_TESTNET_PRIVATE_KEY=suiprivkey... pnpm test:integration  # uses pre-funded key
 *
 * Requires: network access to Sui testnet
 */
import { describe, it, expect, beforeAll } from "vitest";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { SuiClient, getFullnodeUrl } from "@mysten/sui/client";
import { requestSuiFromFaucetV2, getFaucetHost } from "@mysten/sui/faucet";
import { toClientSuiSigner, toFacilitatorSuiSigner } from "@sweepay/sui";
import { ExactSuiScheme as ClientExactSuiScheme } from "@sweepay/sui/exact/client";
import { x402Facilitator } from "@sweepay/core/facilitator";
import { registerExactSuiScheme } from "@sweepay/sui/exact/facilitator";

const SUI_COIN_TYPE = "0x2::sui::SUI";
const PAYMENT_AMOUNT = "1000000"; // 0.001 SUI (1M MIST)

let skipped = false;
let skipReason = "";

describe("E2E: Client → Facilitator → Sui Testnet", () => {
  let payerKeypair: Ed25519Keypair;
  let recipientAddress: string;
  let suiClient: SuiClient;
  let facilitator: x402Facilitator;
  let clientScheme: ClientExactSuiScheme;

  beforeAll(async () => {
    suiClient = new SuiClient({ url: getFullnodeUrl("testnet") });
    recipientAddress = Ed25519Keypair.generate().toSuiAddress();

    // Option 1: Pre-funded keypair from env (avoids faucet rate limits)
    const privateKey = process.env.SUI_TESTNET_PRIVATE_KEY;
    if (privateKey) {
      payerKeypair = Ed25519Keypair.fromSecretKey(privateKey);
      console.log(`Using pre-funded keypair: ${payerKeypair.toSuiAddress()}`);
    } else {
      // Option 2: Generate fresh keypair and fund from faucet
      payerKeypair = Ed25519Keypair.generate();
      console.log(`Generated keypair: ${payerKeypair.toSuiAddress()}`);

      try {
        await requestSuiFromFaucetV2({
          host: getFaucetHost("testnet"),
          recipient: payerKeypair.toSuiAddress(),
        });
        // Wait for faucet transaction to be indexed
        await new Promise((r) => setTimeout(r, 3000));
      } catch (err: any) {
        if (err.message?.includes("Too many requests") || err.message?.includes("rate limit")) {
          skipped = true;
          skipReason = "Faucet rate-limited. Set SUI_TESTNET_PRIVATE_KEY to use a pre-funded keypair.";
          console.warn(`⚠️  ${skipReason}`);
          return;
        }
        throw err;
      }
    }

    // Verify payer has sufficient balance
    const balance = await suiClient.getBalance({
      owner: payerKeypair.toSuiAddress(),
      coinType: SUI_COIN_TYPE,
    });

    if (BigInt(balance.totalBalance) < BigInt(PAYMENT_AMOUNT) * 5n) {
      skipped = true;
      skipReason = `Insufficient balance: ${balance.totalBalance} MIST (need ${PAYMENT_AMOUNT}). Fund the wallet or use a different key.`;
      console.warn(`⚠️  ${skipReason}`);
      return;
    }

    // Set up client signer
    const clientSigner = toClientSuiSigner(payerKeypair, suiClient);
    clientScheme = new ClientExactSuiScheme(clientSigner);

    // Set up facilitator (no keypair needed — uses client's signature directly)
    facilitator = new x402Facilitator();
    const facilitatorSigner = toFacilitatorSuiSigner();
    registerExactSuiScheme(facilitator, {
      signer: facilitatorSigner,
      networks: ["sui:testnet"],
    });
  });

  function skipIfNeeded() {
    if (skipped) {
      console.log(`SKIPPED: ${skipReason}`);
      return true;
    }
    return false;
  }

  function makeRequirements() {
    return {
      scheme: "exact" as const,
      network: "sui:testnet" as const,
      asset: SUI_COIN_TYPE,
      amount: PAYMENT_AMOUNT,
      payTo: recipientAddress,
      maxTimeoutSeconds: 30,
      extra: {},
    };
  }

  async function createFullPayload(requirements: ReturnType<typeof makeRequirements>) {
    const partial = await clientScheme.createPaymentPayload(2, requirements);
    return {
      ...partial,
      resource: {
        url: "https://test.example.com/premium/data",
        description: "Test premium resource",
        mimeType: "application/json",
      },
      accepted: requirements,
    };
  }

  it("verifies a signed payment payload against testnet", async () => {
    if (skipIfNeeded()) return;

    const requirements = makeRequirements();
    const payload = await createFullPayload(requirements);

    const result = await facilitator.verify(payload, requirements);

    expect(result.isValid).toBe(true);
    expect(result.payer).toBe(payerKeypair.toSuiAddress());
  });

  it("settles a payment on Sui testnet and returns transaction digest", async () => {
    if (skipIfNeeded()) return;

    const requirements = makeRequirements();
    const payload = await createFullPayload(requirements);

    const result = await facilitator.settle(payload, requirements);

    expect(result.success).toBe(true);
    expect(result.transaction).toBeTruthy();
    expect(result.transaction.length).toBeGreaterThan(10); // Sui digests are base58, ~44 chars
    expect(result.network).toBe("sui:testnet");
    expect(result.payer).toBe(payerKeypair.toSuiAddress());
  });

  it("settled transaction exists on-chain with success status", async () => {
    if (skipIfNeeded()) return;

    const requirements = makeRequirements();
    const payload = await createFullPayload(requirements);

    const settleResult = await facilitator.settle(payload, requirements);
    expect(settleResult.success).toBe(true);

    // Wait for finality
    await suiClient.waitForTransaction({
      digest: settleResult.transaction,
      options: { showEffects: true },
    });

    // Verify on-chain
    const txn = await suiClient.getTransactionBlock({
      digest: settleResult.transaction,
      options: { showEffects: true, showBalanceChanges: true },
    });

    expect(txn.effects?.status?.status).toBe("success");

    // Verify balance change: recipient received the payment
    const recipientChange = txn.balanceChanges?.find(
      (c) =>
        c.owner &&
        typeof c.owner === "object" &&
        "AddressOwner" in c.owner &&
        c.owner.AddressOwner === recipientAddress,
    );
    expect(recipientChange).toBeDefined();
    expect(BigInt(recipientChange!.amount)).toBe(BigInt(PAYMENT_AMOUNT));
  });

  it("facilitator rejects a payload with wrong network", async () => {
    if (skipIfNeeded()) return;

    const requirements = makeRequirements();
    const payload = await createFullPayload(requirements);

    // Tamper: change network in requirements
    // x402 throws when no scheme is registered for the network (not isValid: false)
    const wrongRequirements = { ...requirements, network: "sui:mainnet" as const };

    await expect(
      facilitator.verify(payload, wrongRequirements),
    ).rejects.toThrow(/no facilitator registered/i);
  });
});
