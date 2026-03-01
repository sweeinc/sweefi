import { Transaction, coinWithBalance } from "@mysten/sui/transactions";
import type { SweefiConfig, PayParams } from "./types";
import { SUI_CLOCK } from "./deployments";
import { assertFeeMicroPercent, assertPositive } from "./assert";

/**
 * Parameters for the atomic pay-and-keep-receipt flow.
 * The receipt stays with the buyer — usable as a SEAL access condition
 * to decrypt content that was encrypted against this receipt's ID.
 */
export interface PayAndProveParams extends PayParams {
  /** Where to send the receipt (usually back to sender for SEAL proof) */
  receiptDestination: string;
}

/**
 * Build an ATOMIC pay-to-prove PTB.
 *
 * One transaction, two effects:
 *   1. Pay the seller (with fee split to facilitator)
 *   2. Transfer the PaymentReceipt to the buyer
 *
 * The receipt's on-chain ID becomes the SEAL access condition.
 * Seller encrypts content against this ID. Buyer decrypts by proving ownership.
 *
 * Why atomic? If payment fails → no receipt. If receipt transfer fails → payment reverts.
 * No "I paid but didn't get access" edge case. No reconciliation. No support tickets.
 *
 * See: ADR-001 (docs/adr/001-composable-ptb-pattern.md)
 *
 * @returns The built Transaction, ready to sign and execute
 */
export function buildPayAndProveTx(
  config: SweefiConfig,
  params: PayAndProveParams,
): Transaction {
  assertPositive(params.amount, "amount", "buildPayAndProveTx");
  assertFeeMicroPercent(params.feeMicroPercent, "buildPayAndProveTx");

  const tx = new Transaction();
  tx.setSender(params.sender);

  const memo = typeof params.memo === "string"
    ? new TextEncoder().encode(params.memo)
    : params.memo ?? new Uint8Array();

  const coin = coinWithBalance({ type: params.coinType, balance: params.amount });

  // Step 1: Pay via the PUBLIC function (returns PaymentReceipt)
  const receipt = tx.moveCall({
    target: `${config.packageId}::payment::pay`,
    typeArguments: [params.coinType],
    arguments: [
      coin,
      tx.pure.address(params.recipient),
      tx.pure.u64(params.amount),
      tx.pure.u64(params.feeMicroPercent),
      tx.pure.address(params.feeRecipient),
      tx.pure.vector("u8", Array.from(memo)),
      tx.object(SUI_CLOCK),
    ],
  });

  // Step 2: Transfer receipt to buyer (or delegated agent)
  // The receipt's on-chain ID is the SEAL access condition.
  tx.transferObjects([receipt], params.receiptDestination);

  return tx;
}
