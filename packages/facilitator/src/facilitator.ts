import { s402Facilitator } from "s402";
import { toFacilitatorSuiSigner, createSuiClient } from "@sweefi/sui";
import {
  ExactSuiFacilitatorScheme,
  PrepaidSuiFacilitatorScheme,
  StreamSuiFacilitatorScheme,
  EscrowSuiFacilitatorScheme,
} from "@sweefi/sui";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { decodeSuiPrivateKey } from "@mysten/sui/cryptography";
import type { Config } from "./config";
import { GasSponsorService } from "./gas-service";

/**
 * Decode FACILITATOR_KEYPAIR — accept both bech32 (suiprivkey1...) and base64 formats.
 * Returns undefined if no keypair is configured.
 */
function decodeKeypair(raw: string | undefined): Ed25519Keypair | undefined {
  if (!raw) return undefined;

  try {
    // Try bech32 first (sui keytool export format: suiprivkey1...)
    const decoded = decodeSuiPrivateKey(raw);
    return Ed25519Keypair.fromSecretKey(decoded.secretKey);
  } catch {
    // Fall back to raw base64
    return Ed25519Keypair.fromSecretKey(raw);
  }
}

/**
 * Create and configure the s402 facilitator with Sui support.
 *
 * GAS SPONSORSHIP DESIGN (v0.2):
 * Only the exact scheme supports gas sponsorship. Stream, escrow, and prepaid
 * schemes use on-chain Move contracts that own gas objects differently — the
 * facilitator can't sponsor gas for transactions that interact with shared
 * objects in those contracts without a protocol-level redesign.
 *
 * The exact scheme is the simplest (coinWithBalance + transferObjects), so
 * the sponsor only needs to co-sign the same tx bytes the client signed.
 */
export interface FacilitatorBundle {
  facilitator: s402Facilitator;
  gasSponsorService?: GasSponsorService;
}

export function createFacilitator(config: Config): FacilitatorBundle {
  const facilitator = new s402Facilitator();

  const rpcUrls: Record<string, string> = {};
  if (config.SUI_MAINNET_RPC) rpcUrls["sui:mainnet"] = config.SUI_MAINNET_RPC;
  if (config.SUI_TESTNET_RPC) rpcUrls["sui:testnet"] = config.SUI_TESTNET_RPC;

  // Decode keypair for gas sponsorship (accepts bech32 suiprivkey1... or base64)
  const keypair = decodeKeypair(config.FACILITATOR_KEYPAIR);
  if (keypair) {
    const addr = keypair.getPublicKey().toSuiAddress();
    console.log(`[sweefi-facilitator] Gas sponsor address: ${addr}`);
    console.log(
      `[sweefi-facilitator] Gas sponsorship: exact scheme only. ` +
      `Budget cap: ${config.MAX_SPONSOR_GAS_MIST} MIST/tx, rate limit: ${config.GAS_SPONSOR_MAX_PER_HOUR}/key/hour.`,
    );
  } else {
    console.log("[sweefi-facilitator] No FACILITATOR_KEYPAIR — gas sponsorship disabled.");
  }

  const signer = toFacilitatorSuiSigner(
    Object.keys(rpcUrls).length > 0 ? { rpcUrls } : undefined,
    keypair,
  );

  // Package ID for event anti-spoofing verification. Required for non-exact
  // schemes (stream, escrow, prepaid) to prevent attacker-deployed contracts
  // from emitting fake events that pass facilitator verification.
  const packageId = config.SWEEFI_PACKAGE_ID;

  const networks = ["sui:testnet", "sui:mainnet"];

  for (const network of networks) {
    // Exact scheme uses PTB content verification (no events), so packageId not needed.
    facilitator.register(network, new ExactSuiFacilitatorScheme(signer, BigInt(config.MAX_SPONSOR_GAS_MIST)));

    // Non-exact schemes require packageId for event anti-spoofing.
    // Skip registration (with warning) if packageId is not configured.
    if (packageId) {
      facilitator.register(network, new PrepaidSuiFacilitatorScheme(signer, packageId));
      facilitator.register(network, new StreamSuiFacilitatorScheme(signer, packageId));
      facilitator.register(network, new EscrowSuiFacilitatorScheme(signer, packageId));
    }
  }

  if (!packageId) {
    console.warn(
      "[sweefi-facilitator] ⚠️  SWEEFI_PACKAGE_ID is not set. " +
      "Only the exact scheme is registered. Stream, escrow, and prepaid schemes " +
      "require SWEEFI_PACKAGE_ID for event anti-spoofing verification."
    );
  }

  // Gas sponsorship service — only when FACILITATOR_KEYPAIR is configured.
  // Uses sui-gas-station's GasSponsor for coin pool management, kind-bytes
  // workflow, epoch boundary handling, and drain prevention.
  let gasSponsorService: GasSponsorService | undefined;
  if (keypair) {
    // Pick the first available network for the gas sponsor RPC client.
    // Gas sponsorship is per-network — for multi-network support, extend
    // to create one GasSponsorService per network.
    const sponsorNetwork = config.SUI_TESTNET_RPC ? "sui:testnet" : "sui:mainnet";
    const sponsorRpcUrl = rpcUrls[sponsorNetwork] ?? undefined;
    const sponsorClient = createSuiClient(sponsorNetwork, sponsorRpcUrl);

    gasSponsorService = new GasSponsorService({
      client: sponsorClient,
      signer: keypair,
      maxBudgetPerTx: BigInt(config.MAX_SPONSOR_GAS_MIST),
    });
  }

  return { facilitator, gasSponsorService };
}
