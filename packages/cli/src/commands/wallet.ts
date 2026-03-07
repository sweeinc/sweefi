/**
 * sweefi wallet generate
 *
 * Generate a new Ed25519 keypair for Sui.
 * Outputs the address and private key in bech32 format (suiprivkey1...).
 */

import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { outputSuccess } from "../output.js";
import type { RequestContext } from "../output.js";

export function walletGenerate(flags: { human?: boolean }, reqCtx: RequestContext): void {
  const keypair = new Ed25519Keypair();
  const address = keypair.toSuiAddress();
  const secretKey = keypair.getSecretKey();

  outputSuccess("wallet generate", {
    address,
    privateKey: secretKey,
    message: "Fund this address with SUI and USDC before making payments. Save the private key securely.",
    setup: `export SUI_PRIVATE_KEY="${secretKey}"`,
  }, flags.human ?? false, reqCtx);
}
