/**
 * SweeFi SEAL E2E Demo — Atomic Pay-to-Decrypt on Sui Testnet
 *
 * Demonstrates the full flow:
 *   1. Buyer creates escrow (deposit SUI, set seller + arbiter)
 *   2. Seller encrypts secret content with SEAL (key = escrow_id + nonce)
 *   3. Encrypted blob uploaded to Walrus testnet
 *   4. Buyer releases escrow → receives EscrowReceipt
 *   5. Buyer uses receipt to decrypt from SEAL key servers
 *   6. Decrypted content verified
 *
 * The SEAL key servers validate the EscrowReceipt via dry-run of
 * sweefi::seal_policy::seal_approve. No centralized access control.
 *
 * Usage:
 *   SUI_PRIVATE_KEY=<base64 Ed25519 key> pnpm demo
 *
 * Requirements:
 *   - Funded Sui testnet wallet (need SUI for gas + escrow deposit)
 *   - SEAL key servers running on testnet (2 servers, threshold 2)
 *   - Walrus testnet publisher + aggregator available
 */

import { SealClient, SessionKey, EncryptedObject } from "@mysten/seal";
import { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import { fromBase64, fromHex, toHex } from "@mysten/sui/utils";
import {
  buildCreateEscrowTx,
  buildReleaseEscrowTx,
  testnetConfig,
  TESTNET_PACKAGE_ID,
} from "@sweefi/sui/ptb";

// ──────────────────────────────────────────────────────────────
// Configuration
// ──────────────────────────────────────────────────────────────

const SUI_COIN_TYPE = "0x2::sui::SUI";
const FULLNODE_URL = "https://fullnode.testnet.sui.io:443";
const WALRUS_PUBLISHER = "https://publisher.walrus-testnet.walrus.space";
const WALRUS_AGGREGATOR = "https://aggregator.walrus-testnet.walrus.space";

// Real SEAL testnet key servers (from MystenLabs/seal/examples)
const SEAL_KEY_SERVERS = [
  {
    objectId:
      "0x73d05d62c18d9374e3ea529e8e0ed6161da1a141a94d3f76ae3fe4e99356db75",
    weight: 1,
  },
  {
    objectId:
      "0xf5d14a81a982144ae441cd7d64b09027f116a468bd36e7eca494f750591623c8",
    weight: 1,
  },
];
const SEAL_THRESHOLD = 2; // Majority of 2 servers

// The secret content the seller encrypts
const SECRET_CONTENT = new TextEncoder().encode(
  "Premium AI model weights v4.2 — CONFIDENTIAL. " +
    "Only the escrow buyer can decrypt this after releasing payment."
);

// ──────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────

function log(step: string, msg: string) {
  console.log(`\n[${"=".repeat(3)} ${step} ${"=".repeat(3)}]`);
  console.log(msg);
}

function logDetail(key: string, value: string) {
  console.log(`  ${key}: ${value}`);
}

async function signAndExecute(
  suiClient: SuiJsonRpcClient,
  keypair: Ed25519Keypair,
  tx: Transaction,
  label: string
) {
  log(label, "Signing and executing transaction...");
  const result = await suiClient.signAndExecuteTransaction({
    signer: keypair,
    transaction: tx,
    options: {
      showEffects: true,
      showObjectChanges: true,
      showEvents: true,
    },
  });

  if (result.effects?.status?.status !== "success") {
    throw new Error(
      `Transaction failed: ${result.effects?.status?.error ?? "unknown error"}`
    );
  }

  logDetail("TX digest", result.digest);
  logDetail(
    "Explorer",
    `https://suiscan.xyz/testnet/tx/${result.digest}`
  );
  return result;
}

/**
 * Upload encrypted data to Walrus testnet publisher.
 * Returns the blob ID for retrieval.
 */
async function uploadToWalrus(data: Uint8Array): Promise<string> {
  const response = await fetch(`${WALRUS_PUBLISHER}/v1/blobs?epochs=1`, {
    method: "PUT",
    body: data.buffer as ArrayBuffer,
    headers: { "Content-Type": "application/octet-stream" },
  });

  if (!response.ok) {
    throw new Error(`Walrus upload failed: ${response.status} ${response.statusText}`);
  }

  const json = await response.json();

  if ("alreadyCertified" in json) {
    return json.alreadyCertified.blobId;
  } else if ("newlyCreated" in json) {
    return json.newlyCreated.blobObject.blobId;
  }

  throw new Error(`Unexpected Walrus response: ${JSON.stringify(json)}`);
}

/**
 * Download encrypted data from Walrus testnet aggregator.
 */
async function downloadFromWalrus(blobId: string): Promise<Uint8Array> {
  const response = await fetch(`${WALRUS_AGGREGATOR}/v1/blobs/${blobId}`, {
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    throw new Error(`Walrus download failed: ${response.status} ${response.statusText}`);
  }

  return new Uint8Array(await response.arrayBuffer());
}

// ──────────────────────────────────────────────────────────────
// Main Demo
// ──────────────────────────────────────────────────────────────

async function main() {
  console.log("╔══════════════════════════════════════════════════════╗");
  console.log("║  SweeFi SEAL E2E Demo — Atomic Pay-to-Decrypt      ║");
  console.log("║  Network: Sui Testnet | Package: v6                  ║");
  console.log("╚══════════════════════════════════════════════════════╝");

  // ── Step 0: Setup ──────────────────────────────────────────
  const privateKey = process.env.SUI_PRIVATE_KEY;
  if (!privateKey) {
    console.error("ERROR: Set SUI_PRIVATE_KEY env var (base64 Ed25519 key)");
    process.exit(1);
  }

  const keypair = Ed25519Keypair.fromSecretKey(fromBase64(privateKey));
  const buyerAddress = keypair.getPublicKey().toSuiAddress();
  // For demo: seller = a distinct address, arbiter = buyer (can self-release)
  const sellerAddress =
    "0x000000000000000000000000000000000000000000000000000000000000beef";

  const suiClient = new SuiJsonRpcClient({ url: FULLNODE_URL, network: "testnet" });
  const sealClient = new SealClient({
    suiClient,
    serverConfigs: SEAL_KEY_SERVERS,
    verifyKeyServers: false, // Skip verification for demo speed
  });

  log("SETUP", "Wallet and clients initialized");
  logDetail("Buyer", buyerAddress);
  logDetail("Seller", sellerAddress);
  logDetail("Package", TESTNET_PACKAGE_ID);

  // Check balance
  const balance = await suiClient.getBalance({ owner: buyerAddress });
  logDetail("Balance", `${Number(balance.totalBalance) / 1e9} SUI`);

  if (BigInt(balance.totalBalance) < 50_000_000n) {
    console.error("ERROR: Need at least 0.05 SUI for gas + deposit");
    console.error("Get testnet SUI: https://faucet.sui.io");
    process.exit(1);
  }

  // ── Step 1: Create Escrow ──────────────────────────────────
  // Buyer deposits 10,000 MIST into escrow.
  // The escrow_id is known immediately — BEFORE the seller encrypts.
  const deadline = BigInt(Date.now() + 10 * 60 * 1000); // 10 minutes
  const createTx = buildCreateEscrowTx(testnetConfig, {
    coinType: SUI_COIN_TYPE,
    sender: buyerAddress,
    seller: sellerAddress,
    arbiter: buyerAddress, // buyer = arbiter for demo (can self-release)
    depositAmount: 10_000n,
    deadlineMs: deadline,
    feeMicroPercent: 0,
    feeRecipient: buyerAddress,
    memo: "SEAL pay-to-decrypt demo",
  });

  const createResult = await signAndExecute(
    suiClient,
    keypair,
    createTx,
    "Step 1: CREATE ESCROW"
  );

  // Extract escrow object ID from created objects
  const escrowChange = createResult.objectChanges?.find(
    (c: { type: string; objectType?: string }) =>
      c.type === "created" && c.objectType?.includes("::escrow::Escrow<")
  );
  if (!escrowChange || escrowChange.type !== "created") {
    throw new Error("Escrow object not found in transaction effects");
  }
  const escrowId = escrowChange.objectId;

  logDetail("Escrow ID", escrowId);
  logDetail("Deposit", "10,000 MIST");
  logDetail("Deadline", new Date(Number(deadline)).toISOString());

  // ── Step 2: Encrypt with SEAL ──────────────────────────────
  // The seller knows the escrow_id. They construct a SEAL key ID:
  //   key_id = [escrow_id_bytes (32)] [random_nonce (5)]
  // Then encrypt the secret content. SEAL key servers will later
  // verify that the decryptor holds an EscrowReceipt matching this escrow_id.
  log("Step 2: SEAL ENCRYPT", "Seller encrypts secret content...");

  const escrowIdBytes = fromHex(escrowId.slice(2)); // Remove 0x prefix
  const nonce = crypto.getRandomValues(new Uint8Array(5));
  const encryptionId = toHex(
    new Uint8Array([...escrowIdBytes, ...nonce])
  );

  logDetail("Escrow ID (hex)", escrowId);
  logDetail("Nonce", toHex(nonce));
  logDetail("Encryption ID", `${encryptionId.slice(0, 20)}...`);
  logDetail("Plaintext size", `${SECRET_CONTENT.length} bytes`);

  const { encryptedObject: encryptedBytes, key: backupKey } =
    await sealClient.encrypt({
      threshold: SEAL_THRESHOLD,
      packageId: TESTNET_PACKAGE_ID,
      id: encryptionId,
      data: SECRET_CONTENT,
    });

  logDetail("Encrypted size", `${encryptedBytes.length} bytes`);
  logDetail("Backup key", `${toHex(backupKey).slice(0, 16)}... (handle with care)`);

  // ── Step 3: Upload to Walrus ───────────────────────────────
  log("Step 3: WALRUS UPLOAD", "Uploading encrypted blob...");

  const blobId = await uploadToWalrus(encryptedBytes);

  logDetail("Blob ID", blobId);
  logDetail("Aggregator URL", `${WALRUS_AGGREGATOR}/v1/blobs/${blobId}`);
  logDetail("Storage", "1 epoch on Walrus testnet");

  // At this point:
  //   - Escrow is on-chain (buyer's funds locked)
  //   - Encrypted blob is on Walrus (only decryptable with correct receipt)
  //   - The seller has delivered (encrypted) without trusting the buyer
  //   - The buyer can verify encryption before releasing

  // ── Step 4: Release Escrow → Get Receipt ───────────────────
  // Buyer releases escrow. The Move contract:
  //   1. Transfers deposit to seller (minus fee)
  //   2. Mints EscrowReceipt with escrow_id, buyer, seller, amount
  //   3. Transfers receipt to buyer
  const releaseTx = buildReleaseEscrowTx(testnetConfig, {
    coinType: SUI_COIN_TYPE,
    escrowId,
    sender: buyerAddress, // buyer acts as arbiter (demo only)
  });

  const releaseResult = await signAndExecute(
    suiClient,
    keypair,
    releaseTx,
    "Step 4: RELEASE ESCROW"
  );

  // Find the EscrowReceipt in created objects
  const receiptChange = releaseResult.objectChanges?.find(
    (c: { type: string; objectType?: string }) =>
      c.type === "created" &&
      c.objectType?.includes("::escrow::EscrowReceipt")
  );
  if (!receiptChange || receiptChange.type !== "created") {
    throw new Error("EscrowReceipt not found in transaction effects");
  }
  const receiptId = receiptChange.objectId;

  logDetail("Receipt ID", receiptId);
  logDetail("Receipt type", "escrow::EscrowReceipt (key + store)");

  // ── Step 5: Create Session Key ─────────────────────────────
  // SEAL requires a session key: an ephemeral keypair signed by the
  // buyer's wallet. Key servers verify: "is this session authorized
  // by an address that satisfies the policy?"
  log("Step 5: SESSION KEY", "Creating SEAL session key...");

  const sessionKey = await SessionKey.create({
    address: buyerAddress,
    packageId: TESTNET_PACKAGE_ID,
    ttlMin: 10, // 10 minutes
    signer: keypair,
    suiClient,
  });

  logDetail("Session TTL", "10 minutes");
  logDetail("Bound to", buyerAddress);

  // ── Step 6: Download + Decrypt ─────────────────────────────
  // Download encrypted blob from Walrus, then use SEAL to decrypt.
  // SEAL key servers will dry-run: seal_policy::seal_approve(id, receipt)
  // If the receipt matches the escrow_id in the key, decryption succeeds.
  log("Step 6: DOWNLOAD + DECRYPT", "Fetching from Walrus...");

  const downloadedBlob = await downloadFromWalrus(blobId);
  logDetail("Downloaded", `${downloadedBlob.length} bytes`);

  // Parse the encrypted object to get the internal encryption ID
  const parsed = EncryptedObject.parse(downloadedBlob);
  logDetail("Parsed encryption ID", `${parsed.id.slice(0, 20)}...`);

  // Build the seal_approve move call
  // This is the MoveCallConstructor pattern from seal-kit
  const buildSealApproveCall = (tx: Transaction, id: string) => {
    tx.moveCall({
      target: `${TESTNET_PACKAGE_ID}::seal_policy::seal_approve`,
      arguments: [
        tx.pure.vector("u8", Array.from(fromHex(id))),
        tx.object(receiptId),
      ],
    });
  };

  // Fetch decryption keys from SEAL key servers
  log("Step 6b: SEAL KEY FETCH", "Requesting keys from SEAL servers...");
  const fetchTx = new Transaction();
  buildSealApproveCall(fetchTx, parsed.id);
  const fetchTxBytes = await fetchTx.build({
    client: suiClient,
    onlyTransactionKind: true,
  });

  await sealClient.fetchKeys({
    ids: [parsed.id],
    txBytes: fetchTxBytes,
    sessionKey,
    threshold: SEAL_THRESHOLD,
  });

  logDetail("Keys fetched", "2/2 SEAL servers responded");

  // Decrypt
  log("Step 6c: DECRYPT", "Decrypting with threshold keys...");
  const decryptTx = new Transaction();
  buildSealApproveCall(decryptTx, parsed.id);
  const decryptTxBytes = await decryptTx.build({
    client: suiClient,
    onlyTransactionKind: true,
  });

  const decrypted = await sealClient.decrypt({
    data: downloadedBlob,
    sessionKey,
    txBytes: decryptTxBytes,
  });

  const decryptedText = new TextDecoder().decode(decrypted);

  // ── Step 7: Verify ─────────────────────────────────────────
  log("Step 7: VERIFY", "Comparing original and decrypted content...");

  const originalText = new TextDecoder().decode(SECRET_CONTENT);
  const match = decryptedText === originalText;

  logDetail("Original", `"${originalText.slice(0, 50)}..."`);
  logDetail("Decrypted", `"${decryptedText.slice(0, 50)}..."`);
  logDetail("Match", match ? "YES — content verified" : "NO — MISMATCH!");

  if (!match) {
    throw new Error("Decryption verification failed!");
  }

  // ── Summary ────────────────────────────────────────────────
  console.log("\n╔══════════════════════════════════════════════════════╗");
  console.log("║  DEMO COMPLETE — Atomic Pay-to-Decrypt Verified      ║");
  console.log("╠══════════════════════════════════════════════════════╣");
  console.log("║                                                      ║");
  console.log("║  What happened:                                      ║");
  console.log("║  1. Buyer deposited 10,000 MIST into escrow         ║");
  console.log("║  2. Seller encrypted content using escrow_id         ║");
  console.log("║  3. Encrypted blob stored on Walrus                  ║");
  console.log("║  4. Buyer released escrow → received receipt         ║");
  console.log("║  5. Receipt satisfied SEAL policy → decryption key   ║");
  console.log("║  6. Content decrypted and verified                   ║");
  console.log("║                                                      ║");
  console.log("║  No centralized access control. No admin keys.       ║");
  console.log("║  The receipt IS the credential. The contract IS      ║");
  console.log("║  the policy. 70 lines of Move replaced an entire     ║");
  console.log("║  access control server.                              ║");
  console.log("║                                                      ║");
  console.log("╠══════════════════════════════════════════════════════╣");
  console.log(`║  Escrow: ${escrowId.slice(0, 20)}...`);
  console.log(`║  Receipt: ${receiptId.slice(0, 20)}...`);
  console.log(`║  Walrus blob: ${blobId.slice(0, 20)}...`);
  console.log("╚══════════════════════════════════════════════════════╝");
}

main().catch((err) => {
  console.error("\nDEMO FAILED:", err.message);
  if (err.cause) {
    console.error("Caused by:", err.cause);
  }
  process.exit(1);
});
